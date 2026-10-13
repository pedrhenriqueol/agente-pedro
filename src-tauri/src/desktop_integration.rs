//! Integration is limited to Pedro's own windows, tray icon and taskbar button.
//! No Explorer window, taskbar preference or desktop work area is modified.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};

const APP_ID: &str = "com.pedro.agente-pedro";
const TRAY_ID: &str = "pedro-desktop";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IslandMode {
    Fixed,
    Hybrid,
}

#[derive(Clone, Copy)]
struct MenuPreferences {
    mode: IslandMode,
    dock: bool,
}

#[derive(Clone)]
struct DesktopMenuItems {
    fixed: CheckMenuItem<tauri::Wry>,
    hybrid: CheckMenuItem<tauri::Wry>,
    dock: CheckMenuItem<tauri::Wry>,
}

struct MenuRuntime {
    items: Option<DesktopMenuItems>,
    preferences: MenuPreferences,
}

/// Exists before WebViews; preferences can arrive before native items exist.
pub(crate) struct DesktopMenuState(Mutex<MenuRuntime>);

impl Default for DesktopMenuState {
    fn default() -> Self {
        Self(Mutex::new(MenuRuntime {
            items: None,
            preferences: MenuPreferences { mode: IslandMode::Fixed, dock: false },
        }))
    }
}

#[derive(Default)]
pub struct DesktopLaunchState(Mutex<Option<String>>);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FocusProgressState {
    None,
    Running,
    Paused,
}

#[derive(Clone, Copy, Debug)]
struct FocusProgress {
    state: FocusProgressState,
    completed: u64,
    total: u64,
}

impl Default for FocusProgress {
    fn default() -> Self {
        Self {
            state: FocusProgressState::None,
            completed: 0,
            total: 1,
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct TaskbarState {
    progress: Arc<Mutex<FocusProgress>>,
    #[cfg(windows)]
    ready: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowMaterial {
    System,
    Solid,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowTheme {
    Dark,
    Light,
}

#[derive(Debug, Serialize)]
pub struct MaterialResult {
    /// Whether the documented system-backdrop API is supported by this OS.
    supported: bool,
    /// Native material was accepted; DWM may still suppress it for accessibility.
    applied: bool,
    error: Option<String>,
}

/// Call before creating windows so installed shortcuts and Jump Lists share an ID.
pub fn prepare_process_identity() {
    #[cfg(windows)]
    if let Err(error) = platform::prepare_process_identity() {
        super::diagnostics::write("identity_warning", error.to_string());
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Pedro", true, None::<&str>)?;
    let home = MenuItem::with_id(app, "home", "Hoje", true, None::<&str>)?;
    let routine = MenuItem::with_id(app, "routine", "Rotinas", true, None::<&str>)?;
    let music = MenuItem::with_id(app, "music", "Música", true, None::<&str>)?;
    let finance = MenuItem::with_id(app, "finance", "Finanças", true, None::<&str>)?;
    let appearance = MenuItem::with_id(app, "appearance", "Aparência", true, None::<&str>)?;
    let sections = Submenu::with_items(
        app,
        "Ir para",
        true,
        &[&home, &routine, &music, &finance, &appearance],
    )?;
    let fixed = CheckMenuItem::with_id(app, "fixed", "Fixa", true, true, None::<&str>)?;
    let hybrid = CheckMenuItem::with_id(app, "hybrid", "Híbrida", true, false, None::<&str>)?;
    let visibility = Submenu::with_items(app, "Visibilidade da ilha", true, &[&fixed, &hybrid])?;
    let dock = CheckMenuItem::with_id(
        app,
        "dock",
        "Mostrar atalhos no desktop",
        true,
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Sair do Pedro", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_end = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &sections,
            &separator,
            &visibility,
            &dock,
            &separator_end,
            &quit,
        ],
    )?;

    let state = app.try_state::<DesktopMenuState>()
        .ok_or_else(|| std::io::Error::other("O estado do menu não está disponível."))?;
    state.0.lock().unwrap_or_else(|error| error.into_inner()).items = Some(DesktopMenuItems { fixed, hybrid, dock });
    // Keep pending preferences received while main/dock WebViews were created.
    apply_menu_state(app).map_err(std::io::Error::other)?;
    let taskbar = app.try_state::<TaskbarState>()
        .ok_or_else(|| std::io::Error::other("O estado da taskbar não está disponível."))?.inner().clone();

    // generate_context normally supplies the ICO. The packaged PNG is an explicit
    // fallback so a missing optional config icon never leaves an invisible tray.
    let icon = app
        .default_window_icon()
        .cloned()
        .map(Ok)
        .unwrap_or_else(|| {
            tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
        })?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Agente Pedro · duplo clique para abrir")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = super::abrir_painel(app.clone(), "home".into());
            }
            page @ ("home" | "routine" | "music" | "finance" | "appearance") => {
                let _ = super::abrir_painel(app.clone(), page.into());
            }
            "fixed" | "hybrid" => {
                let mode = if event.id.as_ref() == "fixed" {
                    IslandMode::Fixed
                } else {
                    IslandMode::Hybrid
                };
                let dock = menu_preferences(app).map(|preferences| preferences.dock).unwrap_or(false);
                let _ = sync_menu(app, mode, dock);
                let value = if mode == IslandMode::Fixed {
                    "fixed"
                } else {
                    "hybrid"
                };
                let _ = app.emit(
                    "pedro:preferences-patch",
                    serde_json::json!({"islandVisibility": value}),
                );
            }
            "dock" => {
                let Some(preferences) = menu_preferences(app) else { return; };
                let enabled = !preferences.dock;
                let _ = sync_menu(app, preferences.mode, enabled);
                let _ = app.emit(
                    "pedro:preferences-patch",
                    serde_json::json!({"dockEnabled": enabled}),
                );
            }
            "quit" => {
                super::diagnostics::write("quit", "Sair selecionado na bandeja");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                let _ = super::abrir_painel(tray.app_handle().clone(), "home".into());
            }
        })
        .build(app);
    if let Err(error) = tray {
        // Shell availability must not take down local data, music or Alt+Space.
        super::diagnostics::write("tray_warning", error.to_string());
    }

    #[cfg(windows)]
    {
        if let Some(main) = app.get_webview_window("main") {
            if let Err(error) = platform::init_taskbar(&main, taskbar) {
                super::diagnostics::write("taskbar_warning", error);
            }
        }
        // A development executable must never replace the installed app's Jump
        // List targets with temporary target/debug paths. Release installs alone
        // update the shared AppUserModelID. Shell policies can disable the list.
        if !cfg!(debug_assertions) {
            std::thread::spawn(|| {
                if let Err(error) = platform::install_jump_list() {
                    super::diagnostics::write("jump_list_warning", error);
                }
            });
        }
    }
    Ok(())
}

/// Explicit panel launch remains available even if optional menu creation failed.
pub fn handle_initial_launch(app: &AppHandle) {
    let args: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let page = {
        let Some(state) = app.try_state::<DesktopLaunchState>() else { return; };
        let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
        let selected = initial_launch_page(&args, pending.as_deref());
        *pending = selected.clone();
        selected
    };
    if let Some(page) = page {
        if let Err(error) = super::abrir_painel(app.clone(), page) {
            super::diagnostics::write("launch_warning", error);
        }
    }
}

fn sync_menu(app: &AppHandle, mode: IslandMode, dock: bool) -> Result<(), String> {
    let state = app.try_state::<DesktopMenuState>()
        .ok_or_else(|| "O menu desktop não está disponível nesta execução.".to_string())?;
    state.0.lock().unwrap_or_else(|error| error.into_inner()).preferences = MenuPreferences { mode, dock };
    // Read the latest values on the UI thread; queued old commands do not reset
    // a newer selection. Release state locks before any native menu operation.
    let ui = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = apply_menu_state(&ui) {
            super::diagnostics::write("menu_warning", error);
        }
    }).map_err(|error| error.to_string())
}

fn menu_preferences(app: &AppHandle) -> Option<MenuPreferences> {
    let state = app.try_state::<DesktopMenuState>()?;
    let preferences = state.0.lock().unwrap_or_else(|error| error.into_inner()).preferences;
    Some(preferences)
}

fn apply_menu_state(app: &AppHandle) -> Result<(), String> {
    let state = app.try_state::<DesktopMenuState>()
        .ok_or_else(|| "O menu desktop não está disponível nesta execução.".to_string())?;
    let (items, preferences) = {
        let runtime = state.0.lock().unwrap_or_else(|error| error.into_inner());
        (runtime.items.clone(), runtime.preferences)
    };
    let Some(items) = items else { return Ok(()); };
    items.fixed.set_checked(preferences.mode == IslandMode::Fixed).map_err(|error| error.to_string())?;
    items.hybrid.set_checked(preferences.mode == IslandMode::Hybrid).map_err(|error| error.to_string())?;
    items.dock.set_checked(preferences.dock).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn configure_desktop_menu(
    app: AppHandle,
    island_visibility: IslandMode,
    dock_enabled: bool,
) -> Result<(), String> {
    sync_menu(&app, island_visibility, dock_enabled)
}

fn launch_page(args: &[String]) -> Option<&str> {
    let page = args
        .windows(2)
        .find(|pair| pair[0] == "--page")?
        .get(1)?
        .as_str();
    matches!(
        page,
        "home" | "routine" | "music" | "finance" | "appearance"
    )
    .then_some(page)
}

fn initial_launch_page(args: &[String], pending: Option<&str>) -> Option<String> {
    // A later request from a second process represents the user's newest intent.
    pending.or_else(|| launch_page(args)).map(str::to_owned)
}

fn remember_page(app: &AppHandle, page: &str) {
    if let Some(state) = app.try_state::<DesktopLaunchState>() {
        *state.0.lock().unwrap_or_else(|error| error.into_inner()) = Some(page.into());
    }
}

/// Called by the single-instance plugin; never launches another database/media worker.
pub fn handle_launch_args(app: &AppHandle, args: &[String]) {
    super::diagnostics::write("second_instance", "Encaminhando abertura ao processo existente");
    let page = launch_page(args).unwrap_or("home");
    remember_page(app, page);
    let _ = super::abrir_painel(app.clone(), page.into());
}

/// The initial frontend may not have listeners when the process starts from a
/// Jump List. Main consumes the pending route once its React tree is mounted.
#[tauri::command]
pub fn desktop_initial_page(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("O destino inicial pertence ao painel.".into());
    }
    Ok(app
        .state::<DesktopLaunchState>()
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take())
}

#[tauri::command]
pub fn apply_window_material(
    window: WebviewWindow,
    material: WindowMaterial,
    theme: WindowTheme,
) -> Result<MaterialResult, String> {
    if !matches!(window.label(), "main" | "island" | "dock") {
        return Err("A janela não aceita materiais do Pedro.".into());
    }
    // Native backdrops fill the whole HWND, including the transparent shadow
    // margins and the larger frame prepared for an island animation. Until a
    // coordinated native clipping strategy is validated, widgets keep their CSS
    // surface and genuine transparent margins; Mica applies only to the panel.
    if window.label() != "main" {
        return Ok(MaterialResult {
            supported: false,
            applied: false,
            error: None,
        });
    }
    #[cfg(windows)]
    {
        platform::apply_material(&window, material, theme)
    }
    #[cfg(not(windows))]
    {
        let _ = (material, theme);
        Ok(MaterialResult {
            supported: false,
            applied: false,
            error: None,
        })
    }
}

fn normalized_progress(
    state: FocusProgressState,
    completed: u64,
    total: u64,
) -> Result<FocusProgress, String> {
    if state != FocusProgressState::None && total == 0 {
        return Err("A duração do foco deve ser maior que zero.".into());
    }
    Ok(FocusProgress {
        state,
        completed: completed.min(total),
        total: total.max(1),
    })
}

#[tauri::command]
pub fn focus_taskbar_progress(
    app: AppHandle,
    window: WebviewWindow,
    state: FocusProgressState,
    completed: u64,
    total: u64,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Somente o painel atualiza o progresso do próprio ícone.".into());
    }
    let progress = normalized_progress(state, completed, total)?;
    let taskbar = app.try_state::<TaskbarState>()
        .ok_or_else(|| "O progresso no ícone não está disponível nesta execução.".to_string())?
        .inner().clone();
    *taskbar
        .progress
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = progress;
    #[cfg(windows)]
    {
        let app_for_ui = app.clone();
        app.run_on_main_thread(move || {
            if let Some(main) = app_for_ui.get_webview_window("main") {
                if let Ok(hwnd) = main.hwnd() {
                    // Cache until Explorer explicitly announces this button.
                    if taskbar.ready.load(std::sync::atomic::Ordering::Acquire) {
                        let _ = platform::apply_progress(
                            windows::Win32::Foundation::HWND(hwnd.0),
                            &taskbar,
                        );
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::atomic::Ordering;
    use windows::{
        core::{w, Interface, HSTRING},
        Win32::{
            Foundation::{E_INVALIDARG, HWND, LPARAM, LRESULT, RPC_E_CHANGED_MODE, WPARAM},
            Graphics::Dwm::{
                DwmSetWindowAttribute, DWMSBT_MAINWINDOW, DWMSBT_NONE, DWMWA_SYSTEMBACKDROP_TYPE,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
            },
            Storage::EnhancedStorage::PKEY_Title,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, StructuredStorage::PROPVARIANT,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::{
                Shell::{
                    Common::{IObjectArray, IObjectCollection},
                    DefSubclassProc, DestinationList, EnumerableObjectCollection,
                    ICustomDestinationList, IShellLinkW, ITaskbarList3,
                    PropertiesSystem::{IPropertyStore, PSCoerceToCanonicalValue},
                    RemoveWindowSubclass, SetCurrentProcessExplicitAppUserModelID,
                    SetWindowSubclass, ShellLink, TaskbarList, TBPF_NOPROGRESS, TBPF_NORMAL,
                    TBPF_PAUSED,
                },
                WindowsAndMessaging::{RegisterWindowMessageW, WM_NCDESTROY},
            },
        },
    };

    const TASKBAR_SUBCLASS: usize = 0x5045_4452;

    struct ComApartment(bool);
    impl ComApartment {
        fn initialize() -> windows::core::Result<Self> {
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result == RPC_E_CHANGED_MODE {
                // An existing apartment is valid; do not balance someone else's initialization.
                Ok(Self(false))
            } else {
                result.ok()?;
                Ok(Self(true))
            }
        }
    }
    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn prepare_process_identity() -> windows::core::Result<()> {
        unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_ID)) }
    }

    pub fn apply_material(
        window: &WebviewWindow,
        material: WindowMaterial,
        theme: WindowTheme,
    ) -> Result<MaterialResult, String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = HWND(hwnd.0);
        let dark: i32 = if theme == WindowTheme::Dark { 1 } else { 0 };
        let backdrop = match material {
            WindowMaterial::Solid => DWMSBT_NONE,
            WindowMaterial::System => DWMSBT_MAINWINDOW,
        };
        unsafe {
            // These attributes are documented; unsupported builds reject them.
            // Do not fall back to undocumented SetWindowCompositionAttribute.
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &dark as *const _ as _,
                std::mem::size_of_val(&dark) as u32,
            );
            match DwmSetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE,
                &backdrop as *const _ as _,
                std::mem::size_of_val(&backdrop) as u32,
            ) {
                Ok(()) => Ok(MaterialResult {
                    supported: true,
                    applied: material == WindowMaterial::System,
                    error: None,
                }),
                Err(error) => {
                    // If a previously applied effect now fails, remove it as far
                    // as the OS allows. CSS must fall back to its solid surface.
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_SYSTEMBACKDROP_TYPE,
                        &DWMSBT_NONE as *const _ as _,
                        std::mem::size_of_val(&DWMSBT_NONE) as u32,
                    );
                    let unsupported = error.code() == E_INVALIDARG;
                    Ok(MaterialResult {
                        supported: !unsupported,
                        applied: false,
                        error: if unsupported {
                            None
                        } else {
                            Some(format!("Material do Windows indisponível: {error}"))
                        },
                    })
                }
            }
        }
    }

    struct TaskbarContext {
        created_message: u32,
        state: TaskbarState,
    }

    pub fn init_taskbar(window: &WebviewWindow, state: TaskbarState) -> Result<(), String> {
        let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
        let created_message = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
        if created_message == 0 {
            return Err("Não foi possível registrar o aviso do ícone.".into());
        }
        let context = Box::new(TaskbarContext {
            created_message,
            state,
        });
        let raw = Box::into_raw(context);
        if unsafe {
            SetWindowSubclass(hwnd, Some(taskbar_subclass), TASKBAR_SUBCLASS, raw as usize)
        }
        .as_bool()
        {
            Ok(())
        } else {
            unsafe {
                drop(Box::from_raw(raw));
            }
            Err("Não foi possível observar o ícone do painel.".into())
        }
    }

    unsafe extern "system" fn taskbar_subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        // This Box belongs only to the main window's subclass. WM_NCDESTROY
        // removes the subclass and frees it; it is never used afterwards.
        if message == WM_NCDESTROY {
            let context = unsafe { Box::from_raw(data as *mut TaskbarContext) };
            context.state.ready.store(false, Ordering::Release);
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(taskbar_subclass), id);
            }
            drop(context);
        } else {
            let context = unsafe { &*(data as *const TaskbarContext) };
            if message == context.created_message {
                context.state.ready.store(true, Ordering::Release);
                let _ = apply_progress(hwnd, &context.state);
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn apply_progress(hwnd: HWND, state: &TaskbarState) -> windows::core::Result<()> {
        let progress = *state
            .progress
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let _apartment = ComApartment::initialize()?;
        unsafe {
            let taskbar: ITaskbarList3 =
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
            taskbar.HrInit()?;
            let flags = match progress.state {
                FocusProgressState::None => TBPF_NOPROGRESS,
                FocusProgressState::Running => TBPF_NORMAL,
                FocusProgressState::Paused => TBPF_PAUSED,
            };
            taskbar.SetProgressState(hwnd, flags)?;
            if progress.state != FocusProgressState::None {
                taskbar.SetProgressValue(hwnd, progress.completed, progress.total)?;
            }
            Ok(())
        }
    }

    pub fn install_jump_list() -> Result<(), String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        // HSTRING preserves Windows paths, including non-ASCII installation directories.
        use std::os::windows::ffi::OsStrExt;
        let executable =
            HSTRING::from_wide(&executable.as_os_str().encode_wide().collect::<Vec<_>>());
        let _apartment = ComApartment::initialize().map_err(|error| error.to_string())?;
        unsafe {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| error.to_string())?;
            list.SetAppID(&HSTRING::from(APP_ID))
                .map_err(|error| error.to_string())?;
            let mut slots = 0;
            let _removed: IObjectArray = list
                .BeginList(&mut slots)
                .map_err(|error| error.to_string())?;
            // These are fixed application tasks, not recent documents/categories.
            // Removed destinations do not restrict user tasks per Shell's contract.
            let result = (|| -> windows::core::Result<()> {
                let tasks: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                for (page, title) in [
                    ("routine", "Rotinas"),
                    ("music", "Música"),
                    ("finance", "Finanças"),
                ] {
                    let link: IShellLinkW =
                        CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                    link.SetPath(&executable)?;
                    link.SetArguments(&HSTRING::from(format!("--page {page}")))?;
                    link.SetIconLocation(&executable, 0)?;
                    link.SetDescription(&HSTRING::from(format!("Abrir {title} no Agente Pedro")))?;
                    let properties: IPropertyStore = link.cast()?;
                    let mut title = PROPVARIANT::from(title);
                    PSCoerceToCanonicalValue(&PKEY_Title, &mut title)?;
                    properties.SetValue(&PKEY_Title, &title)?;
                    properties.Commit()?;
                    tasks.AddObject(&link)?;
                }
                let tasks: IObjectArray = tasks.cast()?;
                list.AddUserTasks(&tasks)?;
                list.CommitList()
            })();
            if result.is_err() {
                let _ = list.AbortList();
            }
            result.map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    #[test]
    fn launch_routes_accept_only_known_pages() {
        assert_eq!(
            launch_page(&args(&["pedro.exe", "--page", "music"])),
            Some("music")
        );
        assert_eq!(
            launch_page(&args(&["pedro.exe", "--page", "routine"])),
            Some("routine")
        );
        assert_eq!(
            launch_page(&args(&["pedro.exe", "--page", "finance"])),
            Some("finance")
        );
        assert_eq!(
            launch_page(&args(&["pedro.exe", "--page", "https://example.com"])),
            None
        );
        assert_eq!(launch_page(&args(&["pedro.exe", "--page"])), None);
        assert_eq!(launch_page(&args(&["pedro.exe"])), None);
    }

    #[test]
    fn launch_during_startup_keeps_the_latest_route() {
        let first = args(&["pedro.exe", "--page", "routine"]);
        assert_eq!(
            initial_launch_page(&first, Some("music")),
            Some("music".into())
        );
        assert_eq!(initial_launch_page(&first, None), Some("routine".into()));
        assert_eq!(
            initial_launch_page(&args(&["pedro.exe"]), Some("finance")),
            Some("finance".into())
        );
    }

    #[test]
    fn active_focus_rejects_zero_duration_and_clamps_overdue_completion() {
        assert!(normalized_progress(FocusProgressState::Running, 0, 0).is_err());
        assert!(normalized_progress(FocusProgressState::Paused, 1, 0).is_err());
        let progress = normalized_progress(FocusProgressState::Running, 1600, 1500).unwrap();
        assert_eq!(progress.state, FocusProgressState::Running);
        assert_eq!(progress.completed, 1500);
        assert_eq!(progress.total, 1500);
        assert!(normalized_progress(FocusProgressState::None, 0, 0).is_ok());
    }
}
