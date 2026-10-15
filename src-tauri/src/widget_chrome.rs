//! Keep native captions out of the three clipped, nonresizable widgets.
//!
//! Tao retains caption styles on undecorated top-level windows and reapplies
//! them when cursor/visibility flags change. A per-HWND policy must therefore
//! survive those updates, rather than clearing the styles just once.

// Win32 values are kept portable so the policy can be tested on the host.
const FRAME_STYLES: u32 = 0x00c4_0000; // WS_CAPTION | WS_THICKFRAME
const EDGE_STYLES: u32 = 0x0002_0301; // WINDOWEDGE | CLIENTEDGE | DLGMODALFRAME | STATICEDGE

fn applies_to(label: &str) -> bool { matches!(label, "island" | "top-left" | "top-right") }
fn frame_style(style: u32) -> u32 { style & !FRAME_STYLES }
fn edge_style(style: u32) -> u32 { style & !EDGE_STYLES }

#[cfg(windows)]
pub(crate) fn prepare(window: &tauri::WebviewWindow, current: &impl Fn() -> bool) -> Result<(), String> {
    if !applies_to(window.label()) { return Ok(()); }
    native::prepare(window.hwnd().map_err(|error| error.to_string())?, current)
}

#[cfg(windows)]
mod native {
    use super::{edge_style, frame_style};
    use windows::Win32::Foundation::{GetLastError, SetLastError, HWND, LPARAM, LRESULT, WIN32_ERROR, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowThreadProcessId, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, GWL_STYLE, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
        WINDOW_LONG_PTR_INDEX, WM_NCDESTROY, WM_STYLECHANGING,
    };

    const SUBCLASS_ID: usize = 0x5044_4348; // "PDCH"; separate from Tao/Wry IDs.

    fn failure(operation: &str, error: WIN32_ERROR) -> String {
        format!("{operation} falhou ao preparar a moldura do widget (Win32 {}).", error.0)
    }

    fn read_style(hwnd: HWND, index: WINDOW_LONG_PTR_INDEX) -> Result<u32, String> {
        unsafe {
            SetLastError(WIN32_ERROR(0));
            let value = GetWindowLongPtrW(hwnd, index);
            let error = GetLastError();
            // A zero style is valid; only a nonzero last-error makes it fail.
            if value == 0 && error.0 != 0 { return Err(failure("GetWindowLongPtrW", error)); }
            Ok(value as u32)
        }
    }

    fn write_style(hwnd: HWND, index: WINDOW_LONG_PTR_INDEX, style: u32) -> Result<(), String> {
        unsafe {
            SetLastError(WIN32_ERROR(0));
            let previous = SetWindowLongPtrW(hwnd, index, style as isize);
            let error = GetLastError();
            if previous == 0 && error.0 != 0 { return Err(failure("SetWindowLongPtrW", error)); }
        }
        Ok(())
    }

    fn ensure_current(current: &impl Fn() -> bool) -> Result<(), String> {
        if current() { Ok(()) } else { Err("A solicitação de moldura do widget foi substituída.".into()) }
    }

    pub(super) fn prepare(hwnd: HWND, current: &impl Fn() -> bool) -> Result<(), String> {
        ensure_current(current)?;
        unsafe {
            // SetWindowSubclass is only supported on the HWND's own UI thread.
            let owner = GetWindowThreadProcessId(hwnd, None);
            if owner == 0 || owner != GetCurrentThreadId() {
                return Err("A moldura do widget precisa ser preparada na thread da interface.".into());
            }
            if !GetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, None).as_bool() {
                ensure_current(current)?;
                SetLastError(WIN32_ERROR(0));
                if !SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, 0).as_bool() {
                    return Err(failure("SetWindowSubclass", GetLastError()));
                }
            }
        }
        ensure_current(current)?;
        let style = read_style(hwnd, GWL_STYLE)?;
        let plain = frame_style(style);
        ensure_current(current)?;
        if style != plain {
            write_style(hwnd, GWL_STYLE, plain)?;
            ensure_current(current)?;
        }
        // A synchronous style message can update cursor/visibility flags.
        // Read the extended styles only after that callback chain completes.
        let extended = read_style(hwnd, GWL_EXSTYLE)?;
        let flat = edge_style(extended);
        ensure_current(current)?;
        if extended != flat {
            write_style(hwnd, GWL_EXSTYLE, flat)?;
            ensure_current(current)?;
        }
        ensure_current(current)?;
        if style == plain && extended == flat { return Ok(()); }
        unsafe {
            // Recalculate the initial non-client area once. Opening/closing a
            // prepared widget must not resize, move, activate or reorder HWNDs.
            SetWindowPos(hwnd, None, 0, 0, 0, 0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER)
                .map_err(|error| format!("Não foi possível atualizar a moldura do widget: {error}"))?;
        }
        ensure_current(current)
    }

    unsafe extern "system" fn subclass(
        hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM,
        _id: usize, _data: usize,
    ) -> LRESULT {
        unsafe {
            if message == WM_STYLECHANGING && lparam.0 != 0 {
                let styles = &mut *(lparam.0 as *mut STYLESTRUCT);
                if wparam.0 as i32 == GWL_STYLE.0 {
                    styles.styleNew = frame_style(styles.styleNew);
                } else if wparam.0 as i32 == GWL_EXSTYLE.0 {
                    styles.styleNew = edge_style(styles.styleNew);
                }
            } else if message == WM_NCDESTROY {
                // Static callback, no allocation or Tauri state to release.
                let _ = RemoveWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID);
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::atomic::{AtomicBool, Ordering};
        use windows::core::w;
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{ClientToScreen, CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn};
        use windows::Win32::UI::WindowsAndMessaging::*;

        struct HiddenWindow(HWND);
        impl Drop for HiddenWindow {
            fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } }
        }

        fn bounds(hwnd: HWND) -> RECT {
            let mut rect = RECT::default();
            unsafe { GetWindowRect(hwnd, &mut rect).unwrap(); }
            rect
        }

        fn assert_client_fills_frame(hwnd: HWND, expected: RECT) {
            let frame = bounds(hwnd);
            assert_eq!((frame.left, frame.top, frame.right, frame.bottom),
                (expected.left, expected.top, expected.right, expected.bottom));
            let mut client = RECT::default();
            let mut origin = POINT::default();
            unsafe {
                GetClientRect(hwnd, &mut client).unwrap();
                assert!(ClientToScreen(hwnd, &mut origin).as_bool());
                assert!(!IsWindowVisible(hwnd).as_bool());
            }
            assert_eq!((origin.x, origin.y), (frame.left, frame.top));
            assert_eq!((client.right, client.bottom), (frame.right - frame.left, frame.bottom - frame.top));
        }

        #[test]
        fn clipped_hidden_hwnd_stays_borderless_through_tao_style_rewrites() {
            assert_eq!(super::super::FRAME_STYLES, (WS_CAPTION | WS_THICKFRAME).0);
            assert_eq!(super::super::EDGE_STYLES,
                (WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE).0);
            let original_style = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
            let original_extended = WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_WINDOWEDGE;
            let window = HiddenWindow(unsafe {
                CreateWindowExW(original_extended, w!("STATIC"), w!("Pedro hidden chrome regression"),
                    original_style, 24, 30, 664, 424, None, None, None, None).unwrap()
            });
            let hwnd = window.0;
            let expected = bounds(hwnd);
            prepare(hwnd, &|| true).unwrap();
            // Second preparation is idempotent and does not add another policy.
            prepare(hwnd, &|| true).unwrap();
            assert!(unsafe { GetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, None).as_bool() });
            assert_client_fills_frame(hwnd, expected);
            for ignored in [true, false, true, false] {
                let cursor = if ignored { WS_EX_TRANSPARENT | WS_EX_LAYERED } else { WINDOW_EX_STYLE(0) };
                write_style(hwnd, GWL_STYLE, original_style.0).unwrap();
                write_style(hwnd, GWL_EXSTYLE, (original_extended | cursor).0).unwrap();
                assert_eq!(read_style(hwnd, GWL_STYLE).unwrap(), frame_style(original_style.0));
                assert_eq!(read_style(hwnd, GWL_EXSTYLE).unwrap(), edge_style((original_extended | cursor).0));
                for (left, width, height) in [(272, 120, 48), (0, 664, 424), (360, 304, 184), (574, 90, 46)] {
                    unsafe {
                        let region = CreateRectRgn(left, 0, left + width, height);
                        assert!(!region.0.is_null());
                        if SetWindowRgn(hwnd, Some(region), true) == 0 {
                            let _ = DeleteObject(region.into());
                            panic!("SetWindowRgn failed for the hidden regression HWND");
                        }
                        let mut actual = RECT::default();
                        assert_ne!(GetWindowRgnBox(hwnd, &mut actual).0, 0);
                        assert_eq!((actual.left, actual.top, actual.right, actual.bottom), (left, 0, left + width, height));
                    }
                    prepare(hwnd, &|| true).unwrap();
                    assert_client_fills_frame(hwnd, expected);
                }
            }
            // Exercise WM_NCDESTROY teardown through the callback chain.
            drop(window);
            assert!(!unsafe { GetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, None).as_bool() });
        }

        #[test]
        fn zero_style_is_valid_and_other_threads_cannot_install_the_policy() {
            let window = HiddenWindow(unsafe {
                CreateWindowExW(WINDOW_EX_STYLE(0), w!("STATIC"), w!("Pedro empty style regression"),
                    WINDOW_STYLE(0), 24, 30, 100, 100, None, None, None, None).unwrap()
            });
            assert_eq!(read_style(window.0, GWL_EXSTYLE).unwrap(), 0);
            write_style(window.0, GWL_EXSTYLE, 0).unwrap();
            let raw = window.0.0 as usize;
            assert!(std::thread::spawn(move || prepare(HWND(raw as _), &|| true)).join().unwrap().is_err());
            assert!(!unsafe { GetWindowSubclass(window.0, Some(subclass), SUBCLASS_ID, None).as_bool() });
            prepare(window.0, &|| true).unwrap();
        }

        const REENTRANT_SUBCLASS_ID: usize = 0x5044_4354;
        struct ReentrantStyle { current: AtomicBool, latest_extended: u32 }

        unsafe extern "system" fn supersede_on_style_change(
            hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM,
            _id: usize, data: usize,
        ) -> LRESULT {
            unsafe {
                if message == WM_STYLECHANGED && wparam.0 as i32 == GWL_STYLE.0 {
                    let latest = &*(data as *const ReentrantStyle);
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, latest.latest_extended as isize);
                    latest.current.store(false, Ordering::SeqCst);
                } else if message == WM_NCDESTROY {
                    let _ = RemoveWindowSubclass(hwnd, Some(supersede_on_style_change), REENTRANT_SUBCLASS_ID);
                }
                DefSubclassProc(hwnd, message, wparam, lparam)
            }
        }

        #[test]
        fn superseded_preparation_preserves_reentrant_cursor_flags() {
            // This data outlives the hidden HWND even if an assertion fails.
            let latest = ReentrantStyle {
                current: AtomicBool::new(true),
                latest_extended: (WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW).0,
            };
            let window = HiddenWindow(unsafe {
                CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_WINDOWEDGE, w!("STATIC"), w!("Pedro reentrant style regression"),
                    WS_CAPTION | WS_THICKFRAME, 24, 30, 664, 424, None, None, None, None).unwrap()
            });
            unsafe {
                assert!(SetWindowSubclass(window.0, Some(supersede_on_style_change), REENTRANT_SUBCLASS_ID,
                    &latest as *const ReentrantStyle as usize).as_bool());
            }
            let result = prepare(window.0, &|| latest.current.load(Ordering::SeqCst));
            assert!(result.is_err());
            assert!(!latest.current.load(Ordering::SeqCst));
            assert_eq!(read_style(window.0, GWL_EXSTYLE).unwrap(), latest.latest_extended);
            assert!(unsafe { GetWindowSubclass(window.0, Some(subclass), SUBCLASS_ID, None).as_bool() });
            unsafe {
                assert!(RemoveWindowSubclass(window.0, Some(supersede_on_style_change), REENTRANT_SUBCLASS_ID).as_bool());
            }
            prepare(window.0, &|| true).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_is_scoped_to_the_three_clipped_widgets() {
        for label in ["island", "top-left", "top-right"] { assert!(applies_to(label)); }
        for label in ["main", "dock", "", "other", "top-left-extra"] { assert!(!applies_to(label)); }
    }

    #[test]
    fn only_native_frame_styles_are_removed_and_the_policy_is_idempotent() {
        for value in [0, u32::MAX, FRAME_STYLES, !FRAME_STYLES, 0x9608_0000] {
            let actual = frame_style(value);
            assert_eq!(actual & FRAME_STYLES, 0);
            assert_eq!(actual & !FRAME_STYLES, value & !FRAME_STYLES);
            assert_eq!(frame_style(actual), actual);
        }
    }

    #[test]
    fn focus_transparency_cursor_taskbar_and_composition_flags_survive() {
        // TOPMOST, TRANSPARENT, TOOLWINDOW, LAYERED, APPWINDOW, NOACTIVATE,
        // NOREDIRECTIONBITMAP and ACCEPTFILES must remain under Tao's control.
        let operational = 0x0000_0008 | 0x0000_0020 | 0x0000_0080 | 0x0008_0000 |
            0x0004_0000 | 0x0800_0000 | 0x0020_0000 | 0x0000_0010;
        assert_eq!(edge_style(operational | EDGE_STYLES), operational);
        assert_eq!(edge_style(operational), operational);
        assert_eq!(edge_style(edge_style(u32::MAX)), edge_style(u32::MAX));
        assert_eq!(edge_style(u32::MAX), !EDGE_STYLES);
    }
}
