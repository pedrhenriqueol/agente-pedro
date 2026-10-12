import { create } from 'zustand';
import {
  fetchHabits, fetchTasks, fetchPomodoroSessions, insertHabit, insertTask,
  persistPomodoroSession, registerHabitCompletion, updateTaskCompletion, deleteTask,
} from '../database/database';
import type { Habit, PomodoroSession, Task, TaskPriority } from '../database/types';
import {
  compareTimerSnapshots, isTimerSnapshot, publishStateEvent, publishTimerSnapshot,
  readTimerSnapshot, registerStateHandler, retainTimerSnapshot, stateActor,
} from '../services/stateBridge';
import type { SharedTimerState, TimerSnapshot } from '../services/stateBridge';

export type PomodoroState = SharedTimerState;
export const POMODORO_CONFIG = { DEFAULT_FOCUS_MINUTES: 25, DEFAULT_BREAK_MINUTES: 5 } as const;

interface FocusStore {
  pomodoroState: PomodoroState;
  currentMode: 'focus' | 'break';
  totalDurationSeconds: number;
  remainingSeconds: number;
  targetTimestamp: number | null;
  completedAt: string | null;
  timerIntervalId: number | null;
  sessionId: string | null;
  selectedTaskId: string | null;
  revision: number;
  actor: string;
  sessionSaveState: 'idle' | 'saving' | 'saved' | 'error';
  startPomodoro: (mode?: 'focus' | 'break') => void;
  setPomodoroMode: (mode: 'focus' | 'break') => void;
  selectTask: (id: string | null) => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  resetPomodoro: () => void;
  tickTimer: () => void;
  tasks: Task[];
  habits: Habit[];
  sessions: PomodoroSession[];
  isLoading: boolean;
  hasLoadedData: boolean;
  error: string | null;
  clearError: () => void;
  loadInitialData: () => Promise<void>;
  refreshData: () => Promise<void>;
  addTask: (title: string, priority: TaskPriority, dueDate?: string | null) => Promise<void>;
  toggleTask: (id: string, currentCompleted: number) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  addHabit: (name: string, frequency?: string) => Promise<void>;
  completeHabit: (id: string) => Promise<void>;
}

const durationFor = (mode: 'focus' | 'break') => (mode === 'focus'
  ? POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES : POMODORO_CONFIG.DEFAULT_BREAK_MINUTES) * 60;
const initialTimer: TimerSnapshot = readTimerSnapshot() ?? {
  version: 1, revision: 0, actor: stateActor, pomodoroState: 'idle', currentMode: 'focus',
  totalDurationSeconds: durationFor('focus'), remainingSeconds: durationFor('focus'),
  targetTimestamp: null, completedAt: null, sessionId: null, selectedTaskId: null,
};
let loaded = false;
let loadPromise: Promise<void> | null = null;
const savingSessions = new Map<string, Promise<void>>();

function snapshot(): TimerSnapshot {
  const state = useFocusStore.getState();
  return {
    version: 1, revision: state.revision, actor: state.actor,
    pomodoroState: state.pomodoroState, currentMode: state.currentMode,
    totalDurationSeconds: state.totalDurationSeconds, remainingSeconds: state.remainingSeconds,
    targetTimestamp: state.targetTimestamp, completedAt: state.completedAt,
    sessionId: state.sessionId, selectedTaskId: state.selectedTaskId,
  };
}

function stopInterval(): void {
  const intervalId = useFocusStore.getState().timerIntervalId;
  if (intervalId !== null) window.clearInterval(intervalId);
}

function startInterval(): number {
  stopInterval();
  // Rendering clocks derive from the deadline; no cross-window event is sent by a tick.
  return window.setInterval(() => useFocusStore.getState().tickTimer(), 250);
}

function publishCommand(): void {
  const stored = readTimerSnapshot();
  const revision = Math.max(Date.now(), useFocusStore.getState().revision + 1, (stored?.revision ?? 0) + 1);
  useFocusStore.setState({ revision, actor: stateActor });
  publishTimerSnapshot(snapshot());
}

function syncLatestTimer(): void {
  const stored = readTimerSnapshot();
  if (stored && compareTimerSnapshots(stored, snapshot()) > 0) applyTimerSnapshot(stored);
}

async function loadData(): Promise<void> {
  if (loadPromise) return loadPromise;
  useFocusStore.setState({ isLoading: true });
  loadPromise = (async () => {
    try {
      const [tasks, habits, sessions] = await Promise.all([fetchTasks(), fetchHabits(), fetchPomodoroSessions()]);
      useFocusStore.setState({ tasks, habits, sessions, isLoading: false, hasLoadedData: true, error: null });
      loaded = true;
    } catch (error) {
      useFocusStore.setState({ isLoading: false, error: 'Não foi possível carregar sua rotina. Tente novamente.' });
      throw error;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function saveSession(sessionId: string, durationSeconds: number, completedAt: string | null): Promise<void> {
  const existing = savingSessions.get(sessionId);
  if (existing) return existing;
  const state = useFocusStore.getState();
  if (state.sessions.some((session) => session.id === sessionId)) {
    if (state.sessionId === sessionId) useFocusStore.setState({ sessionSaveState: 'saved' });
    return;
  }
  if (state.sessionId === sessionId) useFocusStore.setState({ sessionSaveState: 'saving' });
  const promise = (async () => {
    try {
      const session = await persistPomodoroSession(Math.round(durationSeconds / 60), sessionId, completedAt ?? undefined);
      useFocusStore.setState((current) => ({
        sessions: current.sessions.some((item) => item.id === session.id) ? current.sessions : [session, ...current.sessions],
        ...(current.sessionId === sessionId ? { sessionSaveState: 'saved' as const } : {}),
      }));
      await publishStateEvent('focus:changed');
    } catch (error) {
      if (useFocusStore.getState().sessionId === sessionId) useFocusStore.setState({
        sessionSaveState: 'error', error: 'A sessão terminou, mas não foi possível salvar o registro. Tente atualizar a rotina.',
      });
      console.error('[Agente Pedro] Falha ao salvar sessão:', error);
    } finally {
      savingSessions.delete(sessionId);
    }
  })();
  savingSessions.set(sessionId, promise);
  return promise;
}

async function mutate(action: () => Promise<void>, message: string): Promise<void> {
  useFocusStore.setState({ error: null });
  try {
    await action();
  } catch (error) {
    useFocusStore.setState({ error: message });
    throw error;
  }
  try {
    // A read begun before this mutation must finish before a fresh read replaces it.
    if (loadPromise) await loadPromise;
    await loadData();
  } catch {
    useFocusStore.setState({ error: 'O registro foi salvo, mas não foi possível atualizar a rotina. Tente atualizar novamente.' });
  }
  await publishStateEvent('focus:changed');
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  ...initialTimer,
  completedAt: initialTimer.completedAt ?? null,
  timerIntervalId: null, sessionSaveState: 'idle', tasks: [], habits: [], sessions: [], isLoading: false, hasLoadedData: false, error: null,
  clearError: () => set({ error: null }),

  startPomodoro: (mode = 'focus') => {
    syncLatestTimer();
    if (get().sessionSaveState === 'saving' || get().sessionSaveState === 'error') return;
    const seconds = durationFor(mode);
    const sessionId = `pomo-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    set({
      pomodoroState: mode, currentMode: mode, totalDurationSeconds: seconds, remainingSeconds: seconds,
      targetTimestamp: Date.now() + seconds * 1000, completedAt: null, sessionId, sessionSaveState: 'idle', error: null,
      timerIntervalId: startInterval(),
    });
    publishCommand();
  },

  setPomodoroMode: (mode) => {
    syncLatestTimer();
    if (get().sessionSaveState === 'saving' || get().sessionSaveState === 'error') return;
    if (get().currentMode === mode) return;
    stopInterval();
    const seconds = durationFor(mode);
    set({ currentMode: mode, pomodoroState: 'idle', totalDurationSeconds: seconds, remainingSeconds: seconds,
      targetTimestamp: null, completedAt: null, timerIntervalId: null, sessionId: null, sessionSaveState: 'idle' });
    publishCommand();
  },

  selectTask: (id) => {
    syncLatestTimer();
    if (get().sessionSaveState === 'saving' || get().sessionSaveState === 'error') return;
    if (get().selectedTaskId === id) return;
    set({ selectedTaskId: id });
    publishCommand();
  },

  pausePomodoro: () => {
    syncLatestTimer();
    const { targetTimestamp, pomodoroState } = get();
    if ((pomodoroState !== 'focus' && pomodoroState !== 'break') || targetTimestamp === null) return;
    const remaining = Math.max(0, Math.ceil((targetTimestamp - Date.now()) / 1000));
    if (remaining === 0) { get().tickTimer(); return; }
    stopInterval();
    set({ pomodoroState: 'paused', remainingSeconds: remaining, targetTimestamp: null, timerIntervalId: null });
    publishCommand();
  },

  resumePomodoro: () => {
    syncLatestTimer();
    const { remainingSeconds, currentMode, pomodoroState } = get();
    if (pomodoroState !== 'paused' || remainingSeconds <= 0) return;
    set({ pomodoroState: currentMode, targetTimestamp: Date.now() + remainingSeconds * 1000, completedAt: null,
      timerIntervalId: startInterval() });
    publishCommand();
  },

  resetPomodoro: () => {
    syncLatestTimer();
    if (get().sessionSaveState === 'saving' || get().sessionSaveState === 'error') return;
    stopInterval();
    const seconds = durationFor(get().currentMode);
    set({ pomodoroState: 'idle', totalDurationSeconds: seconds, remainingSeconds: seconds,
      targetTimestamp: null, completedAt: null, timerIntervalId: null, sessionId: null, sessionSaveState: 'idle' });
    publishCommand();
  },

  tickTimer: () => {
    const { targetTimestamp, currentMode, sessionId, totalDurationSeconds, remainingSeconds } = get();
    if (targetTimestamp === null) return;
    const remaining = Math.max(0, Math.min(totalDurationSeconds, Math.ceil((targetTimestamp - Date.now()) / 1000)));
    if (remaining === 0) {
      stopInterval();
      const completedAt = new Date(targetTimestamp).toISOString();
      set({ pomodoroState: 'completed', remainingSeconds: 0, targetTimestamp: null, completedAt, timerIntervalId: null });
      publishCommand();
      if (currentMode === 'focus' && sessionId) void saveSession(sessionId, totalDurationSeconds, completedAt);
    } else if (remaining !== remainingSeconds) set({ remainingSeconds: remaining });
  },

  loadInitialData: () => loaded ? Promise.resolve() : loadData(),
  refreshData: async () => {
    if (loadPromise) await loadPromise;
    await loadData();
    const state = get();
    if (state.pomodoroState === 'completed' && state.currentMode === 'focus' && state.sessionId) {
      await saveSession(state.sessionId, state.totalDurationSeconds, state.completedAt);
    }
  },

  addTask: async (title, priority, dueDate = null) => {
    if (!title.trim()) return;
    await mutate(async () => {
      const task = await insertTask(title.trim(), priority, dueDate);
      set((state) => ({ tasks: [task, ...state.tasks] }));
    }, 'Não foi possível adicionar a tarefa. Seu texto foi mantido.');
  },
  toggleTask: async (id, currentCompleted) => {
    const completed = currentCompleted !== 1;
    await mutate(async () => {
      await updateTaskCompletion(id, completed);
      set((state) => ({ tasks: state.tasks.map((task) => task.id === id ? { ...task, completed: completed ? 1 : 0 } : task) }));
    }, 'Não foi possível atualizar a tarefa. Tente novamente.');
  },
  removeTask: async (id) => {
    await mutate(async () => {
      await deleteTask(id);
      set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
      if (get().selectedTaskId === id) get().selectTask(null);
    }, 'Não foi possível excluir a tarefa. Tente novamente.');
  },
  addHabit: async (name, frequency = 'daily') => {
    if (!name.trim()) return;
    await mutate(async () => {
      const habit = await insertHabit(name.trim(), frequency);
      set((state) => ({ habits: [...state.habits, habit] }));
    }, 'Não foi possível adicionar o hábito. Seu texto foi mantido.');
  },
  completeHabit: async (id) => {
    await mutate(async () => {
      const result = await registerHabitCompletion(id);
      set((state) => ({ habits: state.habits.map((habit) => habit.id === id
        ? { ...habit, streak_count: result.streak_count, last_completed: result.last_completed } : habit) }));
    }, 'Não foi possível registrar o hábito. Tente novamente.');
  },
}));

function applyTimerSnapshot(value: unknown): void {
  if (!isTimerSnapshot(value)) return;
  const current = snapshot();
  if (compareTimerSnapshots(value, current) <= 0) {
    retainTimerSnapshot(current);
    return;
  }
  stopInterval();
  // A completed snapshot from an older client can omit completedAt. Use a known deadline
  // for this same session before falling back to the database's legacy behavior.
  const completedAt = value.completedAt ?? (value.pomodoroState === 'completed' && value.sessionId === current.sessionId
    ? current.completedAt ?? (current.targetTimestamp !== null ? new Date(current.targetTimestamp).toISOString() : null)
    : null);
  useFocusStore.setState({ ...value, completedAt, timerIntervalId: null,
    sessionSaveState: value.sessionId === current.sessionId ? useFocusStore.getState().sessionSaveState : 'idle' });
  retainTimerSnapshot(snapshot());
  const active = value.pomodoroState === 'focus' || value.pomodoroState === 'break';
  if (active) {
    useFocusStore.setState({ timerIntervalId: startInterval() });
    useFocusStore.getState().tickTimer();
  } else if (value.pomodoroState === 'completed' && value.currentMode === 'focus' && value.sessionId) {
    void saveSession(value.sessionId, value.totalDurationSeconds, completedAt);
  }
}
registerStateHandler('timer:snapshot', applyTimerSnapshot);
registerStateHandler('timer:request', () => { void publishStateEvent('timer:snapshot', snapshot()); });
registerStateHandler('focus:changed', () => {
  void useFocusStore.getState().refreshData().catch(() => { /* The store exposes a readable error. */ });
});

// A restored active session starts a rendering clock even before the app transport initializes.
if (initialTimer.pomodoroState === 'focus' || initialTimer.pomodoroState === 'break') {
  useFocusStore.setState({ timerIntervalId: startInterval() });
  useFocusStore.getState().tickTimer();
} else if (initialTimer.pomodoroState === 'completed' && initialTimer.currentMode === 'focus' && initialTimer.sessionId) {
  void saveSession(initialTimer.sessionId, initialTimer.totalDurationSeconds, initialTimer.completedAt ?? null);
}
