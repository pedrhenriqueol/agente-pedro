import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMediaStore } from '../stores/useMediaStore';

// Focus and visibility usually describe the same wake. Read the native cache
// once for that burst, with at most one trailing read if another wake arrives
// before the first response. This is reconciliation, never another poller.
const WAKE_COALESCE_MS = 50;

export function initializeMainMediaReconciliation(label: string): () => void {
  if (label !== 'main' || !isTauri()) return () => {};
  let disposed = false;
  let stopFocus: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let latestRequested = false;

  const reconcile = async () => {
    pending = true;
    try {
      for (let pass = 0; pass < 2 && !disposed; pass += 1) {
        latestRequested = false;
        try { await useMediaStore.getState().reconcileMedia(); }
        catch { /* The store owns read ordering and errors; waking stays quiet. */ }
        if (!latestRequested) break;
      }
    } finally { pending = false; latestRequested = false; }
  };
  const wake = () => {
    if (disposed) return;
    if (pending) { latestRequested = true; return; }
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed) void reconcile();
    }, WAKE_COALESCE_MS);
  };
  const visibilityChanged = () => { if (document.visibilityState === 'visible') wake(); };
  document.addEventListener('visibilitychange', visibilityChanged);
  // Registration is asynchronous. StrictMode may dispose this instance before
  // Tauri returns its unlisten function; release that late handle immediately.
  void Promise.resolve().then(() => {
    if (disposed) return;
    return getCurrentWindow().onFocusChanged(event => { if (event.payload) wake(); });
  }).then(unlisten => {
    if (!unlisten) return;
    if (disposed) unlisten();
    else stopFocus = unlisten;
  }).catch(() => { /* visibilitychange still reconciles if registration fails. */ });

  return () => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    latestRequested = false;
    document.removeEventListener('visibilitychange', visibilityChanged);
    stopFocus?.();
    stopFocus = undefined;
  };
}
