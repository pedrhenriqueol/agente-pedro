//! Hybrid visibility runs outside the webview, including while its window is
//! hidden. Only explicit pointer/keyboard activity extends the idle deadline.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

// BEGIN portable visibility policy
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandVisibilityMode {
    Fixed,
    Hybrid,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VisibilityReason {
    Fixed,
    Idle,
    Fullscreen,
    Reveal,
}

const REVEAL_DWELL_MS: u64 = 120;

#[derive(Clone, Copy, Debug, Default)]
struct Observation {
    near_island: bool,
    in_reveal_region: bool,
    fullscreen: bool,
    control_interaction: bool,
}

impl Observation {
    fn with_controls(mut self, pointer_inside_visible_control: bool) -> Self {
        self.near_island |= pointer_inside_visible_control;
        self.control_interaction = pointer_inside_visible_control;
        self
    }
}

#[derive(Debug)]
struct VisibilityPolicy {
    mode: IslandVisibilityMode,
    delay_ms: u64,
    visible: bool,
    reason: VisibilityReason,
    last_activity_ms: u64,
    reveal_armed: bool,
    reveal_entered_ms: Option<u64>,
    fullscreen_reveal: bool,
}

impl Default for VisibilityPolicy {
    fn default() -> Self {
        Self {
            mode: IslandVisibilityMode::Fixed,
            delay_ms: 3_000,
            visible: true,
            reason: VisibilityReason::Fixed,
            last_activity_ms: 0,
            reveal_armed: false,
            reveal_entered_ms: None,
            fullscreen_reveal: false,
        }
    }
}

impl VisibilityPolicy {
    fn configure(&mut self, mode: IslandVisibilityMode, delay_seconds: u32, now_ms: u64) {
        if self.mode != mode {
            self.reveal_entered_ms = None;
            self.reveal_armed = false;
            self.fullscreen_reveal = false;
            self.last_activity_ms = now_ms;
            if mode == IslandVisibilityMode::Hybrid {
                self.reason = VisibilityReason::Reveal;
            }
        }
        self.mode = mode;
        self.delay_ms = u64::from(delay_seconds) * 1_000;
        if mode == IslandVisibilityMode::Fixed {
            self.visible = true;
            self.reason = VisibilityReason::Fixed;
        }
    }

    fn activity(&mut self, now_ms: u64) {
        // A stale focus event from a hidden webview cannot reveal the window.
        if self.visible {
            self.last_activity_ms = now_ms;
        }
    }

    fn cancel_idle_exit(&mut self, near_island: bool, now_ms: u64) {
        // The window is still visible during its exit animation. A genuine
        // return to the surface reverses an idle exit before native hiding.
        // Fullscreen exits keep the leave-and-return protection below.
        if !self.visible && near_island && self.reason == VisibilityReason::Idle {
            self.visible = true;
            self.reason = VisibilityReason::Reveal;
            self.last_activity_ms = now_ms;
            self.reveal_armed = false;
            self.reveal_entered_ms = None;
        }
    }

    fn hide(&mut self, observation: Observation, reason: VisibilityReason) {
        self.visible = false;
        self.reason = reason;
        self.fullscreen_reveal = false;
        self.reveal_entered_ms = None;
        // A cursor already parked in the dormant region must leave before it can reveal.
        self.reveal_armed = !observation.in_reveal_region;
    }

    fn tick(&mut self, observation: Observation, now_ms: u64) {
        if self.mode == IslandVisibilityMode::Fixed {
            self.visible = true;
            self.reason = VisibilityReason::Fixed;
            return;
        }
        if !observation.fullscreen {
            self.fullscreen_reveal = false;
        }
        if self.visible {
            // A visible top control is another intentional way to interact.
            // Preserve fullscreen's identity while moving between controls and
            // the center, then apply the ordinary inactivity deadline.
            if observation.control_interaction && observation.fullscreen {
                self.fullscreen_reveal = true;
            }
            if observation.fullscreen && !self.fullscreen_reveal {
                self.hide(observation, VisibilityReason::Fullscreen);
            } else {
                if observation.near_island {
                    self.activity(now_ms);
                }
                if now_ms.saturating_sub(self.last_activity_ms) >= self.delay_ms {
                    self.hide(
                        observation,
                        if observation.fullscreen {
                            VisibilityReason::Fullscreen
                        } else {
                            VisibilityReason::Idle
                        },
                    );
                }
            }
            return;
        }
        if !observation.in_reveal_region {
            self.reveal_armed = true;
            self.reveal_entered_ms = None;
        } else if self.reveal_armed {
            let entered = *self.reveal_entered_ms.get_or_insert(now_ms);
            if now_ms.saturating_sub(entered) >= REVEAL_DWELL_MS {
                self.visible = true;
                self.reason = VisibilityReason::Reveal;
                self.last_activity_ms = now_ms;
                self.fullscreen_reveal = observation.fullscreen;
                self.reveal_armed = false;
                self.reveal_entered_ms = None;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl Bounds {
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    fn covers(self, other: Self, tolerance: i32) -> bool {
        self.left <= other.left.saturating_add(tolerance)
            && self.top <= other.top.saturating_add(tolerance)
            && self.right >= other.right.saturating_sub(tolerance)
            && self.bottom >= other.bottom.saturating_sub(tolerance)
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct CompactFrame {
    pub width: f64,
    pub height: f64,
}

impl Default for CompactFrame {
    fn default() -> Self {
        Self { width: 120.0, height: 48.0 }
    }
}

fn pointer_regions(window: Bounds, monitor: Bounds, scale: f64, compact: CompactFrame) -> (Bounds, Bounds) {
    // The transparent frame contains 12 logical pixels of shadow; a 6px
    // tolerance keeps nearby pointer movement from causing an abrupt hide.
    let inset = (6.0 * scale).round() as i32;
    let near = Bounds {
        left: window.left.saturating_add(inset),
        top: window.top.saturating_add(inset),
        right: window.right.saturating_sub(inset),
        bottom: window.bottom.saturating_sub(inset),
    };
    // Observe the compact capsule's former position, including its proximity.
    // This is global cursor observation, never an invisible input window. It
    // follows work-area positioning (e.g. a top taskbar), not monitor.top alone.
    // An expanded last rect must not create a tall reveal target over apps.
    let proximity = (12.0 * scale).round() as i32;
    let compact_height = (compact.height * scale).round() as i32;
    let compact_width = (compact.width * scale).round() as i32;
    let compact_left = window.left + ((window.right - window.left) - compact_width) / 2;
    let reveal = Bounds {
        left: compact_left.saturating_sub(proximity).max(monitor.left),
        top: window.top.saturating_sub(proximity).max(monitor.top),
        right: compact_left.saturating_add(compact_width).saturating_add(proximity).min(monitor.right),
        bottom: window.top.saturating_add(compact_height).saturating_add(proximity).min(monitor.bottom),
    };
    (near, reveal)
}

fn foreground_covers_island(
    foreground: Bounds,
    monitor: Bounds,
    island: Bounds,
    maximized: bool,
    same_monitor: bool,
    scale: f64,
) -> bool {
    let tolerance = (2.0 * scale).round() as i32;
    foreground.covers(monitor, tolerance)
        || (maximized && same_monitor && foreground.covers(island, tolerance))
}
// END portable visibility policy

// BEGIN portable visibility animation gate
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandVisibilityTransition {
    pub generation: u64,
    pub visible: bool,
    pub duration_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandVisibilitySnapshot {
    pub revision: u64,
    pub supported: bool,
    pub mode: IslandVisibilityMode,
    pub delay_seconds: u32,
    pub visible: bool,
    pub reason: VisibilityReason,
    pub error: Option<String>,
    pub transition: Option<IslandVisibilityTransition>,
}

impl Default for IslandVisibilitySnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            supported: cfg!(windows),
            mode: IslandVisibilityMode::Fixed,
            delay_seconds: 3,
            visible: true,
            reason: VisibilityReason::Fixed,
            error: None,
            transition: None,
        }
    }
}

struct Runtime {
    policy: VisibilityPolicy,
    snapshot: IslandVisibilitySnapshot,
    epoch: Instant,
    generation: u64,
    pending: Option<u64>,
    applying: bool,
    transition_deadline_ms: Option<u64>,
    error_source: Option<VisibilityErrorSource>,
    compact_frame: CompactFrame,
}

#[derive(Clone, Copy, PartialEq)]
enum VisibilityErrorSource {
    Observation,
    Window,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            policy: VisibilityPolicy::default(),
            snapshot: IslandVisibilitySnapshot::default(),
            epoch: Instant::now(),
            generation: 0,
            pending: None,
            applying: false,
            transition_deadline_ms: None,
            error_source: None,
            compact_frame: CompactFrame::default(),
        }
    }
}

impl Runtime {
    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }

    fn changed(&mut self, before: &IslandVisibilitySnapshot) -> Option<IslandVisibilitySnapshot> {
        if self.snapshot != *before {
            self.snapshot.revision = self.snapshot.revision.wrapping_add(1);
            Some(self.snapshot.clone())
        } else {
            None
        }
    }

    fn completion_target(&self, generation: u64) -> Option<bool> {
        let transition = self.snapshot.transition.as_ref()?;
        (!self.applying && self.generation == generation && self.pending == Some(generation)
            && transition.generation == generation && transition.visible == self.policy.visible)
            .then_some(transition.visible)
    }

    fn expired_generation(&self, now_ms: u64) -> Option<u64> {
        let generation = self.pending?;
        (now_ms >= self.transition_deadline_ms? && self.completion_target(generation).is_some())
            .then_some(generation)
    }
}
// END portable visibility animation gate

#[derive(Clone, Default)]
pub struct IslandVisibilityState {
    inner: Arc<Mutex<Runtime>>,
}

#[tauri::command]
pub fn island_visibility_snapshot(
    state: State<'_, IslandVisibilityState>,
) -> IslandVisibilitySnapshot {
    state
        .inner
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .snapshot
        .clone()
}

/// Used by resizing IPC to avoid an expansion arriving after a native hide.
pub fn is_visible(state: &IslandVisibilityState) -> bool {
    let runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    runtime.policy.visible && runtime.snapshot.visible
}

pub(crate) fn remember_compact_frame(state: &IslandVisibilityState, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("Dimensões inválidas para a ilha.".into());
    }
    let mut runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    runtime.compact_frame = CompactFrame { width: width.clamp(96.0, 304.0), height: height.clamp(48.0, 72.0) };
    Ok(())
}

#[tauri::command]
pub fn complete_island_visibility_transition(app: AppHandle, state: State<'_, IslandVisibilityState>, generation: u64) {
    #[cfg(windows)]
    complete_transition(&app, &state, generation);
    #[cfg(not(windows))]
    let _ = (app, state, generation);
}

#[tauri::command]
pub fn configure_island_visibility(
    app: AppHandle,
    state: State<'_, IslandVisibilityState>,
    mode: IslandVisibilityMode,
    delay_seconds: u32,
) -> Result<IslandVisibilitySnapshot, String> {
    if !matches!(delay_seconds, 3 | 5 | 10) {
        return Err("O prazo para ocultar a ilha deve ser 3, 5 ou 10 segundos.".into());
    }
    let event = {
        let mut runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = runtime.snapshot.clone();
        let now = runtime.now_ms();
        runtime.policy.configure(
            if cfg!(windows) {
                mode
            } else {
                IslandVisibilityMode::Fixed
            },
            delay_seconds,
            now,
        );
        runtime.snapshot.mode = mode;
        runtime.snapshot.delay_seconds = delay_seconds;
        runtime.generation = runtime.generation.wrapping_add(1);
        if !cfg!(windows) {
            runtime.snapshot.visible = true;
            runtime.snapshot.reason = VisibilityReason::Fixed;
        }
        runtime.changed(&before)
    };
    emit(&app, event);
    #[cfg(windows)]
    reconcile(&app, &state);
    Ok(state
        .inner
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .snapshot
        .clone())
}

#[tauri::command]
pub fn island_activity(state: State<'_, IslandVisibilityState>) {
    let mut runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let now = runtime.now_ms();
    runtime.policy.activity(now);
}

fn emit(app: &AppHandle, snapshot: Option<IslandVisibilitySnapshot>) {
    if let Some(snapshot) = snapshot {
        let _ = app.emit("pedro:island-visibility", snapshot);
    }
}

pub fn start(app: &AppHandle) {
    #[cfg(windows)]
    platform::start(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
fn report_error(
    app: &AppHandle,
    state: &IslandVisibilityState,
    message: String,
    source: VisibilityErrorSource,
) {
    let event = {
        let mut runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = runtime.snapshot.clone();
        runtime.snapshot.error = Some(message);
        runtime.error_source = Some(source);
        runtime.changed(&before)
    };
    emit(app, event);
}

#[cfg(windows)]
fn reconcile(app: &AppHandle, state: &IslandVisibilityState) {
    let mut event = None;
    let request = {
        let mut runtime = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if runtime.applying || runtime.pending == Some(runtime.generation) {
            None
        } else if runtime.policy.visible == runtime.snapshot.visible && runtime.snapshot.transition.is_none()
            && runtime.error_source != Some(VisibilityErrorSource::Window) {
            let before = runtime.snapshot.clone();
            runtime.snapshot.reason = runtime.policy.reason;
            runtime.pending = None;
            runtime.transition_deadline_ms = None;
            event = runtime.changed(&before);
            None
        } else {
            let generation = runtime.generation;
            runtime.pending = Some(generation);
            Some(generation)
        }
    };
    emit(app, event);
    let Some(generation) = request else { return; };
    let ui_app = app.clone();
    let ui_state = state.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let (target, compact, was_visible) = {
            let mut runtime = ui_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            if runtime.generation != generation || runtime.applying {
                if runtime.pending == Some(generation) { runtime.pending = None; }
                return;
            }
            runtime.applying = true;
            (runtime.policy.visible, runtime.compact_frame, runtime.snapshot.visible)
        };
        // Native calls can pump WebView messages that query this same state.
        // They must run outside the mutex, with generation checked afterwards.
        let update = if target {
            platform::apply(&ui_app, true, compact)
        } else {
            match platform::release_input(&ui_app) {
                Ok(()) => Ok((was_visible, None)),
                Err(_) => platform::apply(&ui_app, false, compact),
            }
        };
        let event = {
            let mut runtime = ui_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            runtime.applying = false;
            if runtime.generation != generation {
                if runtime.pending == Some(generation) { runtime.pending = None; }
                drop(runtime);
                reconcile(&ui_app, &ui_state);
                return;
            }
            let before = runtime.snapshot.clone();
            match update {
                Ok((actual_visible, error)) => {
                    runtime.snapshot.visible = actual_visible;
                    runtime.error_source = error.as_ref().map(|_| VisibilityErrorSource::Window);
                    runtime.snapshot.error = error;
                    runtime.snapshot.reason = runtime.policy.reason;
                    if actual_visible {
                        runtime.snapshot.transition = Some(IslandVisibilityTransition {
                            generation, visible: target, duration_ms: if target { 200 } else { 180 },
                        });
                        runtime.transition_deadline_ms = Some(runtime.now_ms().saturating_add(240));
                    } else {
                        runtime.snapshot.transition = None;
                        runtime.pending = None;
                        runtime.transition_deadline_ms = None;
                    }
                }
                Err(error) => {
                    runtime.snapshot.error = Some(error);
                    runtime.error_source = Some(VisibilityErrorSource::Window);
                    runtime.snapshot.transition = None;
                    runtime.pending = None;
                    runtime.transition_deadline_ms = None;
                }
            }
            runtime.changed(&before)
        };
        if event.as_ref().is_some_and(|snapshot| !snapshot.visible) {
            // Release Runtime's mutex before taking the controls policy lock.
            // A missing corner WebView event cannot leave a native ghost target.
            crate::top_controls::hide_with_island(&ui_app);
        }
        emit(&ui_app, event);
    }) {
        state.inner.lock().unwrap_or_else(|e| e.into_inner()).pending = None;
        report_error(app, state, format!("Não foi possível atualizar a janela da ilha: {error}"), VisibilityErrorSource::Window);
    }
}

#[cfg(windows)]
fn complete_transition(app: &AppHandle, state: &IslandVisibilityState, generation: u64) {
    let ui_app = app.clone();
    let ui_state = state.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let (target, compact) = {
            let mut runtime = ui_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            let Some(target) = runtime.completion_target(generation) else { return; };
            runtime.applying = true;
            (target, runtime.compact_frame)
        };
        let update = if target { None } else { Some(platform::apply(&ui_app, false, compact)) };
        let event = {
            let mut runtime = ui_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            runtime.applying = false;
            if runtime.generation != generation {
                if runtime.pending == Some(generation) { runtime.pending = None; }
                drop(runtime);
                reconcile(&ui_app, &ui_state);
                return;
            }
            let before = runtime.snapshot.clone();
            if let Some(update) = update {
                match update {
                    Ok((actual_visible, error)) => {
                        runtime.snapshot.visible = actual_visible;
                        runtime.snapshot.error = error;
                        runtime.error_source = runtime.snapshot.error.as_ref().map(|_| VisibilityErrorSource::Window);
                    }
                    Err(error) => {
                        runtime.snapshot.error = Some(error);
                        runtime.error_source = Some(VisibilityErrorSource::Window);
                    }
                }
            }
            runtime.snapshot.transition = None;
            runtime.pending = None;
            runtime.transition_deadline_ms = None;
            runtime.changed(&before)
        };
        if event.as_ref().is_some_and(|snapshot| !snapshot.visible) {
            crate::top_controls::hide_with_island(&ui_app);
        }
        emit(&ui_app, event);
    }) {
        report_error(app, state, format!("Não foi possível concluir a transição da ilha: {error}"), VisibilityErrorSource::Window);
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::thread;
    use std::time::Duration;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, IsZoomed, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
    };

    fn bounds(rect: RECT) -> Bounds {
        Bounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }

    fn hwnd(raw: usize) -> HWND {
        HWND(raw as *mut std::ffi::c_void)
    }

    fn observe(app: &AppHandle, raw: usize, compact: CompactFrame) -> Result<Observation, String> {
        unsafe {
            let island = hwnd(raw);
            let mut window_rect = RECT::default();
            GetWindowRect(island, &mut window_rect).map_err(|error| error.to_string())?;
            let monitor = MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return Err("O Windows não forneceu os limites do monitor da ilha.".into());
            }
            let scale = f64::from(GetDpiForWindow(island).max(96)) / 96.0;
            let (near, reveal) = pointer_regions(bounds(window_rect), bounds(info.rcMonitor), scale, compact);
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor).map_err(|error| error.to_string())?;
            let mut observation = Observation {
                near_island: near.contains(cursor.x, cursor.y),
                in_reveal_region: reveal.contains(cursor.x, cursor.y),
                fullscreen: false,
                control_interaction: false,
            };
            let foreground = GetForegroundWindow();
            let mut process_id = 0;
            GetWindowThreadProcessId(foreground, Some(&mut process_id));
            if !foreground.0.is_null()
                && process_id != std::process::id()
                && IsWindowVisible(foreground).as_bool()
                && !IsIconic(foreground).as_bool()
            {
                let mut class_buffer = [0u16; 128];
                let length = GetClassNameW(foreground, &mut class_buffer).max(0) as usize;
                let class = String::from_utf16_lossy(&class_buffer[..length]);
                if !matches!(
                    class.as_str(),
                    "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
                ) {
                    let mut rect = RECT::default();
                    if GetWindowRect(foreground, &mut rect).is_ok() {
                        observation.fullscreen = foreground_covers_island(
                            bounds(rect),
                            bounds(info.rcMonitor),
                            near,
                            IsZoomed(foreground).as_bool(),
                            MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) == monitor,
                            scale,
                        );
                    }
                }
            }
            let pointer_inside_control = ["top-left", "top-right"].iter().any(|label| {
                let Some(control) = app.get_webview_window(label) else { return false; };
                let Ok(handle) = control.hwnd() else { return false; };
                if !IsWindowVisible(handle).as_bool() { return false; }
                let mut rect = RECT::default();
                GetWindowRect(handle, &mut rect).is_ok() && bounds(rect).contains(cursor.x, cursor.y)
            });
            Ok(observation.with_controls(pointer_inside_control))
        }
    }

    fn actual_visibility(raw: usize) -> bool {
        unsafe { IsWindowVisible(hwnd(raw)).as_bool() }
    }

    // Called only inside AppHandle::run_on_main_thread. ShowWindow's return is
    // the *previous* visibility, so confirm the result with IsWindowVisible.
    pub(super) fn release_input(app: &AppHandle) -> Result<(), String> {
        app.get_webview_window("island")
            .ok_or_else(|| "A janela da ilha não está disponível.".to_string())?
            .set_ignore_cursor_events(true).map_err(|error| error.to_string())
    }

    pub(super) fn apply(app: &AppHandle, visible: bool, compact: CompactFrame) -> Result<(bool, Option<String>), String> {
        let island = app
            .get_webview_window("island")
            .ok_or_else(|| "A janela da ilha não está disponível.".to_string())?;
        let raw = island.hwnd().map_err(|error| error.to_string())?.0 as usize;
        let native = hwnd(raw);
        let mut error = None;
        if visible {
            if !unsafe { IsWindowVisible(native).as_bool() } {
                if let Err(size_error) = crate::resize_island_frame(app, compact.width, compact.height) {
                    return Ok((false, Some(size_error)));
                }
            }
            island.set_ignore_cursor_events(false).map_err(|error| error.to_string())?;
            // SW_SHOWNOACTIVATE preserves the foreground application and keyboard focus.
            unsafe {
                let _ = ShowWindow(native, SW_SHOWNOACTIVATE);
            }
        } else {
            // Real native hiding removes the entire hit target, including shadows.
            unsafe {
                let _ = ShowWindow(native, SW_HIDE);
            }
            if let Err(size_error) = crate::resize_island_frame(app, compact.width, compact.height) {
                error = Some(size_error);
            }
        }
        let actual = unsafe { IsWindowVisible(native).as_bool() };
        if actual != visible {
            error = Some("O Windows não confirmou a alteração de visibilidade da ilha.".into());
        }
        Ok((actual, error))
    }

    pub(super) fn start(app: &AppHandle) {
        let state = app.state::<IslandVisibilityState>().inner().clone();
        let raw = match app
            .get_webview_window("island")
            .and_then(|window| window.hwnd().ok())
        {
            Some(handle) => handle.0 as usize,
            None => {
                report_error(
                    app,
                    &state,
                    "A janela nativa da ilha não está disponível.".into(),
                    VisibilityErrorSource::Window,
                );
                return;
            }
        };
        let worker_app = app.clone();
        let worker_state = state.clone();
        if let Err(error) = thread::Builder::new()
            .name("pedro-island-visibility".into())
            .spawn(move || {
                loop {
                    let compact = worker_state.inner.lock().unwrap_or_else(|e| e.into_inner()).compact_frame;
                    match observe(&worker_app, raw, compact) {
                        Ok(observation) => {
                            let event = {
                                let mut runtime =
                                    worker_state.inner.lock().unwrap_or_else(|e| e.into_inner());
                                let before = runtime.snapshot.clone();
                                if runtime.error_source == Some(VisibilityErrorSource::Observation)
                                {
                                    runtime.snapshot.error = None;
                                    runtime.error_source = None;
                                }
                                let prior = (runtime.policy.visible, runtime.policy.reason);
                                let now = runtime.now_ms();
                                if runtime.snapshot.visible && runtime.snapshot.transition.as_ref().is_some_and(|transition| !transition.visible) {
                                    runtime.policy.cancel_idle_exit(observation.near_island, now);
                                }
                                runtime.policy.tick(observation, now);
                                if prior != (runtime.policy.visible, runtime.policy.reason) {
                                    runtime.generation = runtime.generation.wrapping_add(1);
                                }
                                // Do not publish intermediate native state during a commit.
                                if !runtime.applying { runtime.snapshot.visible = actual_visibility(raw); }
                                runtime.changed(&before)
                            };
                            emit(&worker_app, event);
                            reconcile(&worker_app, &worker_state);
                        }
                        Err(error) => report_error(
                            &worker_app,
                            &worker_state,
                            format!("Não foi possível observar a ilha: {error}"),
                            VisibilityErrorSource::Observation,
                        ),
                    }
                    // A broken observation or unresponsive WebView cannot
                    // keep the native hit target alive after the exit deadline.
                    let expired = {
                        let runtime = worker_state.inner.lock().unwrap_or_else(|e| e.into_inner());
                        runtime.expired_generation(runtime.now_ms())
                    };
                    if let Some(generation) = expired {
                        complete_transition(&worker_app, &worker_state, generation);
                    }
                    thread::sleep(Duration::from_millis(80));
                }
            })
        {
            report_error(
                app,
                &state,
                format!("Não foi possível iniciar a visibilidade híbrida: {error}"),
                VisibilityErrorSource::Window,
            );
        }
    }
}

// BEGIN portable visibility tests
#[cfg(test)]
mod tests {
    use super::*;

    fn hybrid() -> VisibilityPolicy {
        let mut policy = VisibilityPolicy::default();
        policy.configure(IslandVisibilityMode::Hybrid, 3, 0);
        policy
    }

    #[test]
    fn fixed_remains_visible_and_restores_an_idle_hidden_island() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 3_000);
        assert!(!policy.visible);
        policy.configure(IslandVisibilityMode::Fixed, 3, 3_001);
        policy.tick(
            Observation {
                fullscreen: true,
                ..Default::default()
            },
            99_000,
        );
        assert!(policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Fixed);
    }

    #[test]
    fn inactivity_hides_at_the_configured_deadline_and_mouse_restarts_it() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 2_999);
        assert!(policy.visible);
        policy.tick(
            Observation {
                near_island: true,
                ..Default::default()
            },
            3_000,
        );
        policy.tick(Observation::default(), 5_999);
        assert!(policy.visible);
        policy.tick(Observation::default(), 6_000);
        assert!(!policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Idle);
    }

    #[test]
    fn keyboard_heartbeat_extends_only_the_current_visible_activity() {
        let mut policy = hybrid();
        policy.activity(2_500);
        policy.tick(Observation::default(), 5_499);
        assert!(policy.visible);
        policy.tick(Observation::default(), 5_500);
        assert!(!policy.visible);
        policy.activity(9_000);
        policy.tick(Observation::default(), 9_001);
        assert!(!policy.visible);
    }

    #[test]
    fn fullscreen_hides_even_when_the_mouse_is_over_the_island() {
        let mut policy = hybrid();
        policy.tick(
            Observation {
                near_island: true,
                fullscreen: true,
                in_reveal_region: false,
                control_interaction: false,
            },
            200,
        );
        assert!(!policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Fullscreen);
    }

    #[test]
    fn hover_in_former_capsule_reveals_in_fullscreen_and_interaction_keeps_it_visible() {
        let mut policy = hybrid();
        policy.tick(
            Observation {
                fullscreen: true,
                ..Default::default()
            },
            200,
        );
        let edge = Observation {
            in_reveal_region: true,
            fullscreen: true,
            near_island: false,
            control_interaction: false,
        };
        policy.tick(edge, 400);
        policy.tick(edge, 519);
        assert!(!policy.visible);
        policy.tick(edge, 520);
        assert!(policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Reveal);
        policy.tick(
            Observation {
                near_island: true,
                fullscreen: true,
                in_reveal_region: false,
                ..Default::default()
            },
            4_000,
        );
        assert!(policy.visible);
        policy.tick(
            Observation {
                fullscreen: true,
                ..Default::default()
            },
            6_999,
        );
        assert!(policy.visible);
        policy.tick(
            Observation {
                fullscreen: true,
                ..Default::default()
            },
            7_000,
        );
        assert!(!policy.visible);
    }

    #[test]
    fn a_cursor_inherited_at_hide_cannot_immediately_reveal_without_leaving() {
        let mut policy = hybrid();
        let edge = Observation {
            in_reveal_region: true,
            ..Default::default()
        };
        policy.tick(edge, 3_000);
        policy.tick(edge, 10_000);
        assert!(!policy.visible);
        policy.tick(Observation::default(), 10_200);
        policy.tick(edge, 10_400);
        policy.tick(edge, 10_520);
        assert!(policy.visible);
    }

    #[test]
    fn briefly_crossing_the_reveal_region_does_not_reveal() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 3_000);
        let edge = Observation {
            in_reveal_region: true,
            ..Default::default()
        };
        policy.tick(edge, 3_200);
        policy.tick(Observation::default(), 3_280);
        policy.tick(edge, 3_600);
        policy.tick(edge, 3_719);
        assert!(!policy.visible);
        policy.tick(edge, 3_720);
        assert!(policy.visible);
    }

    #[test]
    fn region_math_handles_high_dpi_negative_monitor_origins_and_expanded_islands() {
        let monitor = Bounds {
            left: -2_560,
            top: -1440,
            right: 0,
            bottom: 0,
        };
        let island = Bounds {
            left: -1_583,
            top: -1437,
            right: -977,
            bottom: -1011,
        };
        let (near, edge) = pointer_regions(island, monitor, 1.5, CompactFrame { width: 404.0, height: 72.0 });
        assert_eq!(
            edge,
            Bounds {
                left: -1601,
                top: -1440,
                right: -959,
                bottom: -1311
            }
        );
        assert!(edge.contains(-1280, -1440));
        assert!(edge.contains(-1280, -1390), "hover where the compact island appears");
        assert!(!edge.contains(-1280, -1300), "expanded body is not a reveal target");
        assert!(near.contains(-1280, -1040));
        assert!(!near.contains(-1582, -1436));
    }

    #[test]
    fn reveal_tracks_work_area_anchor_and_capsule_sides_at_each_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let monitor = Bounds { left: -3840, top: -2160, right: 0, bottom: 0 };
            // Simulate a taskbar along the top; island is below its work area.
            let left = -2400;
            let top = monitor.top + (42.0_f64 * scale).round() as i32;
            let island = Bounds {
                left, top, right: left + (404.0_f64 * scale).round() as i32,
                bottom: top + (424.0_f64 * scale).round() as i32,
            };
            let (_, reveal) = pointer_regions(island, monitor, scale, CompactFrame { width: 404.0, height: 72.0 });
            assert!(reveal.contains(left + (20.0_f64 * scale).round() as i32, top + (28.0_f64 * scale).round() as i32));
            assert!(reveal.contains(island.right - (20.0_f64 * scale).round() as i32, top + (28.0_f64 * scale).round() as i32));
            assert!(!reveal.contains(left, monitor.top), "unrelated taskbar edge is not the capsule");
            assert!(!reveal.contains(left + 50, top + (100.0_f64 * scale).round() as i32));
        }
    }

    #[test]
    fn returning_to_dormant_capsule_reveals_without_fixed_mode_or_keyboard() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 3_000);
        let hover = Observation { near_island: true, in_reveal_region: true, fullscreen: false, ..Default::default() };
        policy.tick(hover, 3_080);
        policy.tick(hover, 3_199);
        assert!(!policy.visible);
        policy.tick(hover, 3_200);
        assert!(policy.visible);
        assert_eq!(policy.mode, IslandVisibilityMode::Hybrid);
        assert_eq!(policy.reason, VisibilityReason::Reveal);
        policy.tick(hover, 9_000);
        assert!(policy.visible);
        policy.tick(Observation::default(), 11_999);
        assert!(policy.visible);
        policy.tick(Observation::default(), 12_000);
        assert!(!policy.visible);
    }

    #[test]
    fn expanded_wings_never_become_the_dormant_reveal_target() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let monitor = Bounds { left: -3840, top: -2160, right: 0, bottom: 0 };
            let center = -1920;
            let top = monitor.top + (42.0_f64 * scale).round() as i32;
            let half_width = (584.0_f64 * scale / 2.0).round() as i32;
            let expanded = Bounds { left: center - half_width, top, right: center + half_width,
                bottom: top + (424.0_f64 * scale).round() as i32 };
            for compact in [CompactFrame::default(), CompactFrame { width: 304.0, height: 60.0 }] {
                let (_, reveal) = pointer_regions(expanded, monitor, scale, compact);
                assert!(reveal.contains(center, top + (24.0_f64 * scale).round() as i32));
                assert!(!reveal.contains(expanded.left + (24.0_f64 * scale).round() as i32, top + 24));
                assert!(!reveal.contains(center, top + (100.0_f64 * scale).round() as i32));
                assert!(!reveal.contains(center, monitor.top), "the top taskbar is outside the dormant capsule");
            }
        }
    }

    #[test]
    fn pointer_return_can_reverse_an_idle_exit_but_not_a_fullscreen_exit() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 3_000);
        policy.cancel_idle_exit(false, 3_050);
        assert!(!policy.visible);
        policy.cancel_idle_exit(true, 3_100);
        assert!(policy.visible);
        policy.tick(Observation::default(), 6_099);
        assert!(policy.visible);
        policy.tick(Observation::default(), 6_100);
        assert!(!policy.visible);
        policy.configure(IslandVisibilityMode::Fixed, 3, 7_000);
        policy.configure(IslandVisibilityMode::Hybrid, 3, 7_000);
        policy.tick(Observation { fullscreen: true, in_reveal_region: true, near_island: true, ..Default::default() }, 7_100);
        policy.cancel_idle_exit(true, 7_200);
        assert!(!policy.visible, "fullscreen requires leaving and deliberately returning");
    }

    #[test]
    fn using_a_visible_corner_control_keeps_it_usable_over_a_maximized_app() {
        let mut policy = hybrid();
        let desktop = Observation { fullscreen: true, ..Default::default() };
        policy.tick(desktop.with_controls(true), 3_000);
        assert!(policy.visible);
        policy.tick(desktop.with_controls(true), 9_000);
        assert!(policy.visible, "pointer interaction refreshes the same idle deadline");
        policy.tick(Observation { fullscreen: true, near_island: true, ..Default::default() }, 9_080);
        assert!(policy.visible, "moving from a corner to the center preserves intentional interaction");
        policy.tick(desktop.with_controls(false), 12_079);
        assert!(policy.visible);
        policy.tick(desktop.with_controls(false), 12_080);
        assert!(!policy.visible, "inactivity suppression resumes outside visible controls");
        policy.tick(desktop.with_controls(false), 99_000);
        assert!(!policy.visible, "a hidden corner must not become an invisible reveal window");
    }

    fn exiting_runtime() -> Runtime {
        let mut runtime = Runtime::default();
        runtime.policy = hybrid();
        runtime.policy.tick(Observation::default(), 3_000);
        runtime.generation = 7;
        runtime.pending = Some(7);
        runtime.transition_deadline_ms = Some(3_240);
        runtime.snapshot.transition = Some(IslandVisibilityTransition { generation: 7, visible: false, duration_ms: 180 });
        runtime
    }

    #[test]
    fn a_late_exit_acknowledgement_cannot_hide_a_reversed_surface() {
        let mut runtime = exiting_runtime();
        assert_eq!(runtime.completion_target(7), Some(false));
        runtime.policy.cancel_idle_exit(true, 3_100);
        runtime.generation = 8;
        assert_eq!(runtime.completion_target(7), None);
        assert_eq!(runtime.expired_generation(3_500), None);
        runtime.pending = Some(8);
        runtime.snapshot.transition = Some(IslandVisibilityTransition { generation: 8, visible: true, duration_ms: 200 });
        assert_eq!(runtime.completion_target(7), None);
        assert_eq!(runtime.completion_target(8), Some(true));
    }

    #[test]
    fn missing_frontend_acknowledgement_times_out_only_the_current_transition() {
        let mut runtime = exiting_runtime();
        assert_eq!(runtime.expired_generation(3_239), None);
        assert_eq!(runtime.expired_generation(3_240), Some(7));
        runtime.pending = None;
        assert_eq!(runtime.expired_generation(9_000), None);
        runtime.pending = Some(7);
        runtime.snapshot.transition = None;
        assert_eq!(runtime.expired_generation(9_000), None);
    }

    #[test]
    fn a_show_acknowledgement_cannot_finish_a_subsequent_fullscreen_exit() {
        let mut runtime = exiting_runtime();
        runtime.policy.configure(IslandVisibilityMode::Fixed, 3, 3_050);
        runtime.generation = 8;
        runtime.pending = Some(8);
        runtime.snapshot.transition = Some(IslandVisibilityTransition { generation: 8, visible: true, duration_ms: 200 });
        assert_eq!(runtime.completion_target(8), Some(true));
        runtime.policy.configure(IslandVisibilityMode::Hybrid, 3, 3_100);
        runtime.policy.tick(Observation { fullscreen: true, ..Default::default() }, 3_150);
        runtime.generation = 9;
        assert_eq!(runtime.completion_target(8), None);
    }

    #[test]
    fn fullscreen_and_maximized_covering_the_island_hide_only_on_its_monitor() {
        let monitor = Bounds {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        };
        let island = Bounds {
            left: -1156,
            top: 14,
            right: -764,
            bottom: 62,
        };
        assert!(foreground_covers_island(
            monitor, monitor, island, false, true, 1.0
        ));
        let work_area = Bounds {
            bottom: 1040,
            ..monitor
        };
        assert!(foreground_covers_island(
            work_area, monitor, island, true, true, 1.0
        ));
        assert!(!foreground_covers_island(
            work_area, monitor, island, false, true, 1.0
        ));
        let other_monitor = Bounds {
            left: 0,
            right: 1920,
            ..monitor
        };
        assert!(!foreground_covers_island(
            other_monitor,
            monitor,
            island,
            true,
            false,
            1.0
        ));
        let below_island = Bounds {
            top: 200,
            ..monitor
        };
        assert!(!foreground_covers_island(
            below_island,
            monitor,
            island,
            true,
            true,
            1.0
        ));
    }

    #[test]
    fn borderless_fullscreen_spanning_monitors_covers_the_island_monitor() {
        let monitor = Bounds {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        };
        let island = Bounds {
            left: -1156,
            top: 14,
            right: -764,
            bottom: 62,
        };
        let spanning = Bounds {
            left: -1920,
            top: 0,
            right: 3840,
            bottom: 1080,
        };
        assert!(foreground_covers_island(
            spanning, monitor, island, false, false, 1.0
        ));
    }

    #[test]
    fn changing_delay_uses_actual_last_activity_and_clock_regression_is_safe() {
        let mut policy = hybrid();
        policy.activity(1_000);
        policy.configure(IslandVisibilityMode::Hybrid, 10, 2_000);
        policy.tick(Observation::default(), 500);
        assert!(policy.visible);
        policy.tick(Observation::default(), 10_999);
        assert!(policy.visible);
        policy.tick(Observation::default(), 11_000);
        assert!(!policy.visible);
    }
}
// END portable visibility tests
