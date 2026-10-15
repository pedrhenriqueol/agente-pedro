import { invoke, isTauri } from '@tauri-apps/api/core';
import type { WidgetViewport } from './widgetViewport';

export type DesktopPage = 'home' | 'routine' | 'finance' | 'music' | 'appearance';
export type Page = DesktopPage;

export const DESKTOP_NAVIGATION_EVENT = 'pedro:navigate';

/** A compact WebView's viewport is not the available desktop width. */
export async function readIslandAvailableWidth(): Promise<number> {
  return isTauri() ? invoke<number>('island_available_width') : window.innerWidth;
}

/** Opens a section in the existing native dashboard, rather than toggling it off. */
export async function requestPage(page: DesktopPage): Promise<void> {
  if (isTauri()) {
    await invoke('abrir_painel', { page });
    return;
  }

  const url = new URL(window.location.href);
  const windowLabel = url.searchParams.get('window');
  url.searchParams.set('window', 'main');
  url.searchParams.set('page', page);
  if (windowLabel === 'island' || windowLabel === 'dock' || windowLabel === 'top-left' || windowLabel === 'top-right') {
    const panel = window.open(url.toString(), 'pedro-main');
    if (!panel) throw new Error('Permita abrir a janela do painel neste navegador.');
    panel.focus();
  } else {
    window.dispatchEvent(new CustomEvent(DESKTOP_NAVIGATION_EVENT, { detail: page }));
  }
}

/** Native sizes include the transparent padding that contains the widget shadow. */
let islandSizeQueue: Promise<unknown> = Promise.resolve();
export async function syncIslandSize(expanded: boolean, frameHeight = expanded ? 284 : 48, frameWidth = expanded ? 584 : 120): Promise<WidgetViewport> {
  const dimensions = {
    altura: Math.max(48, Math.min(424, frameHeight)),
    largura: Math.max(96, Math.min(664, frameWidth)),
  };
  if (!isTauri()) return { width: dimensions.largura, height: dimensions.altura };
  // Keep prepare/grow/shrink commands ordered even when an interrupted React
  // animation issues a new request before the previous IPC reply arrives.
  const request = islandSizeQueue.catch(() => {}).then(async () => {
    const result = await invoke<WidgetViewport | undefined>(expanded ? 'expandir_ilha' : 'recolher_ilha', dimensions);
    // Older development backends and isolated IPC fixtures returned no payload.
    const frame = result ?? { width: dimensions.largura, height: dimensions.altura };
    if (![frame.width, frame.height].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('A janela retornou dimensões inválidas.');
    }
    return frame;
  });
  islandSizeQueue = request;
  return request;
}

interface DockVisibilityBatch {
  visible: boolean;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

let pendingDockVisibility: DockVisibilityBatch | null = null;
let updatingDockVisibility = false;

/**
 * One native update at a time per WebView. Changes received while IPC is in
 * flight are coalesced to the latest preference, including rapid OFF/ON/OFF.
 * Errors reach callers and never leave the queue permanently rejected.
 */
export function setDockVisible(visible: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (pendingDockVisibility) {
      pendingDockVisibility.visible = visible;
      pendingDockVisibility.waiters.push({ resolve, reject });
    } else {
      pendingDockVisibility = { visible, waiters: [{ resolve, reject }] };
    }
    if (!updatingDockVisibility) void flushDockVisibility();
  });
}

async function flushDockVisibility(): Promise<void> {
  updatingDockVisibility = true;
  try {
    while (pendingDockVisibility) {
      const batch = pendingDockVisibility;
      pendingDockVisibility = null;
      try {
        await invoke('configurar_dock', { visivel: batch.visible });
        batch.waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        batch.waiters.forEach(({ reject }) => reject(error));
      }
    }
  } finally {
    updatingDockVisibility = false;
  }
}
