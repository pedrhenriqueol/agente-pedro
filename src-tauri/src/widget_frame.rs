//! Keep the WebView viewport fixed; change only its native clipping/input region.
use tauri::{Manager, WebviewWindow};
use std::sync::Mutex;
use crate::widget_region::{FrameGeometry, FrameVersion, LogicalFootprint, PixelRect};

#[derive(Default)]
pub(crate) struct WidgetFrameState { inner: Mutex<[FrameVersion; 3]> }
const LABELS: [&str; 3] = ["island", "top-left", "top-right"];
fn index(label: &str) -> Option<usize> { LABELS.iter().position(|value| *value == label) }

pub(crate) fn generation(window: &WebviewWindow) -> Result<u64, String> {
    let slot = index(window.label()).ok_or_else(|| "O widget não possui uma reserva nativa.".to_string())?;
    let state = window.app_handle().try_state::<WidgetFrameState>()
        .ok_or_else(|| "A reserva do widget ainda não está disponível.".to_string())?;
    let generation = state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].generation;
    Ok(generation)
}

pub(crate) fn logical_footprint(window: &WebviewWindow) -> Option<LogicalFootprint> {
    let slot = index(window.label())?;
    let state = window.app_handle().try_state::<WidgetFrameState>()?;
    let logical = state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].logical;
    logical
}

/// WM_DPICHANGED is still executing when Tauri delivers ScaleFactorChanged.
/// Mark work only; MainEventsCleared runs after Tao's final native resize.
pub(crate) fn schedule_dpi(app: &tauri::AppHandle, label: &str) {
    let Some(slot) = index(label) else { return; };
    let Some(state) = app.try_state::<WidgetFrameState>() else { return; };
    state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].schedule_dpi();
}

pub(crate) fn refresh_pending(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<WidgetFrameState>() else { return; };
    let requests = {
        let mut frames = state.inner.lock().unwrap_or_else(|error| error.into_inner());
        [frames[0].take_dpi(), frames[1].take_dpi(), frames[2].take_dpi()]
    };
    for (slot, request) in requests.into_iter().enumerate() {
        let Some((generation, logical)) = request else { continue; };
        if state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].generation != generation { continue; }
        let result = if slot == 0 { crate::resize_island_frame(app, logical.width, logical.height).map(|_| ()) }
            else { crate::top_controls::reframe(app, LABELS[slot], logical.width, logical.height) };
        if let Err(error) = result {
            // A native failure must not schedule an unbounded DPI/rollback loop.
            let mut frames = state.inner.lock().unwrap_or_else(|error| error.into_inner());
            let applied_generation = frames[slot].generation;
            if applied_generation == generation.wrapping_add(1) { frames[slot].clear_dpi(applied_generation); }
            drop(frames);
            crate::diagnostics::write("widget_dpi_warning", error);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub(crate) struct NativeViewport { pub width: f64, pub height: f64 }

#[derive(serde::Serialize)]
pub(crate) struct WidgetViewport {
    /// The applied footprint, including its existing transparent shadow margin.
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<NativeViewport>,
}

pub(crate) fn snapshot(geometry: FrameGeometry, scale: f64) -> WidgetViewport {
    WidgetViewport {
        width: f64::from(geometry.region.width) / scale,
        height: f64::from(geometry.region.height) / scale,
        viewport: cfg!(windows).then_some(NativeViewport {
            width: f64::from(geometry.viewport.width) / scale,
            height: f64::from(geometry.viewport.height) / scale,
        }),
    }
}

/// Capture both pieces: restoring only outer bounds would lose the input region.
pub(crate) fn capture(window: &WebviewWindow) -> Result<FrameGeometry, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let mut frame = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut frame).map_err(|error| error.to_string())?; }
        let footprint = effective_bounds(hwnd)?;
        Ok(FrameGeometry {
            viewport: PixelRect { x: frame.left, y: frame.top, width: (frame.right - frame.left).max(1) as u32, height: (frame.bottom - frame.top).max(1) as u32 },
            region: PixelRect { x: footprint.left - frame.left, y: footprint.top - frame.top, width: (footprint.right - footprint.left).max(1) as u32, height: (footprint.bottom - footprint.top).max(1) as u32 },
        })
    }
    #[cfg(not(windows))]
    {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.inner_size().map_err(|error| error.to_string())?;
        Ok(FrameGeometry { viewport: PixelRect { x: position.x, y: position.y, width: size.width, height: size.height }, region: PixelRect { x: 0, y: 0, width: size.width, height: size.height } })
    }
}

/// Screen coordinates of the native region, never the unused reserved viewport.
#[cfg(windows)]
pub(crate) fn effective_bounds(hwnd: windows::Win32::Foundation::HWND) -> Result<windows::Win32::Foundation::RECT, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetWindowRgnBox, NULLREGION};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut frame = RECT::default();
    let mut region = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut frame).map_err(|error| error.to_string())?;
        let kind = GetWindowRgnBox(hwnd, &mut region);
        // Before initial preparation there is no custom region. Such a window
        // stays hidden until set_frame succeeds; preserve legacy capture here.
        if kind.0 == 0 { return Ok(frame); }
        if kind == NULLREGION { return Err("A região nativa do widget está vazia.".into()); }
    }
    Ok(RECT { left: frame.left.saturating_add(region.left), top: frame.top.saturating_add(region.top),
        right: frame.left.saturating_add(region.right), bottom: frame.top.saturating_add(region.bottom) })
}

pub(crate) fn set_frame(window: &WebviewWindow, geometry: FrameGeometry, scale: f64) -> Result<(), String> {
    let slot = index(window.label()).ok_or_else(|| "O widget não possui uma reserva nativa.".to_string())?;
    let state = window.app_handle().try_state::<WidgetFrameState>()
        .ok_or_else(|| "A reserva do widget ainda não está disponível.".to_string())?;
    let generation = state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].begin();
    let current = || state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].generation == generation;
    let logical = LogicalFootprint { width: f64::from(geometry.region.width) / scale, height: f64::from(geometry.region.height) / scale, scale };
    #[cfg(windows)]
    {
        let previous = capture(window).map_err(|error| {
            state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].abort(generation);
            error
        })?;
        if previous != geometry {
            if let Err(error) = apply(window, geometry, &current) {
                if !current() { return Err(error); }
                if apply(window, previous, &current).is_err() && current() {
                    // Never expose a full reserve if clipping/rollback fails.
                    fail_closed(window, &current);
                }
                state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].abort(generation);
                return Err(error);
            }
        }
        if !current() { return Err("A solicitação de geometria foi substituída.".into()); }
        state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].commit(generation, Some(logical));
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // No Windows region API: retain the prior small native frame behavior.
        window.set_position(tauri::PhysicalPosition::new(geometry.viewport.x + geometry.region.x, geometry.viewport.y + geometry.region.y)).map_err(|error| error.to_string())?;
        window.set_size(tauri::PhysicalSize::new(geometry.region.width, geometry.region.height)).map_err(|error| error.to_string())?;
        if current() { state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].commit(generation, Some(logical)); }
        Ok(())
    }
}

/// Restore the previous metadata together with its physical region after a
/// later cursor/show failure. A newer reentrant operation owns its own state.
pub(crate) fn restore(window: &WebviewWindow, geometry: FrameGeometry, logical: Option<LogicalFootprint>, expected_generation: u64) -> Result<(), String> {
    let slot = index(window.label()).ok_or_else(|| "O widget não possui uma reserva nativa.".to_string())?;
    let state = window.app_handle().try_state::<WidgetFrameState>()
        .ok_or_else(|| "A reserva do widget ainda não está disponível.".to_string())?;
    if state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].generation != expected_generation {
        return Err("A solicitação de restauração foi substituída.".into());
    }
    let generation = expected_generation.wrapping_add(1);
    let scale = match logical { Some(value) => value.scale, None => window.scale_factor().map_err(|error| error.to_string())? };
    set_frame(window, geometry, scale)?;
    let current_scale = window.scale_factor().map_err(|error| error.to_string())?;
    state.inner.lock().unwrap_or_else(|error| error.into_inner())[slot].restore(generation, logical, current_scale);
    Ok(())
}

#[cfg(windows)]
fn apply(window: &WebviewWindow, geometry: FrameGeometry, current: &impl Fn() -> bool) -> Result<(), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOOWNERZORDER, SWP_NOZORDER};
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let desired = geometry.viewport;
    let clip = geometry.region;
    let mut frame = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut frame).map_err(|error| error.to_string())?;
        if !current() { return Err("A solicitação de geometria foi substituída.".into()); }
        // Initial reservation and monitor/DPI changes are the only viewport
        // resizes. A normal open/close reaches SetWindowRgn without WM_SIZE.
        if frame.left != desired.x || frame.top != desired.y
            || frame.right - frame.left != desired.width as i32
            || frame.bottom - frame.top != desired.height as i32 {
            let mut flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER;
            if frame.right - frame.left != desired.width as i32 || frame.bottom - frame.top != desired.height as i32 { flags |= SWP_NOCOPYBITS; }
            SetWindowPos(hwnd, None, desired.x, desired.y, desired.width as i32, desired.height as i32, flags).map_err(|error| error.to_string())?;
        }
        if !current() { return Err("A solicitação de geometria foi substituída.".into()); }
        let mut current_region = RECT::default();
        if GetWindowRgnBox(hwnd, &mut current_region).0 != 0 && current_region.left == clip.x && current_region.top == clip.y
            && current_region.right - current_region.left == clip.width as i32 && current_region.bottom - current_region.top == clip.height as i32 { return Ok(()); }
        let region = CreateRectRgn(clip.x, clip.y, clip.x + clip.width as i32, clip.y + clip.height as i32);
        if region.0.is_null() { return Err("O Windows não criou a região de interação do widget.".into()); }
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            // Ownership transfers to Windows only on success.
            let _ = DeleteObject(region.into());
            return Err("O Windows não confirmou a região de interação do widget.".into());
        }
    }
    if !current() { return Err("A solicitação de geometria foi substituída.".into()); }
    Ok(())
}

#[cfg(windows)]
fn fail_closed(window: &WebviewWindow, current: &impl Fn() -> bool) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    if !current() { return; }
    let _ = window.set_ignore_cursor_events(true);
    if !current() { return; }
    if let Ok(hwnd) = window.hwnd() { unsafe { let _ = ShowWindow(hwnd, SW_HIDE); } }
}
