import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type IslandMode = 'fixed' | 'hybrid';
export type IslandHideDelay = 3 | 5 | 10;
export interface IslandVisibilityTransition {
  generation: number;
  visible: boolean;
  durationMs: number;
}
export interface IslandVisibilitySnapshot {
  revision: number;
  supported: boolean;
  mode: IslandMode;
  delaySeconds: IslandHideDelay;
  visible: boolean;
  reason: 'fixed' | 'idle' | 'fullscreen' | 'reveal';
  error: string | null;
  /** The HWND stays visible during exit; acknowledge only this generation. */
  transition?: IslandVisibilityTransition | null;
}
export const DEFAULT_ISLAND_VISIBILITY: IslandVisibilitySnapshot = {
  revision: 0, supported: false, mode: 'fixed', delaySeconds: 3, visible: true, reason: 'fixed', error: null, transition: null,
};

export async function readIslandVisibility(): Promise<IslandVisibilitySnapshot> {
  return isTauri() ? invoke('island_visibility_snapshot') : { ...DEFAULT_ISLAND_VISIBILITY };
}

export async function watchIslandVisibility(receive: (snapshot: IslandVisibilitySnapshot) => void): Promise<() => void> {
  return isTauri() ? listen<IslandVisibilitySnapshot>('pedro:island-visibility', event => receive(event.payload)) : () => {};
}

export async function configureIslandVisibility(mode: IslandMode, delaySeconds: IslandHideDelay): Promise<IslandVisibilitySnapshot> {
  return isTauri() ? invoke('configure_island_visibility', { mode, delaySeconds })
    : { ...DEFAULT_ISLAND_VISIBILITY, mode, delaySeconds };
}

export async function reportIslandActivity(): Promise<void> {
  if (isTauri()) await invoke('island_activity');
}

/** Native code ignores stale acknowledgements, including reversed animations. */
export async function completeIslandVisibilityTransition(generation: number): Promise<void> {
  if (isTauri()) await invoke('complete_island_visibility_transition', { generation });
}
