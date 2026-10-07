import { create } from 'zustand';
import {
  fetchHabits,
  fetchTasks,
  insertHabit,
  insertTask,
  persistPomodoroSession,
  registerHabitCompletion,
  updateTaskCompletion,
  deleteTask,
} from '../database/database';
import type { Habit, Task, TaskPriority } from '../database/types';

export type PomodoroState = 'idle' | 'focus' | 'break' | 'paused' | 'completed';

export const POMODORO_CONFIG = {
  DEFAULT_FOCUS_MINUTES: 25,
  DEFAULT_BREAK_MINUTES: 5,
} as const;

interface FocusStore {
  // Pomodoro
  pomodoroState: PomodoroState;
  currentMode: 'focus' | 'break';
  totalDurationSeconds: number;
  remainingSeconds: number;
  targetTimestamp: number | null;
  timerIntervalId: number | null;

  startPomodoro: (mode?: 'focus' | 'break') => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  resetPomodoro: () => void;
  tickTimer: () => void;

  // Rotina (Tarefas & Hábitos)
  tasks: Task[];
  habits: Habit[];
  isLoading: boolean;

  loadInitialData: () => void;
  addTask: (title: string, priority: TaskPriority, dueDate?: string | null) => Promise<void>;
  toggleTask: (id: string, currentCompleted: number) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  addHabit: (name: string, frequency?: string) => Promise<void>;
  completeHabit: (id: string) => Promise<void>;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  // Estado inicial do Pomodoro
  pomodoroState: 'idle',
  currentMode: 'focus',
  totalDurationSeconds: POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES * 60,
  remainingSeconds: POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES * 60,
  targetTimestamp: null,
  timerIntervalId: null,

  startPomodoro: (mode = 'focus') => {
    const { timerIntervalId } = get();
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
    }

    const durationMinutes =
      mode === 'focus'
        ? POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES
        : POMODORO_CONFIG.DEFAULT_BREAK_MINUTES;
    const durationSeconds = durationMinutes * 60;
    const now = Date.now();
    const target = now + durationSeconds * 1000;

    const intervalId = window.setInterval(() => {
      get().tickTimer();
    }, 1000);

    set({
      pomodoroState: mode === 'focus' ? 'focus' : 'break',
      currentMode: mode,
      totalDurationSeconds: durationSeconds,
      remainingSeconds: durationSeconds,
      targetTimestamp: target,
      timerIntervalId: intervalId,
    });
  },

  pausePomodoro: () => {
    const { timerIntervalId, targetTimestamp, remainingSeconds } = get();
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
    }

    let calculatedRemaining = remainingSeconds;
    if (targetTimestamp !== null) {
      const diffMs = targetTimestamp - Date.now();
      calculatedRemaining = Math.max(0, Math.ceil(diffMs / 1000));
    }

    set({
      pomodoroState: 'paused',
      remainingSeconds: calculatedRemaining,
      targetTimestamp: null,
      timerIntervalId: null,
    });
  },

  resumePomodoro: () => {
    const { timerIntervalId, remainingSeconds, currentMode } = get();
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
    }

    const now = Date.now();
    const target = now + remainingSeconds * 1000;

    const intervalId = window.setInterval(() => {
      get().tickTimer();
    }, 1000);

    set({
      pomodoroState: currentMode === 'focus' ? 'focus' : 'break',
      targetTimestamp: target,
      timerIntervalId: intervalId,
    });
  },

  resetPomodoro: () => {
    const { timerIntervalId, currentMode } = get();
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
    }

    const durationMinutes =
      currentMode === 'focus'
        ? POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES
        : POMODORO_CONFIG.DEFAULT_BREAK_MINUTES;

    set({
      pomodoroState: 'idle',
      totalDurationSeconds: durationMinutes * 60,
      remainingSeconds: durationMinutes * 60,
      targetTimestamp: null,
      timerIntervalId: null,
    });
  },

  tickTimer: () => {
    const { targetTimestamp, timerIntervalId, currentMode } = get();
    if (!targetTimestamp) return;

    const diffMs = targetTimestamp - Date.now();
    const remaining = Math.max(0, Math.ceil(diffMs / 1000));

    if (remaining <= 0) {
      if (timerIntervalId !== null) {
        clearInterval(timerIntervalId);
      }

      // Persiste no SQLite se for sessão de foco real concluída
      if (currentMode === 'focus') {
        persistPomodoroSession(POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES).catch((err) =>
          console.error('[Pomodoro] Falha ao persistir sessão:', err)
        );
      }

      set({
        pomodoroState: 'completed',
        remainingSeconds: 0,
        targetTimestamp: null,
        timerIntervalId: null,
      });
    } else {
      set({ remainingSeconds: remaining });
    }
  },

  // ── Gestão de Tarefas e Hábitos ──
  tasks: [],
  habits: [],
  isLoading: false,

  loadInitialData: async () => {
    set({ isLoading: true });
    try {
      const [tasks, habits] = await Promise.all([fetchTasks(), fetchHabits()]);
      set({ tasks, habits, isLoading: false });
    } catch (error) {
      console.error('[FocusStore] Erro ao carregar dados:', error);
      set({ isLoading: false });
    }
  },

  addTask: async (title: string, priority: TaskPriority, dueDate = null) => {
    if (!title.trim()) return;
    try {
      const newTask = await insertTask(title.trim(), priority, dueDate);
      set((state) => ({ tasks: [newTask, ...state.tasks] }));
    } catch (error) {
      console.error('[FocusStore] Erro ao adicionar tarefa:', error);
    }
  },

  toggleTask: async (id: string, currentCompleted: number) => {
    const nextCompleted = currentCompleted === 1 ? 0 : 1;
    try {
      await updateTaskCompletion(id, nextCompleted === 1);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, completed: nextCompleted } : t)),
      }));
    } catch (error) {
      console.error('[FocusStore] Erro ao alterar tarefa:', error);
    }
  },

  removeTask: async (id: string) => {
    try {
      await deleteTask(id);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      }));
    } catch (error) {
      console.error('[FocusStore] Erro ao excluir tarefa:', error);
    }
  },

  addHabit: async (name: string, frequency = 'daily') => {
    if (!name.trim()) return;
    try {
      const newHabit = await insertHabit(name.trim(), frequency);
      set((state) => ({ habits: [...state.habits, newHabit] }));
    } catch (error) {
      console.error('[FocusStore] Erro ao adicionar hábito:', error);
    }
  },

  completeHabit: async (id: string) => {
    try {
      const res = await registerHabitCompletion(id);
      set((state) => ({
        habits: state.habits.map((h) =>
          h.id === id
            ? { ...h, streak_count: res.streak_count, last_completed: res.last_completed }
            : h
        ),
      }));
    } catch (error) {
      console.error('[FocusStore] Erro ao completar hábito:', error);
    }
  },
}));
