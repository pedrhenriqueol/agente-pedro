use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod media;
mod island_visibility;
mod desktop_integration;
mod diagnostics;
mod dock_visibility;
mod top_controls;
mod widget_frame;

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
const ISLAND_WIDTH: f64 = 120.0;
const ISLAND_COMPACT_HEIGHT: f64 = 48.0;
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
            let width = janela.outer_size().map(|size| size.width as i32)
                .unwrap_or_else(|_| (ISLAND_WIDTH * scale).round() as i32);
            let x = area.position.x + (area.size.width as i32 - width) / 2;
            // The surface attaches to the work-area top; its shadow margin is below.
            let y = area.position.y + (2.0 * scale).round() as i32;
            let _ = janela.set_position(PhysicalPosition::new(x, y));
        }
    }
}

/// Prepare the complete native frame before React starts its size animation.
/// Position and dimensions use the current monitor's work area, including DPI.
pub(crate) fn resize_island_frame(app: &AppHandle, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("Dimensões inválidas para a ilha.".into());
    }
    let island = app.get_webview_window("island")
        .ok_or_else(|| "A ilha não está disponível.".to_string())?;
    let monitor = island.current_monitor().map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "O monitor da ilha não está disponível.".to_string())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = width.clamp(96.0, 664.0).min(f64::from(area.size.width) / scale);
    let height = height.clamp(ISLAND_COMPACT_HEIGHT, ISLAND_EXPANDED_HEIGHT)
        .min((f64::from(area.size.height) / scale - 2.0).max(1.0));
    let physical_width = (width * scale).round() as i32;
    let x = area.position.x + (area.size.width as i32 - physical_width) / 2;
    let y = area.position.y + (2.0 * scale).round() as i32;
    widget_frame::set_frame(&island, PhysicalPosition::new(x, y),
        PhysicalSize::new(physical_width as u32, (height * scale).round() as u32))
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
fn island_available_width(app: AppHandle) -> Result<f64, String> {
    let island = app.get_webview_window("island")
        .ok_or_else(|| "A ilha não está disponível.".to_string())?;
    let monitor = island.current_monitor().map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "O monitor da ilha não está disponível.".to_string())?;
    Ok(f64::from(monitor.work_area().size.width) / monitor.scale_factor())
}

#[tauri::command]
fn expandir_ilha(app: AppHandle, altura: f64, largura: Option<f64>) -> Result<(), String> {
    let state = app.try_state::<island_visibility::IslandVisibilityState>()
        .ok_or_else(|| "A visibilidade da ilha ainda está iniciando.".to_string())?;
    if !island_visibility::is_visible(state.inner()) {
        return Err("A ilha está escondida. Revele-a pelo topo para expandir.".into());
    }
    resize_island_frame(&app, largura.unwrap_or(584.0), altura)
}

#[tauri::command]
fn recolher_ilha(app: AppHandle, altura: Option<f64>, largura: Option<f64>) -> Result<(), String> {
    let width = largura.unwrap_or(ISLAND_WIDTH);
    let height = altura.unwrap_or(ISLAND_COMPACT_HEIGHT);
    let state = app.try_state::<island_visibility::IslandVisibilityState>()
        .ok_or_else(|| "A visibilidade da ilha ainda está iniciando.".to_string())?;
    island_visibility::remember_compact_frame(state.inner(), width, height)?;
    resize_island_frame(&app, width, height)
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
        .manage(top_controls::TopControlsState::default())
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
            island_available_width,
            recolher_ilha,
            reposicionar_ilha,
            configurar_dock,
            top_controls::configure_top_control,
            media::media_snapshot,
            media::media_control,
            island_visibility::configure_island_visibility,
            island_visibility::island_activity,
            island_visibility::island_visibility_snapshot,
            island_visibility::complete_island_visibility_transition,
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
            top_controls::init(&handle);
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
