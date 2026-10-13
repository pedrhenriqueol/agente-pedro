use std::str::FromStr;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod media;
mod island_visibility;
mod desktop_integration;
mod diagnostics;
mod dock_visibility;

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum StartupStage {
    FrontendLoaded,
    DataLoading,
    FrontendReady,
    FrontendError,
}

#[tauri::command]
fn startup_status(window: tauri::WebviewWindow, stage: StartupStage, message: Option<String>) {
    let stage = match stage {
        StartupStage::FrontendLoaded => "frontend_loaded",
        StartupStage::DataLoading => "data_loading",
        StartupStage::FrontendReady => "frontend_ready",
        StartupStage::FrontendError => "frontend_error",
    };
    diagnostics::write(stage, format!("{}: {}", window.label(), message.as_deref().unwrap_or("")));
}

// The native bounds include the 12 logical pixels used by each widget's shadow.
const ISLAND_WIDTH: f64 = 404.0;
const ISLAND_COMPACT_HEIGHT: f64 = 72.0;
const ISLAND_EXPANDED_HEIGHT: f64 = 424.0;
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
    if !matches!(page.as_str(), "home" | "routine" | "finance" | "music" | "appearance") {
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
    if !island_visibility::is_visible(app.state::<island_visibility::IslandVisibilityState>().inner())
        || !island.is_visible().map_err(|error| error.to_string())? {
        return Err("A ilha está escondida. Revele-a pelo topo para expandir.".into());
    }
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
async fn configurar_dock(app: AppHandle, visivel: bool) -> Result<(), String> {
    dock_visibility::request(&app, visivel).await
}

pub fn run() {
    diagnostics::initialize();
    diagnostics::write("identity", "Configurando identidade do processo");
    desktop_integration::prepare_process_identity();
    let builder = tauri::Builder::default()
        .manage(desktop_integration::DesktopMenuState::default())
        .manage(desktop_integration::TaskbarState::default())
        .manage(desktop_integration::DesktopLaunchState::default())
        .manage(dock_visibility::DockVisibilityState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| desktop_integration::handle_launch_args(app, &args)))
        .manage(media::MediaState::default())
        .manage(island_visibility::IslandVisibilityState::default())
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
            startup_status,
            alternar_console,
            abrir_painel,
            expandir_ilha,
            recolher_ilha,
            reposicionar_ilha,
            configurar_dock,
            media::media_snapshot,
            media::media_control,
            island_visibility::configure_island_visibility,
            island_visibility::island_activity,
            island_visibility::island_visibility_snapshot,
            desktop_integration::configure_desktop_menu,
            desktop_integration::apply_window_material,
            desktop_integration::focus_taskbar_progress,
            desktop_integration::desktop_initial_page,
        ])
        .on_page_load(|window, payload| {
            diagnostics::write("webview", format!("{}: {:?}", window.label(), payload.event()));
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => diagnostics::write("window_close_requested", window.label()),
                tauri::WindowEvent::Destroyed => diagnostics::write("window_destroyed", window.label()),
                _ => {}
            }
        })
        .setup(|app| {
            diagnostics::write("setup", "Janelas criadas; iniciando serviços");
            let handle = app.handle().clone();
            if let Err(error) = desktop_integration::init(&handle) {
                // Menus/tray are complementary; they must not abort data or widgets.
                diagnostics::write("desktop_warning", error.to_string());
            }
            diagnostics::write("media", "Iniciando serviço de música");
            media::start(&handle);
            centralizar_ilha_topo(&handle);
            diagnostics::write("visibility", "Iniciando visibilidade da ilha");
            island_visibility::start(&handle);
            centralizar_dock_base(&handle);
            dock_visibility::start(&handle);
            if let Ok(shortcut) = Shortcut::from_str("Alt+Space") {
                if let Err(error) = app.global_shortcut().register(shortcut) {
                    diagnostics::write("shortcut_warning", error.to_string());
                }
            }
            desktop_integration::handle_initial_launch(&handle);
            diagnostics::write("setup_ready", "Serviços inicializados");
            Ok(())
        });
    diagnostics::write("build", "Construindo runtime Tauri");
    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            diagnostics::fatal(&format!("Não foi possível iniciar o Agente Pedro: {error}"));
            std::process::exit(1);
        }
    };
    diagnostics::write("run", "Iniciando event loop");
    app.run(|_, event| match event {
        tauri::RunEvent::Ready => diagnostics::write("runtime_ready", "Event loop pronto"),
        tauri::RunEvent::ExitRequested { code, .. } => diagnostics::write("exit_requested", format!("code={code:?}")),
        tauri::RunEvent::Exit => diagnostics::write("exit", "Runtime encerrado"),
        _ => {}
    });
}
