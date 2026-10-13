//! The dock's visual state and native hit target must change together.
//!
//! Direct ShowWindow calls do not update Tao's cached VISIBLE flag. Calling
//! Tauri `hide()` after showing the HWND directly can therefore leave a visible,
//! transparent window over the desktop. Both directions use the same native
//! path, on the UI thread, and confirm the actual HWND rather than that cache.
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

// BEGIN portable dock policy
#[derive(Clone, Copy, Debug, PartialEq)]
struct DockRequest {
    generation: u64,
    visible: bool,
}

#[derive(Debug, Default)]
struct DockPolicy {
    ready: bool,
    desired: bool,
    generation: u64,
}

impl DockPolicy {
    fn request(&mut self, visible: bool) -> Option<DockRequest> {
        self.desired = visible;
        self.generation = self.generation.wrapping_add(1);
        self.ready.then(|| self.current())
    }

    fn start(&mut self) -> DockRequest {
        self.ready = true;
        self.current()
    }

    fn current(&self) -> DockRequest {
        DockRequest {
            generation: self.generation,
            visible: self.desired,
        }
    }

    fn accepts(&self, request: DockRequest) -> bool {
        self.ready && self.current() == request
    }
}
// END portable dock policy

#[derive(Clone, Default)]
pub struct DockVisibilityState {
    inner: Arc<Mutex<DockPolicy>>,
}

/// Registered on the builder before any WebView is created. A command received
/// during window creation records its preference; `start` applies it in setup.
pub async fn request(app: &AppHandle, visible: bool) -> Result<(), String> {
    let state = app
        .try_state::<DockVisibilityState>()
        .ok_or_else(|| "O controle do dock ainda não está disponível.".to_string())?
        .inner()
        .clone();
    let request = {
        let mut policy = state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        policy.request(visible)
    };
    let Some(request) = request else {
        return Ok(());
    };

    let (response, mut receiver) = tauri::async_runtime::channel(1);
    schedule(app, state, request, Some(response))?;
    receiver.recv().await.ok_or_else(|| {
        "O runtime encerrou antes de confirmar a visibilidade do dock.".to_string()
    })?
}

pub fn start(app: &AppHandle) {
    let Some(state) = app.try_state::<DockVisibilityState>() else {
        crate::diagnostics::write(
            "dock_warning",
            "Estado do dock indisponível na inicialização",
        );
        return;
    };
    let state = state.inner().clone();
    let request = state
        .inner
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .start();
    if let Err(error) = schedule(app, state, request, None) {
        crate::diagnostics::write("dock_warning", error);
    }
}

fn schedule(
    app: &AppHandle,
    state: DockVisibilityState,
    request: DockRequest,
    response: Option<tauri::async_runtime::Sender<Result<(), String>>>,
) -> Result<(), String> {
    let ui_app = app.clone();
    app.run_on_main_thread(move || {
        // Hold the policy lock through the native change: a newer command cannot
        // change desired state halfway through ShowWindow/confirmation. Queued
        // older operations are skipped, so a late ON cannot undo a newer OFF.
        let policy = state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = if policy.accepts(request) {
            apply(&ui_app, request.visible)
        } else {
            Ok(())
        };
        drop(policy);
        if let Err(error) = &result {
            crate::diagnostics::write("dock_warning", error);
        }
        if let Some(response) = response {
            let _ = response.try_send(result);
        }
    })
    .map_err(|error| format!("Não foi possível atualizar o dock na thread da interface: {error}"))
}

/// This function is only called by `run_on_main_thread`. Click-through is also
/// set natively while disabled, protecting the desktop if hiding fails. The
/// interactive flag is restored before showing and focus is never requested.
fn apply(app: &AppHandle, visible: bool) -> Result<(), String> {
    let dock = app
        .get_webview_window("dock")
        .ok_or_else(|| "A janela do dock não está disponível.".to_string())?;
    if visible {
        crate::centralizar_dock_base(app);
    }
    let cursor_result = dock
        .set_ignore_cursor_events(!visible)
        .map_err(|error| format!("Não foi possível atualizar a interação nativa do dock: {error}"));
    // Do not show an unusable window if its interaction could not be restored.
    if visible {
        cursor_result.as_ref().map_err(Clone::clone)?;
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
        };
        let handle = dock.hwnd().map_err(|error| error.to_string())?;
        let hwnd = HWND(handle.0 as *mut _);
        unsafe {
            // ShowWindow returns the previous visibility, not success.
            let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
            if IsWindowVisible(hwnd).as_bool() != visible {
                return Err("O Windows não confirmou a alteração de visibilidade do dock.".into());
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if visible { dock.show() } else { dock.hide() }.map_err(|error| error.to_string())?;
        if dock.is_visible().map_err(|error| error.to_string())? != visible {
            return Err("O sistema não confirmou a alteração de visibilidade do dock.".into());
        }
    }
    cursor_result
}

// BEGIN portable dock tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_reconciles_the_last_preference_received_before_setup() {
        let mut policy = DockPolicy::default();
        assert!(policy.request(true).is_none());
        assert!(policy.request(false).is_none());
        let started = policy.start();
        assert!(!started.visible);
        assert!(policy.accepts(started));
    }

    #[test]
    fn stale_show_cannot_overwrite_a_newer_hide() {
        let mut policy = DockPolicy::default();
        policy.start();
        let show = policy.request(true).unwrap();
        let hide = policy.request(false).unwrap();
        assert!(!policy.accepts(show));
        assert!(policy.accepts(hide));
        assert!(!hide.visible);
    }

    #[test]
    fn rapid_reversals_only_apply_the_latest_generation() {
        let mut policy = DockPolicy::default();
        policy.start();
        let requests: Vec<_> = [true, false, true, false, true]
            .into_iter()
            .map(|visible| policy.request(visible).unwrap())
            .collect();
        assert_eq!(
            requests
                .iter()
                .filter(|request| policy.accepts(**request))
                .count(),
            1
        );
        assert!(policy.accepts(*requests.last().unwrap()));
        assert!(policy.current().visible);
    }

    #[test]
    fn repeating_the_same_preference_is_a_new_operation_and_can_retry_failure() {
        let mut policy = DockPolicy::default();
        policy.start();
        let failed = policy.request(false).unwrap();
        let retry = policy.request(false).unwrap();
        assert_ne!(failed.generation, retry.generation);
        assert!(!policy.accepts(failed));
        assert!(policy.accepts(retry));
    }

    #[test]
    fn default_startup_does_not_create_a_hit_target() {
        let mut policy = DockPolicy::default();
        assert!(!policy.start().visible);
    }
}
// END portable dock tests
