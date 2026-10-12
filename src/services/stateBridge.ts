export type SharedTimerState = 'idle' | 'focus' | 'break' | 'paused' | 'completed';

/** Serializable session state. Interval handles and database requests stay local. */
export interface TimerSnapshot {
  version: 1;
  revision: number;
  actor: string;
  pomodoroState: SharedTimerState;
  currentMode: 'focus' | 'break';
  totalDurationSeconds: number;
  remainingSeconds: number;
  targetTimestamp: number | null;
  /** Optional for snapshots saved by the first version of the app. */
  completedAt?: string | null;
  sessionId: string | null;
  selectedTaskId: string | null;
}

type EventKind = 'timer:snapshot' | 'timer:request' | 'focus:changed' | 'finance:changed';
interface StateEvent {
  version: 1;
  id: string;
  source: string;
  kind: EventKind;
  payload?: unknown;
}
type Handler = (payload?: unknown) => void;

const SNAPSHOT_KEY = 'agente_pedro_timer_v1';
const EVENT_KEY = 'agente_pedro_state_event_v1';
const EVENT_NAME = 'pedro://state';
const handlers = new Map<EventKind, Set<Handler>>();
const seen = new Set<string>();
const identifier = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const stateActor = identifier();
let channel: BroadcastChannel | null = null;
let nativeEmit: ((name: string, payload: StateEvent) => Promise<void>) | null = null;
let setupPromise: Promise<void> | null = null;
let consumers = 0;
let cleanups: Array<() => void> = [];

export function isTimerSnapshot(value: unknown): value is TimerSnapshot {
  if (!value || typeof value !== 'object') return false;
  const timer = value as TimerSnapshot;
  const states: SharedTimerState[] = ['idle', 'focus', 'break', 'paused', 'completed'];
  const active = timer.pomodoroState === 'focus' || timer.pomodoroState === 'break';
  return timer.version === 1 && Number.isSafeInteger(timer.revision) && timer.revision >= 0
    && typeof timer.actor === 'string' && states.includes(timer.pomodoroState)
    && (timer.currentMode === 'focus' || timer.currentMode === 'break')
    && Number.isSafeInteger(timer.totalDurationSeconds) && timer.totalDurationSeconds > 0
    && Number.isSafeInteger(timer.remainingSeconds) && timer.remainingSeconds >= 0
    && timer.remainingSeconds <= timer.totalDurationSeconds
    && (timer.targetTimestamp === null || (Number.isSafeInteger(timer.targetTimestamp) && timer.targetTimestamp > 0))
    && (!active || (timer.targetTimestamp !== null && timer.sessionId !== null && timer.pomodoroState === timer.currentMode))
    && (active || timer.targetTimestamp === null)
    && (timer.completedAt == null || (timer.pomodoroState === 'completed'
      && typeof timer.completedAt === 'string' && Number.isFinite(Date.parse(timer.completedAt))
      && new Date(timer.completedAt).toISOString() === timer.completedAt))
    && (timer.sessionId === null || typeof timer.sessionId === 'string')
    && (timer.selectedTaskId === null || typeof timer.selectedTaskId === 'string');
}

export function compareTimerSnapshots(a: TimerSnapshot, b: TimerSnapshot): number {
  return a.revision - b.revision || a.actor.localeCompare(b.actor);
}

export function readTimerSnapshot(): TimerSnapshot | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null');
    return isTimerSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

/** Receiving a snapshot never republishes an event. Only repair an older stored revision. */
export function retainTimerSnapshot(snapshot: TimerSnapshot): void {
  try {
    const stored = readTimerSnapshot();
    const order = stored ? compareTimerSnapshots(snapshot, stored) : 1;
    if (!stored || order > 0 || (order === 0 && !stored.completedAt && snapshot.completedAt)) {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    }
  } catch (error) {
    console.warn('[Agente Pedro] Não foi possível guardar o estado do foco:', error);
  }
}

export function registerStateHandler(kind: EventKind, handler: Handler): () => void {
  const listeners = handlers.get(kind) ?? new Set<Handler>();
  listeners.add(handler);
  handlers.set(kind, listeners);
  return () => listeners.delete(handler);
}

function deliver(kind: EventKind, payload?: unknown): void {
  handlers.get(kind)?.forEach((handler) => handler(payload));
}

function receive(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const event = value as StateEvent;
  if (event.version !== 1 || typeof event.id !== 'string' || typeof event.source !== 'string'
    || event.source === stateActor || seen.has(event.id)
    || !['timer:snapshot', 'timer:request', 'focus:changed', 'finance:changed'].includes(event.kind)) return;
  if (event.kind === 'timer:snapshot' && !isTimerSnapshot(event.payload)) return;
  seen.add(event.id);
  if (seen.size > 256) seen.delete(seen.values().next().value!);
  deliver(event.kind, event.payload);
}

export async function publishStateEvent(kind: EventKind, payload?: unknown): Promise<void> {
  const event: StateEvent = { version: 1, id: identifier(), source: stateActor, kind, payload };
  // Storage is also the fallback transport when BroadcastChannel is unavailable.
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify(event));
  } catch (error) {
    console.warn('[Agente Pedro] Comunicação entre janelas indisponível no armazenamento:', error);
  }
  try {
    channel?.postMessage(event);
    await nativeEmit?.(EVENT_NAME, event);
  } catch (error) {
    console.warn('[Agente Pedro] Não foi possível avisar a outra janela:', error);
  }
}

export function publishTimerSnapshot(snapshot: TimerSnapshot): void {
  retainTimerSnapshot(snapshot);
  void publishStateEvent('timer:snapshot', snapshot);
}

async function setup(): Promise<void> {
  const onStorage = (event: StorageEvent) => {
    if (!event.newValue) return;
    try {
      const value: unknown = JSON.parse(event.newValue);
      if (event.key === SNAPSHOT_KEY && isTimerSnapshot(value)) deliver('timer:snapshot', value);
      if (event.key === EVENT_KEY) receive(value);
    } catch { /* Ignore unrelated or malformed storage updates. */ }
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { listen, emit } = await import('@tauri-apps/api/event');
      cleanups.push(await listen<StateEvent>(EVENT_NAME, ({ payload }) => receive(payload)));
      nativeEmit = emit;
    } catch (error) {
      console.warn('[Agente Pedro] Eventos nativos indisponíveis; usando armazenamento compartilhado:', error);
    }
  } else if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('agente-pedro-state-v1');
      channel.onmessage = ({ data }) => receive(data);
      cleanups.push(() => { channel?.close(); channel = null; });
    } catch (error) {
      console.warn('[Agente Pedro] Canal do navegador indisponível; usando armazenamento compartilhado:', error);
    }
  }

  // Register listeners before hydration/request so a command cannot be missed during startup.
  const stored = readTimerSnapshot();
  if (stored) deliver('timer:snapshot', stored);
  await publishStateEvent('timer:request');
  await publishStateEvent('focus:changed');
  await publishStateEvent('finance:changed');
}

/** One transport per WebView, including React StrictMode's setup/cleanup cycle. */
export async function initializeStateBridge(): Promise<() => void> {
  consumers += 1;
  setupPromise ??= setup();
  try {
    await setupPromise;
  } catch (error) {
    consumers -= 1;
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    consumers -= 1;
    if (consumers === 0) {
      cleanups.forEach((cleanup) => cleanup());
      cleanups = [];
      nativeEmit = null;
      setupPromise = null;
      seen.clear();
    }
  };
}
