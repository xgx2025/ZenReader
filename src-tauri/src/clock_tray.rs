use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, State, Wry,
};

pub struct ClockTray {
    icon: TrayIcon<Wry>,
    toggle: MenuItem<Wry>,
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 托盘和菜单随桌面进程创建一次，刷新 WebView 只会重新连接专注钟。
pub fn setup(app: &App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "zen-toggle", "点香", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "zen-open", "打开主窗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "zen-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &open, &quit])?;
    let icon = TrayIconBuilder::with_id("zenreader-clock")
        .icon(Image::from_bytes(include_bytes!(
            "../../src/assets/tray.png"
        ))?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "zen-toggle" => {
                let _ = app.emit_to("main", "zen-clock-toggle", ());
            }
            "zen-open" => show_main(app),
            "zen-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(ClockTray { icon, toggle });
    Ok(())
}

#[tauri::command]
pub fn sync_clock_tray(
    tray: State<'_, ClockTray>,
    lit: bool,
    tooltip: String,
) -> Result<(), String> {
    tray.toggle
        .set_text(if lit { "熄香" } else { "点香" })
        .map_err(|e| e.to_string())?;
    tray.icon
        .set_tooltip(Some(tooltip))
        .map_err(|e| e.to_string())
}
