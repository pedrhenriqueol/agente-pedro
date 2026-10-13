import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { emit, listen } from '@tauri-apps/api/event';

export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  accent: 'mint' | 'violet' | 'blue';
  reduceMotion: boolean;
  dockEnabled: boolean;
  sidebarCollapsed: boolean;
  nativeMaterial: 'system' | 'solid';
  islandIdle: 'clock' | 'focus' | 'balance' | 'minimal';
  islandVisibility: 'fixed' | 'hybrid';
  islandHideDelay: 3 | 5 | 10;
  islandOpacity: number;
  dockOpacity: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark', accent: 'mint', reduceMotion: false, dockEnabled: false,
  sidebarCollapsed: false, nativeMaterial: 'system',
  islandIdle: 'clock', islandVisibility: 'fixed', islandHideDelay: 3, islandOpacity: .96, dockOpacity: .94,
};
const STORAGE_KEY = 'pedro_preferences_v1';
const source = crypto.randomUUID();
const native = () => '__TAURI_INTERNALS__' in window;

/** Only preference data may cross the event boundary, never store methods or arbitrary keys. */
function validPatch(value: unknown): Partial<Preferences> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const p: Partial<Preferences> = {};
  if (v.theme === 'dark' || v.theme === 'light' || v.theme === 'system') p.theme = v.theme;
  if (v.accent === 'mint' || v.accent === 'violet' || v.accent === 'blue') p.accent = v.accent;
  if (v.nativeMaterial === 'system' || v.nativeMaterial === 'solid') p.nativeMaterial = v.nativeMaterial;
  if (v.islandIdle === 'clock' || v.islandIdle === 'focus' || v.islandIdle === 'balance' || v.islandIdle === 'minimal') p.islandIdle = v.islandIdle;
  if (v.islandVisibility === 'fixed' || v.islandVisibility === 'hybrid') p.islandVisibility = v.islandVisibility;
  if (v.islandHideDelay === 3 || v.islandHideDelay === 5 || v.islandHideDelay === 10) p.islandHideDelay = v.islandHideDelay;
  if (typeof v.reduceMotion === 'boolean') p.reduceMotion = v.reduceMotion;
  if (typeof v.dockEnabled === 'boolean') p.dockEnabled = v.dockEnabled;
  if (typeof v.sidebarCollapsed === 'boolean') p.sidebarCollapsed = v.sidebarCollapsed;
  if (typeof v.islandOpacity === 'number' && Number.isFinite(v.islandOpacity)) p.islandOpacity = Math.max(.55, Math.min(1, v.islandOpacity));
  if (typeof v.dockOpacity === 'number' && Number.isFinite(v.dockOpacity)) p.dockOpacity = Math.max(.55, Math.min(1, v.dockOpacity));
  return p;
}

function normalize(value: unknown): Preferences {
  return { ...DEFAULT_PREFERENCES, ...validPatch(value) };
}

function snapshot(): Preferences {
  const s = usePreferencesStore.getState();
  return normalize({ theme: s.theme, accent: s.accent, reduceMotion: s.reduceMotion,
    dockEnabled: s.dockEnabled, islandIdle: s.islandIdle, islandVisibility: s.islandVisibility,
    nativeMaterial: s.nativeMaterial, sidebarCollapsed: s.sidebarCollapsed,
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
    merge: (persisted, current) => ({ ...current, ...normalize(persisted) }),
  }),
);

/** Browser storage and native events carry preferences; received state is never rebroadcast. */
export async function initializePreferencesSync(): Promise<() => void> {
  const receive = (p: unknown) => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return;
    const next = normalize(p);
    if (JSON.stringify(next) !== JSON.stringify(snapshot())) usePreferencesStore.setState(next);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue).state); } catch { /* Ignore incomplete writes from another context. */ }
  };
  window.addEventListener('storage', storage);
  const unlisteners: (() => void)[] = [];
  if (native()) {
    try {
      unlisteners.push(await listen<{ source: string; preferences: Preferences }>('pedro:preferences', event => {
        if (event.payload && event.payload.source !== source) receive(event.payload.preferences);
      }));
      unlisteners.push(await listen<Partial<Preferences>>('pedro:preferences-patch', event => {
        const patch = validPatch(event.payload);
        if (Object.keys(patch).length > 0) receive({ ...snapshot(), ...patch });
      }));
    } catch { /* Persisted preferences still work if the native event layer is unavailable. */ }
  }
  return () => { window.removeEventListener('storage', storage); unlisteners.forEach(unlisten => unlisten()); };
}
