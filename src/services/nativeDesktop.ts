import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DesktopPage } from '../lib/desktop';

export interface MaterialResult { supported: boolean; applied: boolean; error: string | null }
export async function applyPanelMaterial(material: 'system' | 'solid', theme: 'dark' | 'light'): Promise<MaterialResult> {
  return isTauri() ? invoke('apply_window_material', { material, theme }) : { supported: false, applied: false, error: null };
}
export async function configureDesktopMenu(islandVisibility: 'fixed' | 'hybrid', dockEnabled: boolean): Promise<void> {
  if (isTauri()) await invoke('configure_desktop_menu', { islandVisibility, dockEnabled });
}
export async function updateFocusProgress(state: 'none' | 'running' | 'paused', completed: number, total: number): Promise<void> {
  if (isTauri()) await invoke('focus_taskbar_progress', { state, completed: Math.max(0, Math.floor(completed)), total: Math.max(1, Math.floor(total)) });
}
export async function initialDesktopPage(): Promise<DesktopPage | null> {
  if (!isTauri()) return null;
  const value = await invoke<string | null>('desktop_initial_page');
  return ['home', 'routine', 'finance', 'music', 'appearance'].includes(value ?? '') ? value as DesktopPage : null;
}
