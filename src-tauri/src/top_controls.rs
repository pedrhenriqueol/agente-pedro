//! Small, independently bounded Pedro controls at the desktop's top corners.
//! These are ordinary owned WebViews; no Explorer or Windows Shell state changes.
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

// BEGIN portable top control policy
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side { Left, Right }

impl Side {
    fn parse(label: &str) -> Result<Self, String> {
        match label {
            "top-left" => Ok(Self::Left),
            "top-right" => Ok(Self::Right),
            _ => Err("Esse controle de desktop não existe.".into()),
        }
    }
    fn label(self) -> &'static str { if self == Self::Left { "top-left" } else { "top-right" } }
    fn index(self) -> usize { if self == Self::Left { 0 } else { 1 } }
    fn compact_width(self) -> f64 { if self == Self::Left { 128.0 } else { 90.0 } }
    fn maximum_width(self) -> f64 { if self == Self::Left { 384.0 } else { 304.0 } }
    fn reservation(self) -> crate::widget_region::Reservation {
        crate::widget_region::Reservation {
            anchor: if self == Self::Left { crate::widget_region::Anchor::Left } else { crate::widget_region::Anchor::Right },
            maximum_width: self.maximum_width(), maximum_height: 424.0,
            horizontal_inset: 2.0, top_inset: 2.0, bottom_inset: 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct TopControlSnapshot {
    visible: bool,
    expanded: bool,
    width: f64,
    height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    viewport: Option<crate::widget_frame::NativeViewport>,
}

impl TopControlSnapshot {
    fn compact(side: Side) -> Self {
        Self { visible: false, expanded: false, width: side.compact_width(), height: 46.0, viewport: None }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Request { side: Side, generation: u64, value: TopControlSnapshot }

struct Slot { generation: u64, desired: TopControlSnapshot, applied: TopControlSnapshot }

impl Slot {
    fn new(side: Side) -> Self {
        Self { generation: 0, desired: TopControlSnapshot::compact(side), applied: TopControlSnapshot::compact(side) }
    }
}

struct Policy { ready: bool, slots: [Slot; 2] }

impl Default for Policy {
    fn default() -> Self { Self { ready: false, slots: [Slot::new(Side::Left), Slot::new(Side::Right)] } }
}

impl Policy {
    fn request(&mut self, side: Side, value: TopControlSnapshot) -> Option<Request> {
        let slot = &mut self.slots[side.index()];
        slot.generation = slot.generation.wrapping_add(1);
        slot.desired = value;
        self.ready.then(|| self.current(side))
    }
    fn current(&self, side: Side) -> Request {
        let slot = &self.slots[side.index()];
        Request { side, generation: slot.generation, value: slot.desired }
    }
    fn accepts(&self, request: Request) -> bool { self.ready && self.current(request.side) == request }
    fn start(&mut self) -> [Request; 2] {
        self.ready = true;
        [self.current(Side::Left), self.current(Side::Right)]
    }
}

fn dimensions(side: Side, visible: bool, expanded: bool, width: f64, height: f64) -> Result<TopControlSnapshot, String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("As dimensões do controle de desktop não são válidas.".into());
    }
    if !expanded || !visible {
        return Ok(TopControlSnapshot { visible, ..TopControlSnapshot::compact(side) });
    }
    Ok(TopControlSnapshot { visible, expanded: true,
        width: width.clamp(side.compact_width(), side.maximum_width()), height: height.clamp(46.0, 424.0), viewport: None })
}

// END portable top control policy

#[derive(Clone, Default)]
pub struct TopControlsState { inner: Arc<Mutex<Policy>> }

/// The state must be managed on the Builder, before WebView creation can pump IPC.
#[tauri::command]
pub async fn configure_top_control(app: AppHandle, window: WebviewWindow, label: String,
    visible: bool, expanded: bool, width: f64, height: f64) -> Result<TopControlSnapshot, String> {
    let side = Side::parse(&label)?;
    if window.label() != side.label() {
        return Err("Somente o próprio controle pode atualizar sua janela.".into());
    }
    let desired = dimensions(side, visible, expanded, width, height)?;
    let state = app.try_state::<TopControlsState>()
        .ok_or_else(|| "O controle de desktop ainda não está disponível.".to_string())?.inner().clone();
    let request = state.inner.lock().unwrap_or_else(|error| error.into_inner()).request(side, desired);
    let Some(request) = request else { return Ok(desired); };
    let (response, mut receiver) = tauri::async_runtime::channel(1);
    schedule(&app, state, request, Some(response))?;
    receiver.recv().await.ok_or_else(|| "O runtime encerrou antes de confirmar o controle de desktop.".to_string())?
}

pub fn init(app: &AppHandle) {
    let Some(state) = app.try_state::<TopControlsState>() else {
        crate::diagnostics::write("top_controls_warning", "Estado de controles de desktop indisponível");
        return;
    };
    let state = state.inner().clone();
    let requests = state.inner.lock().unwrap_or_else(|error| error.into_inner()).start();
    for request in requests {
        if let Err(error) = schedule(app, state.clone(), request, None) {
            crate::diagnostics::write("top_controls_warning", error);
        }
    }
}

/// Called on the native UI thread when the island is physically hidden. This
/// also protects the desktop if a corner WebView misses the visibility event.
pub(crate) fn hide_with_island(app: &AppHandle) {
    let Some(state) = app.try_state::<TopControlsState>() else { return; };
    for side in [Side::Left, Side::Right] {
        let request = state.inner.lock().unwrap_or_else(|error| error.into_inner())
            .request(side, TopControlSnapshot::compact(side));
        if let Some(request) = request {
            match apply(app, request) {
                Ok(value) => {
                    let mut policy = state.inner.lock().unwrap_or_else(|error| error.into_inner());
                    if policy.accepts(request) { policy.slots[side.index()].applied = value; }
                },
                Err(error) => crate::diagnostics::write("top_controls_warning", error),
            }
        }
    }
}

fn schedule(app: &AppHandle, state: TopControlsState, request: Request,
    response: Option<tauri::async_runtime::Sender<Result<TopControlSnapshot, String>>>) -> Result<(), String> {
    let ui_app = app.clone();
    app.run_on_main_thread(move || {
        let accepted = state.inner.lock().unwrap_or_else(|error| error.into_inner()).accepts(request);
        let result = if accepted {
            // ShowWindow / WebView resize can dispatch nested window messages.
            // Never hold a policy lock across a native operation.
            let result = apply(&ui_app, request);
            let mut policy = state.inner.lock().unwrap_or_else(|error| error.into_inner());
            if policy.accepts(request) {
                if let Ok(value) = result { policy.slots[request.side.index()].applied = value; }
            }
            result
        } else { Ok(state.inner.lock().unwrap_or_else(|error| error.into_inner()).slots[request.side.index()].applied) };
        if let Err(error) = &result { crate::diagnostics::write("top_controls_warning", error); }
        if let Some(response) = response { let _ = response.try_send(result); }
    }).map_err(|error| format!("Não foi possível atualizar o controle na thread da interface: {error}"))
}

fn current_request(app: &AppHandle, request: Request) -> bool {
    app.try_state::<TopControlsState>().is_some_and(|state| state.inner.lock().unwrap_or_else(|error| error.into_inner()).accepts(request))
}
fn ensure_current(app: &AppHandle, request: Request) -> Result<(), String> {
    if current_request(app, request) { Ok(()) } else { Err("A solicitação do controle de desktop foi substituída.".into()) }
}

fn apply(app: &AppHandle, request: Request) -> Result<TopControlSnapshot, String> {
    let window = app.get_webview_window(request.side.label())
        .ok_or_else(|| "A janela do controle de desktop não está disponível.".to_string())?;
    let previous_frame = crate::widget_frame::capture(&window)?;
    let previous_logical = crate::widget_frame::logical_footprint(&window);
    let previous_generation = crate::widget_frame::generation(&window)?;
    let previously_visible = actual_visible(&window)?;
    let result = apply_frame(app, &window, request);
    if result.is_err() {
        // A newer request owns both presentation and input. Its failure path
        // must never restore or reveal a previous request's frame.
        if !current_request(app, request) { return result; }
        let current_generation = crate::widget_frame::generation(&window)?;
        if current_generation != previous_generation && current_generation != previous_generation.wrapping_add(1) { return result; }
        // A failure after region/frame preparation must never leave an expanded transparent hit
        // target while the caller still renders only its compact notch.
        let visible = request.value.visible && previously_visible && app.try_state::<crate::island_visibility::IslandVisibilityState>()
            .is_none_or(|state| crate::island_visibility::is_visible(&state));
        let rollback = (|| {
            ensure_current(app, request)?;
            crate::widget_frame::restore(&window, previous_frame, previous_logical, current_generation)?;
            ensure_current(app, request)?;
            window.set_ignore_cursor_events(!visible).map_err(|error| error.to_string())?;
            ensure_current(app, request)?;
            set_native_visible(&window, visible)
        })();
        if let Err(error) = rollback {
            if !current_request(app, request) { return result; }
            // Even if restoring bounds fails, relinquish the desktop natively.
            let _ = window.set_ignore_cursor_events(true);
            if !current_request(app, request) { return result; }
            let _ = set_native_visible(&window, false);
            crate::diagnostics::write("top_controls_warning", format!("Falha ao restaurar o controle: {error}"));
        }
    }
    result
}

fn apply_frame(app: &AppHandle, window: &WebviewWindow, request: Request) -> Result<TopControlSnapshot, String> {
    let mut value = request.value;
    if value.visible && app.try_state::<crate::island_visibility::IslandVisibilityState>()
        .is_some_and(|state| !crate::island_visibility::is_visible(&state)) {
        value = TopControlSnapshot::compact(request.side);
    }
    if value.visible {
        let monitor = app.get_webview_window("island").and_then(|island| island.current_monitor().ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten())
            .ok_or_else(|| "O monitor do controle de desktop não está disponível.".to_string())?;
        let area = monitor.work_area();
        let geometry = crate::widget_region::layout(crate::widget_region::PixelRect {
            x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height,
        }, monitor.scale_factor(), request.side.reservation(), value.width, value.height);
        crate::widget_frame::set_frame(window, geometry, monitor.scale_factor())?;
        let frame = crate::widget_frame::snapshot(geometry, monitor.scale_factor());
        value.width = frame.width;
        value.height = frame.height;
        value.viewport = frame.viewport;
    }
    ensure_current(app, request)?;
    let cursor = window.set_ignore_cursor_events(!value.visible)
        .map_err(|error| format!("Não foi possível atualizar a interação nativa do controle: {error}"));
    if value.visible { cursor.as_ref().map_err(Clone::clone)?; }
    ensure_current(app, request)?;
    set_native_visible(window, value.visible)?;
    ensure_current(app, request)?;
    cursor?;
    Ok(value)
}

pub(crate) fn reframe(app: &AppHandle, label: &str, width: f64, height: f64) -> Result<(), String> {
    let side = Side::parse(label)?;
    let window = app.get_webview_window(label).ok_or_else(|| "O controle de desktop não está disponível.".to_string())?;
    let monitor = app.get_webview_window("island").and_then(|island| island.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "O monitor do controle de desktop não está disponível.".to_string())?;
    let area = monitor.work_area();
    let geometry = crate::widget_region::layout(crate::widget_region::PixelRect {
        x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height,
    }, monitor.scale_factor(), side.reservation(), width, height);
    crate::widget_frame::set_frame(&window, geometry, monitor.scale_factor())
}

fn actual_visible(window: &WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        let handle = window.hwnd().map_err(|error| error.to_string())?;
        Ok(unsafe { IsWindowVisible(HWND(handle.0 as *mut _)).as_bool() })
    }
    #[cfg(not(target_os = "windows"))]
    { window.is_visible().map_err(|error| error.to_string()) }
}

fn set_native_visible(window: &WebviewWindow, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE};
        let handle = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = HWND(handle.0 as *mut _);
        unsafe {
            let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
            if IsWindowVisible(hwnd).as_bool() != visible {
                return Err("O Windows não confirmou a visibilidade do controle de desktop.".into());
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if visible { window.show() } else { window.hide() }.map_err(|error| error.to_string())?;
        if window.is_visible().map_err(|error| error.to_string())? != visible {
            return Err("O sistema não confirmou a visibilidade do controle de desktop.".into());
        }
    }
    Ok(())
}

// BEGIN portable top control tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_the_two_owned_corner_labels() {
        assert_eq!(Side::parse("top-left").unwrap(), Side::Left);
        assert_eq!(Side::parse("top-right").unwrap(), Side::Right);
        for invalid in ["main", "island", "dock", "", "../top-left"] { assert!(Side::parse(invalid).is_err()); }
    }
    #[test]
    fn invalid_dimensions_are_rejected_and_popups_are_bounded() {
        for width in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(dimensions(Side::Left, true, true, width, 200.0).is_err());
        }
        let large = dimensions(Side::Left, true, true, 5000.0, 5000.0).unwrap();
        assert_eq!((large.width, large.height), (384.0, 424.0));
        let hidden = dimensions(Side::Right, false, true, 500.0, 400.0).unwrap();
        assert_eq!(hidden, TopControlSnapshot::compact(Side::Right));
    }
    #[test]
    fn early_requests_are_saved_without_accessing_windows_before_setup() {
        let mut policy = Policy::default();
        let shown = dimensions(Side::Left, true, false, 128.0, 46.0).unwrap();
        assert!(policy.request(Side::Left, shown).is_none());
        policy.request(Side::Right, dimensions(Side::Right, false, false, 90.0, 46.0).unwrap());
        let requests = policy.start();
        assert!(requests[0].value.visible);
        assert!(!requests[1].value.visible);
    }
    #[test]
    fn stale_open_does_not_undo_a_later_hide_or_change_the_other_corner() {
        let mut policy = Policy::default();
        policy.start();
        let open = policy.request(Side::Left, dimensions(Side::Left, true, true, 384.0, 424.0).unwrap()).unwrap();
        let right = policy.request(Side::Right, dimensions(Side::Right, true, false, 90.0, 46.0).unwrap()).unwrap();
        let hide = policy.request(Side::Left, TopControlSnapshot::compact(Side::Left)).unwrap();
        assert!(!policy.accepts(open));
        assert!(policy.accepts(hide));
        assert!(policy.accepts(right));
    }
    #[test]
    fn corners_stay_inside_negative_origin_work_areas_at_mixed_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for side in [Side::Left, Side::Right] {
                let request = dimensions(side, true, true, 384.0, 424.0).unwrap();
                let geometry = crate::widget_region::layout(crate::widget_region::PixelRect {
                    x: -1920, y: 40, width: 1920, height: 1040,
                }, scale, side.reservation(), request.width, request.height);
                let x = geometry.viewport.x + geometry.region.x;
                let y = geometry.viewport.y + geometry.region.y;
                assert!(x >= -1920 && y >= 40);
                assert!(x + geometry.region.width as i32 <= 0);
                assert!(y + geometry.region.height as i32 <= 1080);
            }
        }
        let geometry = crate::widget_region::layout(crate::widget_region::PixelRect {
            x: 0, y: 0, width: 160, height: 140,
        }, 2.0, Side::Right.reservation(), 304.0, 424.0);
        assert!(geometry.viewport.x + geometry.region.x + geometry.region.width as i32 <= 160);
        assert!(geometry.viewport.y + geometry.region.y + geometry.region.height as i32 <= 140);
    }
}
// END portable top control tests
