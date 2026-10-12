use std::str::FromStr;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// The native bounds include the 12 logical pixels used by each widget's shadow.
const ISLAND_WIDTH: f64 = 404.0;
const ISLAND_COMPACT_HEIGHT: f64 = 72.0;
const ISLAND_EXPANDED_HEIGHT: f64 = 264.0;
const DOCK_WIDTH: f64 = 450.0;
const DOCK_HEIGHT: f64 = 88.0;

pub fn centralizar_ilha_topo(app: &AppHandle) {
    if let Some(janela) = app.get_webview_window("island") {
        let monitor = janela.current_monitor().ok().flatten()
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let width = (ISLAND_WIDTH * scale).round() as i32;
            let x = area.position.x + (area.size.width as i32 - width) / 2;
            // The visible capsule starts 12px inside the transparent native frame.
            let y = area.position.y + (2.0 * scale).round() as i32;
            let _ = janela.set_position(PhysicalPosition::new(x, y));
        }
    }
}

pub fn centralizar_dock_base(app: &AppHandle) {
    if let Some(janela) = app.get_webview_window("dock") {
        let monitor = janela.current_monitor().ok().flatten()
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let width = (DOCK_WIDTH * scale).round() as i32;
            let height = (DOCK_HEIGHT * scale).round() as i32;
            let x = area.position.x + (area.size.width as i32 - width) / 2;
            let y = area.position.y + area.size.height as i32 - height - (6.0 * scale).round() as i32;
            let _ = janela.set_position(PhysicalPosition::new(x, y));
        }
    }
}

pub fn alternar_janela_console(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let visivel = main.is_visible().unwrap_or(false);
        let minimizada = main.is_minimized().unwrap_or(false);
        if minimizada {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        } else if visivel {
            let _ = main.hide();
        } else {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

#[tauri::command]
fn alternar_console(app: AppHandle) {
    alternar_janela_console(&app);
}

#[tauri::command]
fn abrir_painel(app: AppHandle, page: String) -> Result<(), String> {
    if !matches!(page.as_str(), "home" | "routine" | "finance" | "appearance") {
        return Err("Seção desconhecida.".into());
    }
    let main = app.get_webview_window("main")
        .ok_or_else(|| "A janela do painel não está disponível.".to_string())?;
    main.emit("pedro:navigate", &page).map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    app.emit("pedro:page", &page).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn expandir_ilha(app: AppHandle, altura: f64) -> Result<(), String> {
    if !altura.is_finite() {
        return Err("Altura inválida.".into());
    }
    let island = app.get_webview_window("island")
        .ok_or_else(|| "A ilha não está disponível.".to_string())?;
    let height = altura.clamp(ISLAND_COMPACT_HEIGHT, ISLAND_EXPANDED_HEIGHT);
    island.set_size(LogicalSize::new(ISLAND_WIDTH, height)).map_err(|error| error.to_string())
}

#[tauri::command]
fn recolher_ilha(app: AppHandle) -> Result<(), String> {
    let island = app.get_webview_window("island")
        .ok_or_else(|| "A ilha não está disponível.".to_string())?;
    island.set_size(LogicalSize::new(ISLAND_WIDTH, ISLAND_COMPACT_HEIGHT))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reposicionar_ilha(app: AppHandle) {
    centralizar_ilha_topo(&app);
}

#[tauri::command]
fn configurar_dock(app: AppHandle, visivel: bool) -> Result<(), String> {
    let dock = app.get_webview_window("dock")
        .ok_or_else(|| "O dock não está disponível.".to_string())?;
    if visivel {
        centralizar_dock_base(&app);
        dock.show().map_err(|error| error.to_string())
    } else {
        dock.hide().map_err(|error| error.to_string())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Ok(alt_espaco) = Shortcut::from_str("Alt+Space") {
                            if shortcut == &alt_espaco {
                                alternar_janela_console(app);
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            alternar_console,
            abrir_painel,
            expandir_ilha,
            recolher_ilha,
            reposicionar_ilha,
            configurar_dock,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            centralizar_ilha_topo(&handle);
            centralizar_dock_base(&handle);
            if let Ok(shortcut) = Shortcut::from_str("Alt+Space") {
                let _ = app.global_shortcut().register(shortcut);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar aplicação Tauri do Agente Pedro");
}
