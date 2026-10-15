//! Commit a borderless widget's position and size in one native operation.
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(serde::Serialize)]
pub(crate) struct WidgetViewport {
    pub width: f64,
    pub height: f64,
}

pub(crate) fn set_frame(window: &WebviewWindow, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOOWNERZORDER, SWP_NOZORDER};
        use windows::Win32::Foundation::RECT;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let mut current = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut current).map_err(|error| error.to_string())?;
            if current.left == position.x && current.top == position.y
                && current.right - current.left == size.width as i32
                && current.bottom - current.top == size.height as i32 { return Ok(()); }
            let size_changed = current.right - current.left != size.width as i32
                || current.bottom - current.top != size.height as i32;
            let mut flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER;
            if size_changed {
                // Do not copy a compact client image to the resized frame's
                // new origin while the WebView renderer prepares its paint.
                flags |= SWP_NOCOPYBITS;
            }
            // Separate set_position/set_size calls expose an intermediate HWND
            // whose compact content is centered in the old width at the new x.
            SetWindowPos(hwnd, None, position.x, position.y, size.width as i32, size.height as i32,
                flags).map_err(|error| error.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        window.set_position(position).map_err(|error| error.to_string())?;
        window.set_size(size).map_err(|error| error.to_string())
    }
}
