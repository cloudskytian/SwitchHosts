//! Application menu — the macOS menu bar / Windows+Linux window menu.
//!
//! Mirrors the Electron build's menu structure in
//! [src/main/ui/menu.ts] with the same submenus, accelerators, and
//! event broadcasts. Items that need a renderer listener (add_new,
//! show_preferences, show_about, toggle_comment) are routed as Tauri
//! events so the existing `useOnBroadcast` subscribers in the renderer
//! fire unchanged.

use tauri::menu::{
    Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

// ---- menu item ids ---------------------------------------------------------
// Every custom item gets a stable id routed through the global
// `on_menu_event` handler in `lib.rs`.

pub const MENU_ID_ABOUT: &str = "app-about";
pub const MENU_ID_NEW: &str = "app-new";
pub const MENU_ID_PREFERENCES: &str = "app-preferences";
pub const MENU_ID_FIND: &str = "app-find";
pub const MENU_ID_COMMENT: &str = "app-comment";
pub const MENU_ID_FEEDBACK: &str = "app-feedback";
pub const MENU_ID_HOMEPAGE: &str = "app-homepage";

pub const FEEDBACK_URL: &str = "https://github.com/oldj/SwitchHosts/issues";
pub const HOMEPAGE_URL: &str = "https://switchhosts.vercel.app/home/";

/// Build and install the application menu. Called once from
/// `lib.rs::run`'s setup hook.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error> {
    let menu = build_menu(app)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    let file_menu = build_file_menu(app)?;
    let edit_menu = build_edit_menu(app)?;
    let view_menu = build_view_menu(app)?;
    let window_menu = build_window_menu(app)?;
    let help_menu = build_help_menu(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = build_macos_app_menu(app)?;
        Menu::with_items(
            app,
            &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        Menu::with_items(
            app,
            &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
        )
    }
}

// ---- macOS app submenu (About, Hide, Quit) --------------------------------

#[cfg(target_os = "macos")]
fn build_macos_app_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let about = MenuItemBuilder::with_id(MENU_ID_ABOUT, "About SwitchHosts").build(app)?;
    SubmenuBuilder::new(app, "SwitchHosts")
        .item(&about)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

// ---- File ------------------------------------------------------------------

fn build_file_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let new_item = MenuItemBuilder::with_id(MENU_ID_NEW, "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let prefs = MenuItemBuilder::with_id(MENU_ID_PREFERENCES, "Preferences\u{2026}")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let mut builder = SubmenuBuilder::new(app, "File");

    // On Windows/Linux put About at the top of File (Electron does this)
    #[cfg(not(target_os = "macos"))]
    {
        let about = MenuItemBuilder::with_id(MENU_ID_ABOUT, "About SwitchHosts").build(app)?;
        builder = builder.item(&about).separator();
    }

    builder = builder
        .item(&new_item)
        .separator()
        .item(&prefs);

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .separator()
            .item(&PredefinedMenuItem::close_window(app, None)?);
    }

    builder.build()
}

// ---- Edit ------------------------------------------------------------------

fn build_edit_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let comment = MenuItemBuilder::with_id(MENU_ID_COMMENT, "Comment / Uncomment")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let find = MenuItemBuilder::with_id(MENU_ID_FIND, "Find\u{2026}")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;

    SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&comment)
        .item(&find)
        .build()
}

// ---- View ------------------------------------------------------------------

fn build_view_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let mut builder = SubmenuBuilder::new(app, "View");

    // macOS keeps Reload + sep; Windows/Linux strips them (Electron
    // `template[2].submenu.splice(0, 4)` in the win32/linux branch).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .item(&PredefinedMenuItem::fullscreen(app, None)?)
            .separator();
    }

    builder
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()
}

// ---- Window ----------------------------------------------------------------

fn build_window_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let mut builder = SubmenuBuilder::new(app, "Window");
    builder = builder.minimize().close_window();

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .separator()
            .item(&PredefinedMenuItem::maximize(app, None)?);
    }

    builder.build()
}

// ---- Help ------------------------------------------------------------------

fn build_help_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, tauri::Error> {
    let feedback = MenuItemBuilder::with_id(MENU_ID_FEEDBACK, "Feedback")
        .build(app)?;
    let homepage = MenuItemBuilder::with_id(MENU_ID_HOMEPAGE, "Homepage")
        .build(app)?;

    SubmenuBuilder::new(app, "Help")
        .item(&feedback)
        .item(&homepage)
        .build()
}
