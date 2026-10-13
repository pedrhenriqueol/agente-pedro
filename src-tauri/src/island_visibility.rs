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

const REVEAL_DWELL_MS: u64 = 600;

#[derive(Clone, Copy, Debug, Default)]
struct Observation {
    near_island: bool,
    at_reveal_edge: bool,
    fullscreen: bool,
}

#[derive(Debug)]
struct VisibilityPolicy {
    mode: IslandVisibilityMode,
    delay_ms: u64,
    visible: bool,
    reason: VisibilityReason,
    last_activity_ms: u64,
    edge_armed: bool,
    edge_entered_ms: Option<u64>,
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
            edge_armed: false,
            edge_entered_ms: None,
            fullscreen_reveal: false,
        }
    }
}

impl VisibilityPolicy {
    fn configure(&mut self, mode: IslandVisibilityMode, delay_seconds: u32, now_ms: u64) {
        if self.mode != mode {
            self.edge_entered_ms = None;
            self.edge_armed = false;
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

    fn hide(&mut self, observation: Observation, reason: VisibilityReason) {
        self.visible = false;
        self.reason = reason;
        self.fullscreen_reveal = false;
        self.edge_entered_ms = None;
        // A cursor already parked on the edge must leave before it can reveal.
        self.edge_armed = !observation.at_reveal_edge;
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
        if !observation.at_reveal_edge {
            self.edge_armed = true;
            self.edge_entered_ms = None;
        } else if self.edge_armed {
            let entered = *self.edge_entered_ms.get_or_insert(now_ms);
            if now_ms.saturating_sub(entered) >= REVEAL_DWELL_MS {
                self.visible = true;
                self.reason = VisibilityReason::Reveal;
                self.last_activity_ms = now_ms;
                self.fullscreen_reveal = observation.fullscreen;
                self.edge_armed = false;
                self.edge_entered_ms = None;
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

fn pointer_regions(window: Bounds, monitor: Bounds, scale: f64) -> (Bounds, Bounds) {
    // The transparent frame contains 12 logical pixels of shadow; a 6px
    // tolerance keeps nearby pointer movement from causing an abrupt hide.
    let inset = (6.0 * scale).round() as i32;
    let near = Bounds {
        left: window.left.saturating_add(inset),
        top: window.top.saturating_add(inset),
        right: window.right.saturating_sub(inset),
        bottom: window.bottom.saturating_sub(inset),
    };
    let center = (i64::from(window.left) + i64::from(window.right)) / 2;
    let half_width = (90.0 * scale).round() as i32;
    let edge = Bounds {
        left: (center as i32).saturating_sub(half_width).max(monitor.left),
        top: monitor.top,
        right: (center as i32)
            .saturating_add(half_width)
            .min(monitor.right),
        bottom: monitor
            .top
            .saturating_add((6.0 * scale).round().max(1.0) as i32),
    };
    (near, edge)
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
        }
    }
}

struct Runtime {
    policy: VisibilityPolicy,
    snapshot: IslandVisibilitySnapshot,
    epoch: Instant,
    generation: u64,
    pending: Option<u64>,
    error_source: Option<VisibilityErrorSource>,
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
            error_source: None,
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
}

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
        if runtime.policy.visible == runtime.snapshot.visible {
            let before = runtime.snapshot.clone();
            runtime.snapshot.reason = runtime.policy.reason;
            event = runtime.changed(&before);
            None
        } else if runtime.pending == Some(runtime.generation) {
            None
        } else {
            let generation = runtime.generation;
            runtime.pending = Some(generation);
            Some(generation)
        }
    };
    emit(app, event);
    let Some(generation) = request else {
        return;
    };
    let ui_app = app.clone();
    let ui_state = state.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let event = {
            let mut runtime = ui_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            if runtime.generation != generation {
                if runtime.pending == Some(generation) {
                    runtime.pending = None;
                }
                return;
            }
            let before = runtime.snapshot.clone();
            let target = runtime.policy.visible;
            // Keep this short critical section on the UI thread so a new
            // preference cannot race a stale hide/show operation.
            match platform::apply(&ui_app, target) {
                Ok((actual_visible, error)) => {
                    runtime.snapshot.visible = actual_visible;
                    runtime.error_source = error.as_ref().map(|_| VisibilityErrorSource::Window);
                    runtime.snapshot.error = error;
                    if actual_visible == target {
                        runtime.snapshot.reason = runtime.policy.reason;
                    }
                }
                Err(error) => {
                    runtime.snapshot.error = Some(error);
                    runtime.error_source = Some(VisibilityErrorSource::Window);
                }
            }
            runtime.pending = None;
            runtime.changed(&before)
        };
        emit(&ui_app, event);
    }) {
        state
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending = None;
        report_error(
            app,
            state,
            format!("Não foi possível atualizar a janela da ilha: {error}"),
            VisibilityErrorSource::Window,
        );
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::thread;
    use std::time::Duration;
    use tauri::LogicalSize;
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

    fn observe(raw: usize) -> Result<Observation, String> {
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
            let (near, edge) = pointer_regions(bounds(window_rect), bounds(info.rcMonitor), scale);
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor).map_err(|error| error.to_string())?;
            let mut observation = Observation {
                near_island: near.contains(cursor.x, cursor.y),
                at_reveal_edge: edge.contains(cursor.x, cursor.y),
                fullscreen: false,
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
            Ok(observation)
        }
    }

    fn actual_visibility(raw: usize) -> bool {
        unsafe { IsWindowVisible(hwnd(raw)).as_bool() }
    }

    // Called only inside AppHandle::run_on_main_thread. ShowWindow's return is
    // the *previous* visibility, so confirm the result with IsWindowVisible.
    pub(super) fn apply(app: &AppHandle, visible: bool) -> Result<(bool, Option<String>), String> {
        let island = app
            .get_webview_window("island")
            .ok_or_else(|| "A janela da ilha não está disponível.".to_string())?;
        let raw = island.hwnd().map_err(|error| error.to_string())?.0 as usize;
        let native = hwnd(raw);
        let mut error = None;
        if visible {
            if let Err(size_error) = island.set_size(LogicalSize::new(404.0, 72.0)) {
                return Ok((
                    unsafe { IsWindowVisible(native).as_bool() },
                    Some(size_error.to_string()),
                ));
            }
            // SW_SHOWNOACTIVATE preserves the foreground application and keyboard focus.
            unsafe {
                let _ = ShowWindow(native, SW_SHOWNOACTIVATE);
            }
        } else {
            // Real native hiding removes the entire hit target, including shadows.
            unsafe {
                let _ = ShowWindow(native, SW_HIDE);
            }
            if let Err(size_error) = island.set_size(LogicalSize::new(404.0, 72.0)) {
                error = Some(size_error.to_string());
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
                    match observe(raw) {
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
                                runtime.policy.tick(observation, now);
                                if prior != (runtime.policy.visible, runtime.policy.reason) {
                                    runtime.generation = runtime.generation.wrapping_add(1);
                                }
                                // Read actual visibility under the same lock used by UI apply.
                                // A pre-lock sample could overwrite a confirmed hide/show with
                                // stale truth and emit a newer but incorrect revision.
                                runtime.snapshot.visible = actual_visibility(raw);
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
                    thread::sleep(Duration::from_millis(200));
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
                at_reveal_edge: false,
            },
            200,
        );
        assert!(!policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Fullscreen);
    }

    #[test]
    fn deliberate_edge_dwell_reveals_in_fullscreen_and_interaction_keeps_it_visible() {
        let mut policy = hybrid();
        policy.tick(
            Observation {
                fullscreen: true,
                ..Default::default()
            },
            200,
        );
        let edge = Observation {
            at_reveal_edge: true,
            fullscreen: true,
            near_island: false,
        };
        policy.tick(edge, 400);
        policy.tick(edge, 999);
        assert!(!policy.visible);
        policy.tick(edge, 1_000);
        assert!(policy.visible);
        assert_eq!(policy.reason, VisibilityReason::Reveal);
        policy.tick(
            Observation {
                near_island: true,
                fullscreen: true,
                at_reveal_edge: false,
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
            at_reveal_edge: true,
            ..Default::default()
        };
        policy.tick(edge, 3_000);
        policy.tick(edge, 10_000);
        assert!(!policy.visible);
        policy.tick(Observation::default(), 10_200);
        policy.tick(edge, 10_400);
        policy.tick(edge, 11_000);
        assert!(policy.visible);
    }

    #[test]
    fn briefly_crossing_the_reveal_edge_does_not_reveal() {
        let mut policy = hybrid();
        policy.tick(Observation::default(), 3_000);
        let edge = Observation {
            at_reveal_edge: true,
            ..Default::default()
        };
        policy.tick(edge, 3_200);
        policy.tick(Observation::default(), 3_400);
        policy.tick(edge, 3_600);
        policy.tick(edge, 4_199);
        assert!(!policy.visible);
        policy.tick(edge, 4_200);
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
        let (near, edge) = pointer_regions(island, monitor, 1.5);
        assert_eq!(
            edge,
            Bounds {
                left: -1415,
                top: -1440,
                right: -1145,
                bottom: -1431
            }
        );
        assert!(edge.contains(-1280, -1440));
        assert!(!edge.contains(-1280, -1431));
        assert!(near.contains(-1280, -1040));
        assert!(!near.contains(-1582, -1436));
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
