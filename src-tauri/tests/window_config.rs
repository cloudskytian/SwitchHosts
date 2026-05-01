//! Structural canaries for window setup that have no behavioural
//! equivalent without spinning up a real Tauri runtime.
//!
//! Lives in `tests/` (integration tests) on purpose: this lets
//! `include_str!` read just `src/lifecycle.rs` without sweeping in
//! the test file itself, which would otherwise satisfy a literal-
//! string `.contains` check and silently defeat the canary.

/// Without `.disable_drag_drop_handler()` Tauri's OS-level drag-drop
/// interception swallows `dragstart` inside the webview, breaking
/// the hosts tree's HTML5 DnD reordering. `WebviewWindowBuilder`
/// exposes no config inspector, so we grep the source.
#[test]
fn main_window_disables_drag_drop_handler() {
    const SOURCE: &str = include_str!("../src/lifecycle.rs");
    assert!(
        SOURCE.contains(".disable_drag_drop_handler()"),
        "create_main_window must call .disable_drag_drop_handler() on the builder"
    );
}
