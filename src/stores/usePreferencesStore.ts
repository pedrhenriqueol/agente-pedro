import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { emit, listen } from '@tauri-apps/api/event';

export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  accent: 'mint' | 'violet' | 'blue';
  reduceMotion: boolean;
  dockEnabled: boolean;
  islandIdle: 'clock' | 'focus' | 'balance' | 'minimal';
  islandVisibility: 'fixed' | 'hybrid';
  islandHideDelay: 3 | 5 | 10;
  islandOpacity: number;
  dockOpacity: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark', accent: 'mint', reduceMotion: false, dockEnabled: true,
  islandIdle: 'clock', islandVisibility: 'fixed', islandHideDelay: 3, islandOpacity: .96, dockOpacity: .94,
};
const STORAGE_KEY = 'pedro_preferences_v1';
const source = crypto.randomUUID();
const native = () => '__TAURI_INTERNALS__' in window;

function normalize(value: Partial<Preferences>): Preferences {
  const p = { ...DEFAULT_PREFERENCES, ...value };
  if (!['dark', 'light', 'system'].includes(p.theme)) p.theme = 'dark';
  if (!['mint', 'violet', 'blue'].includes(p.accent)) p.accent = 'mint';
  if (!['clock', 'focus', 'balance', 'minimal'].includes(p.islandIdle)) p.islandIdle = 'clock';
  if (!['fixed', 'hybrid'].includes(p.islandVisibility)) p.islandVisibility = 'fixed';
  if (![3, 5, 10].includes(p.islandHideDelay)) p.islandHideDelay = 3;
  p.reduceMotion = Boolean(p.reduceMotion);
  p.dockEnabled = p.dockEnabled !== false;
  p.islandOpacity = Number.isFinite(p.islandOpacity) ? Math.max(.55, Math.min(1, p.islandOpacity)) : .96;
  p.dockOpacity = Number.isFinite(p.dockOpacity) ? Math.max(.55, Math.min(1, p.dockOpacity)) : .94;
  return p;
}

function snapshot(): Preferences {
  const s = usePreferencesStore.getState();
  return normalize({ theme: s.theme, accent: s.accent, reduceMotion: s.reduceMotion,
    dockEnabled: s.dockEnabled, islandIdle: s.islandIdle, islandVisibility: s.islandVisibility,
    islandHideDelay: s.islandHideDelay, islandOpacity: s.islandOpacity, dockOpacity: s.dockOpacity });
}

async function announce() {
  if (native()) await emit('pedro:preferences', { source, preferences: snapshot() }).catch(() => {});
}

export const usePreferencesStore = create<Preferences & {
  updatePreferences: (patch: Partial<Preferences>) => void;
  resetPreferences: () => void;
}>()(
  persist((set) => ({
    ...DEFAULT_PREFERENCES,
    updatePreferences: patch => { set(state => normalize({ ...state, ...patch })); void announce(); },
    resetPreferences: () => { set(DEFAULT_PREFERENCES); void announce(); },
  }), {
    name: STORAGE_KEY,
    partialize: state => normalize(state),
    merge: (persisted, current) => ({ ...current, ...normalize((persisted ?? {}) as Partial<Preferences>) }),
  }),
);

/** Browser storage and native events carry preferences; received state is never rebroadcast. */
export async function initializePreferencesSync(): Promise<() => void> {
  const receive = (p: Partial<Preferences>) => {
    const next = normalize(p);
    if (JSON.stringify(next) !== JSON.stringify(snapshot())) usePreferencesStore.setState(next);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue).state); } catch { /* Ignore incomplete writes from another context. */ }
  };
  window.addEventListener('storage', storage);
  let unlisten: (() => void) | undefined;
  if (native()) {
    try {
      unlisten = await listen<{ source: string; preferences: Preferences }>('pedro:preferences', event => {
        if (event.payload.source !== source) receive(event.payload.preferences);
      });
    } catch { /* Persisted preferences still work if the native event layer is unavailable. */ }
  }
  return () => { window.removeEventListener('storage', storage); unlisten?.(); };
}
