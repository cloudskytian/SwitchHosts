//! System tray for the v5 main app.
//!
//! Phase 2.B.1 scope:
//!
//! - Tray icon present on every platform. macOS uses the template
//!   variant so the OS recolours it for light/dark menu bars.
//! - Right-click (or any-click on Linux) opens a context menu with
//!   "Show Main Window", a disabled version label, an optional
//!   macOS-only "Hide/Show Dock Icon" toggle, and "Quit".
//! - Left-click on macOS/Windows shows the main window directly. The
//!   tray mini-window (`/tray` route) is deferred to P2.B.2.
//! - `update_tray_title` command (in commands.rs) walks the manifest
//!   and sets the tray title text on macOS, mirroring Electron's
//!   `show_title_on_tray` behaviour.
//!
//! Tray menu ids start with `tray-` so the global `on_menu_event`
//! handler in `lib.rs` can route them in the same dispatch table as
//! `popup_menu_item_*` events.

use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::lifecycle::{self, MAIN_WINDOW_LABEL};
use crate::storage::AppState;

pub const TRAY_ID: &str = "main-tray";

pub const MENU_ID_SHOW_MAIN: &str = "tray-show-main";
pub const MENU_ID_VERSION: &str = "tray-version";
pub const MENU_ID_TOGGLE_DOCK: &str = "tray-toggle-dock";
pub const MENU_ID_QUIT: &str = "tray-quit";

const TRAY_MAC_ICON: &[u8] = include_bytes!("../icons/tray-mac.png");
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

// TODO: replace with a build-script injection so the tray label tracks
// `src/version.json`. Hardcoded for P2.B.1; tracked alongside
// implementation-notes D3 (`tauri.conf.json > version` source of truth).
const VERSION_LABEL: &str = "v4.3.0 (6140)";

/// Build and install the system tray. Called once from `lib.rs::run`
/// inside the Builder's setup hook, after the main window exists.
pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error> {
    let icon = load_icon();
    let menu = build_menu(app)?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("SwitchHosts");

    // Linux GTK status icons don't deliver discrete click events the
    // way macOS / Windows do — the only reliable interaction surface
    // is the menu. So we let the menu open on every click on Linux,
    // and use the click handler for "left click → show main window"
    // on the other two platforms.
    #[cfg(not(target_os = "linux"))]
    let builder = builder
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    builder.build(app)?;
    Ok(())
}

fn load_icon() -> Image<'static> {
    let bytes = if cfg!(target_os = "macos") {
        TRAY_MAC_ICON
    } else {
        TRAY_ICON
    };
    Image::from_bytes(bytes).expect("tray icon bytes are bundled at compile time")
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    let show_main = MenuItemBuilder::with_id(MENU_ID_SHOW_MAIN, "Show Main Window")
        .build(app)?;
    let version = MenuItemBuilder::with_id(MENU_ID_VERSION, VERSION_LABEL)
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id(MENU_ID_QUIT, "Quit").build(app)?;

    let mut menu_builder = MenuBuilder::new(app)
        .item(&show_main)
        .item(&version)
        .separator();

    #[cfg(target_os = "macos")]
    {
        let hide_dock = read_hide_dock_icon(app);
        let label = if hide_dock {
            "Show Dock Icon"
        } else {
            "Hide Dock Icon"
        };
        let toggle = MenuItemBuilder::with_id(MENU_ID_TOGGLE_DOCK, label).build(app)?;
        menu_builder = menu_builder.item(&toggle).separator();
    }

    menu_builder.item(&quit).build()
}

#[cfg(target_os = "macos")]
fn read_hide_dock_icon<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<AppState>();
    state
        .config
        .lock()
        .map(|cfg| cfg.hide_dock_icon)
        .unwrap_or(false)
}

// ---- menu event dispatch ---------------------------------------------------

/// Called from the global `on_menu_event` handler in `lib.rs` when an
/// id starts with `tray-`. Returns `true` if the id was handled here.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    match id {
        MENU_ID_SHOW_MAIN => {
            show_main_window(app);
            true
        }
        MENU_ID_QUIT => {
            quit_app(app);
            true
        }
        #[cfg(target_os = "macos")]
        MENU_ID_TOGGLE_DOCK => {
            toggle_dock_icon(app);
            true
        }
        // The version label is disabled, but the OS still surfaces a
        // click event for it on some platforms — swallow it silently.
        MENU_ID_VERSION => true,
        _ => false,
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        lifecycle::persist_window_geometry(&window, state.inner());
    }
    state.is_will_quit.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(target_os = "macos")]
fn toggle_dock_icon<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let new_value = {
        let mut cfg = match state.config.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        cfg.hide_dock_icon = !cfg.hide_dock_icon;
        cfg.hide_dock_icon
    };
    if let Err(e) = state.persist_config() {
        eprintln!("[v5 tray] failed to persist hide_dock_icon: {e}");
    }
    lifecycle::apply_dock_icon_policy(app, new_value);
    refresh_menu(app);
}

/// Rebuild and reattach the tray menu. Cheap — only a few items.
/// Called whenever an item label depends on config that just changed
/// (currently just `hide_dock_icon`).
pub fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                eprintln!("[v5 tray] failed to set tray menu: {e}");
            }
        }
        Err(e) => {
            eprintln!("[v5 tray] failed to rebuild tray menu: {e}");
        }
    }
}

// ---- title --------------------------------------------------------------

/// Compute the tray title text from the manifest list, mirroring
/// `src/main/actions/updateTrayTitle.ts`. Returns `None` when
/// `show_title_on_tray` is false (caller should clear the title).
pub fn compute_tray_title(list: &[serde_json::Value], show: bool) -> Option<String> {
    if !show {
        return None;
    }
    let mut titles: Vec<String> = Vec::new();
    collect_on_titles(list, &mut titles);
    let mut joined = titles.join(",");
    if joined.chars().count() > 20 {
        let truncated: String = joined.chars().take(17).collect();
        joined = format!("{truncated}...");
    }
    Some(joined)
}

fn collect_on_titles(nodes: &[serde_json::Value], out: &mut Vec<String>) {
    for node in nodes {
        let on = node
            .get("on")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if on {
            if let Some(title) = node.get("title").and_then(serde_json::Value::as_str) {
                out.push(title.to_string());
            }
        }
        if let Some(children) = node.get("children").and_then(serde_json::Value::as_array) {
            collect_on_titles(children, out);
        }
    }
}

/// Apply a freshly-computed title to the tray icon. Safe to call from
/// anywhere — does nothing if the tray hasn't been installed yet.
pub fn set_tray_title<R: Runtime>(app: &AppHandle<R>, title: Option<&str>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(title);
    }
}
