import { invoke, isTauri } from '@tauri-apps/api/core';

export type DesktopPage = 'home' | 'routine' | 'finance' | 'music' | 'appearance';
export type Page = DesktopPage;

export const DESKTOP_NAVIGATION_EVENT = 'pedro:navigate';

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
  if (windowLabel === 'island' || windowLabel === 'dock') {
    const panel = window.open(url.toString(), 'pedro-main');
    if (!panel) throw new Error('Permita abrir a janela do painel neste navegador.');
    panel.focus();
  } else {
    window.dispatchEvent(new CustomEvent(DESKTOP_NAVIGATION_EVENT, { detail: page }));
  }
}

/** Native sizes include the transparent padding that contains the widget shadow. */
export async function syncIslandSize(expanded: boolean): Promise<void> {
  if (!isTauri()) return;
  if (expanded) await invoke('expandir_ilha', { altura: 284 });
  else await invoke('recolher_ilha');
}

export async function setDockVisible(visible: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke('configurar_dock', { visivel: visible });
}
