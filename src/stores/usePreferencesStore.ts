import { create } from 'zustand';
import { emit, listen } from '@tauri-apps/api/event';

export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  accent: 'mint' | 'violet' | 'blue' | 'amber' | 'rose' | 'custom';
  customAccent: string;
  reduceMotion: boolean;
  dockEnabled: boolean;
  topControlsEnabled: boolean;
  sidebarCollapsed: boolean;
  nativeMaterial: 'system' | 'solid';
  islandIdle: 'clock' | 'focus' | 'balance' | 'minimal';
  islandVisibility: 'fixed' | 'hybrid';
  islandHideDelay: 3 | 5 | 10;
  islandOpacity: number;
  islandTone: 'graphite' | 'midnight' | 'emerald';
  islandSize: 'small' | 'medium' | 'large';
  islandHoverExpand: boolean;
  dockOpacity: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark', accent: 'mint', customAccent: '#10b981', reduceMotion: false, dockEnabled: false, topControlsEnabled: true,
  sidebarCollapsed: false, nativeMaterial: 'system',
  islandIdle: 'clock', islandVisibility: 'fixed', islandHideDelay: 3, islandOpacity: .96, dockOpacity: .94,
  islandTone: 'graphite', islandSize: 'medium', islandHoverExpand: true,
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
  if (v.accent === 'mint' || v.accent === 'violet' || v.accent === 'blue' || v.accent === 'amber' || v.accent === 'rose' || v.accent === 'custom') p.accent = v.accent;
  if (typeof v.customAccent === 'string' && /^#[a-f\d]{6}$/i.test(v.customAccent)) p.customAccent = v.customAccent.toLowerCase();
  if (v.nativeMaterial === 'system' || v.nativeMaterial === 'solid') p.nativeMaterial = v.nativeMaterial;
  if (v.islandIdle === 'clock' || v.islandIdle === 'focus' || v.islandIdle === 'balance' || v.islandIdle === 'minimal') p.islandIdle = v.islandIdle;
  if (v.islandVisibility === 'fixed' || v.islandVisibility === 'hybrid') p.islandVisibility = v.islandVisibility;
  if (v.islandHideDelay === 3 || v.islandHideDelay === 5 || v.islandHideDelay === 10) p.islandHideDelay = v.islandHideDelay;
  if (v.islandTone === 'graphite' || v.islandTone === 'midnight' || v.islandTone === 'emerald') p.islandTone = v.islandTone;
  if (v.islandSize === 'small' || v.islandSize === 'medium' || v.islandSize === 'large') p.islandSize = v.islandSize;
  if (typeof v.islandHoverExpand === 'boolean') p.islandHoverExpand = v.islandHoverExpand;
  if (typeof v.reduceMotion === 'boolean') p.reduceMotion = v.reduceMotion;
  if (typeof v.dockEnabled === 'boolean') p.dockEnabled = v.dockEnabled;
  if (typeof v.topControlsEnabled === 'boolean') p.topControlsEnabled = v.topControlsEnabled;
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
  return normalize({ theme: s.theme, accent: s.accent, customAccent: s.customAccent, reduceMotion: s.reduceMotion,
    dockEnabled: s.dockEnabled, topControlsEnabled: s.topControlsEnabled, islandIdle: s.islandIdle, islandVisibility: s.islandVisibility,
    nativeMaterial: s.nativeMaterial, sidebarCollapsed: s.sidebarCollapsed,
    islandHideDelay: s.islandHideDelay, islandOpacity: s.islandOpacity, dockOpacity: s.dockOpacity,
    islandTone: s.islandTone, islandSize: s.islandSize, islandHoverExpand: s.islandHoverExpand });
}

interface PreferenceRevision { counter: number; actor: string }
interface StoredPreferences { state: Preferences; version: 0; revision: PreferenceRevision | null }

function revisionOf(value: unknown): PreferenceRevision | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as PreferenceRevision;
  return Number.isSafeInteger(r.counter) && r.counter >= 0 && r.counter < Number.MAX_SAFE_INTEGER
    && typeof r.actor === 'string' && r.actor.length > 0 && r.actor.length <= 128 ? { counter: r.counter, actor: r.actor } : null;
}
function compare(a: PreferenceRevision, b: PreferenceRevision): number {
  return a.counter - b.counter || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
}
function readStored(): StoredPreferences | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && typeof value.state === 'object' && value.state !== null
      ? { state: normalize(value.state), version: 0, revision: revisionOf(value.revision) } : null;
  } catch { return null; }
}
const initial = readStored();
let revision = initial?.revision ?? null;

function advanceRevision() {
  const stored = readStored()?.revision;
  revision = { counter: Math.max(Date.now(), (revision?.counter ?? 0) + 1, (stored?.counter ?? 0) + 1), actor: source };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: snapshot(), version: 0, revision })); }
  catch (error) { console.warn('[Pedro] Não foi possível guardar as preferências:', error); }
}
async function announce() {
  if (native()) await emit('pedro:preferences', { source, preferences: snapshot(), revision }).catch(() => {});
}

// Explicit persistence is intentional: Zustand persist.setState writes even
// when the update came from storage. In five WebViews that creates a feedback
// loop as old slider values circulate. Only local edits originate writes.
export const usePreferencesStore = create<Preferences & {
  updatePreferences: (patch: Partial<Preferences>) => void;
  resetPreferences: () => void;
}>()((set) => ({
  ...(initial?.state ?? DEFAULT_PREFERENCES),
  updatePreferences: patch => {
    const stored = readStored();
    const base = stored?.revision && (!revision || compare(stored.revision, revision) > 0) ? stored.state : snapshot();
    advanceRevision();
    set(normalize({ ...base, ...patch }));
    save(); void announce();
  },
  resetPreferences: () => { advanceRevision(); set(DEFAULT_PREFERENCES); save(); void announce(); },
}));

/** Browser storage and native events carry preferences; received state is never rebroadcast. */
export async function initializePreferencesSync(): Promise<() => void> {
  const receive = (p: unknown, incoming: unknown, transport: 'storage' | 'native') => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return;
    const nextRevision = revisionOf(incoming);
    if (nextRevision && revision && compare(nextRevision, revision) <= 0) return;
    const next = normalize(p);
    if (nextRevision) revision = nextRevision;
    if (JSON.stringify(next) !== JSON.stringify(snapshot())) usePreferencesStore.setState(next);
    // Shared storage already contains the sender's write. Never write it back.
    // A native-only delivery may precede storage or come from an older app;
    // retain it once, but never overwrite a newer persisted envelope.
    if (transport === 'native') {
      const stored = readStored();
      if (nextRevision ? !stored?.revision || compare(nextRevision, stored.revision) > 0
        : JSON.stringify(stored?.state) !== JSON.stringify(next)) save();
    }
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const value = JSON.parse(event.newValue);
      receive(value.state, value.revision, 'storage');
    } catch { /* Ignore incomplete writes from another context. */ }
  };
  window.addEventListener('storage', storage);
  const unlisteners: (() => void)[] = [];
  if (native()) {
    try {
      unlisteners.push(await listen<{ source: string; preferences: Preferences; revision?: PreferenceRevision }>('pedro:preferences', event => {
        if (event.payload && event.payload.source !== source) receive(event.payload.preferences, event.payload.revision, 'native');
      }));
      unlisteners.push(await listen<Partial<Preferences>>('pedro:preferences-patch', event => {
        const patch = validPatch(event.payload);
        if (Object.keys(patch).length > 0) {
          const next = normalize({ ...snapshot(), ...patch });
          if (JSON.stringify(next) === JSON.stringify(snapshot())) return;
          advanceRevision(); usePreferencesStore.setState(next); save();
        }
      }));
    } catch { /* Persisted preferences still work if the native event layer is unavailable. */ }
  }
  return () => { window.removeEventListener('storage', storage); unlisteners.forEach(unlisten => unlisten()); };
}
