use std::str::FromStr;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn centralizar_ilha_topo(app: &AppHandle) {
    if let Some(janela) = app.get_webview_window("island") {
        if let Ok(Some(monitor)) = janela.current_monitor() {
            let monitor_size = monitor.size();
            let scale_factor = monitor.scale_factor();
            let largura_logica = 380.0;
            let largura_fisica = (largura_logica * scale_factor) as i32;
            let x = (monitor_size.width as i32 - largura_fisica) / 2;
            let y = (8.0 * scale_factor) as i32;
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
pub fn alternar_console(app: AppHandle) {
    alternar_janela_console(&app);
}

#[tauri::command]
pub fn expandir_ilha(app: AppHandle, altura: f64) {
    if let Some(island) = app.get_webview_window("island") {
        let alt_limitada = altura.max(48.0).min(200.0);
        let _ = island.set_size(LogicalSize::new(380.0, alt_limitada));
    }
}

#[tauri::command]
pub fn recolher_ilha(app: AppHandle) {
    if let Some(island) = app.get_webview_window("island") {
        let _ = island.set_size(LogicalSize::new(380.0, 48.0));
    }
}

#[tauri::command]
pub fn reposicionar_ilha(app: AppHandle) {
    centralizar_ilha_topo(&app);
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
            expandir_ilha,
            recolher_ilha,
            reposicionar_ilha,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Centraliza a ilha no monitor primário
            centralizar_ilha_topo(&handle);

            // Registra o atalho global Alt+Space
            if let Ok(shortcut) = Shortcut::from_str("Alt+Space") {
                let _ = app.global_shortcut().register(shortcut);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar aplicação Tauri do Agente Pedro");
}
