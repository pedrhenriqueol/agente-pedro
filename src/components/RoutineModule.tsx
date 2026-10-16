import { useId, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, CheckCircle2, Circle, Flame, Pause, Play, Plus, RotateCcw, Target, Trash2 } from 'lucide-react';
import { POMODORO_CONFIG, useFocusStore } from '../stores/useFocusStore';
import { localDate } from '../database/date';
import type { TaskPriority } from '../database/types';
import { FocusModeSwitch } from './ui/FocusModeSwitch';
import '../styles/routine.css';

const priorities: Record<TaskPriority, string> = { high: 'Alta', med: 'Média', low: 'Baixa' };

function timerLabel(seconds: number) {
  const value = Math.max(0, seconds);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function dueDateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

export function FocusCard({ compact = false }: { compact?: boolean }) {
  const {
    pomodoroState, currentMode, totalDurationSeconds, remainingSeconds, sessionSaveState,
    startPomodoro, pausePomodoro, resumePomodoro, resetPomodoro, setPomodoroMode,
    selectedTaskId, selectTask, tasks, refreshData, isLoading,
  } = useFocusStore(useShallow((state) => ({
    pomodoroState: state.pomodoroState, currentMode: state.currentMode,
    totalDurationSeconds: state.totalDurationSeconds, remainingSeconds: state.remainingSeconds,
    sessionSaveState: state.sessionSaveState, startPomodoro: state.startPomodoro,
    pausePomodoro: state.pausePomodoro, resumePomodoro: state.resumePomodoro,
    resetPomodoro: state.resetPomodoro, setPomodoroMode: state.setPomodoroMode,
    selectedTaskId: state.selectedTaskId, selectTask: state.selectTask, tasks: state.tasks,
    refreshData: state.refreshData, isLoading: state.isLoading,
  })));
  const selectionId = useId();
  const running = pomodoroState === 'focus' || pomodoroState === 'break';
  const started = running || pomodoroState === 'paused';
  const completed = pomodoroState === 'completed';
  const recordPending = sessionSaveState === 'saving' || sessionSaveState === 'error';
  const progress = Math.max(0, Math.min(1, (totalDurationSeconds - remainingSeconds) / Math.max(1, totalDurationSeconds)));
  const circumference = 2 * Math.PI * 78;
  const pending = tasks.filter((task) => task.completed === 0);
  const selected = tasks.find((task) => task.id === selectedTaskId);
  const stateLabel = completed
    ? currentMode === 'focus' ? 'Seu tempo de foco terminou' : 'Sua pausa terminou'
    : pomodoroState === 'paused' ? 'Sessão pausada'
    : running ? currentMode === 'focus' ? 'Foco em andamento' : 'Pausa em andamento'
    : 'Pronto quando você estiver';

  return (
    <section className={`panel focus-card${compact ? ' focus-card--compact' : ''}`} aria-label="Seu momento de foco">
      <header className="routine-panel-heading">
        <div>
          <span className="eyebrow">Um passo por vez</span>
          <h2>Seu momento de foco</h2>
        </div>
        <Target size={21} className="focus-heading-icon" aria-hidden="true" />
      </header>
      <FocusModeSwitch mode={currentMode} onChange={setPomodoroMode} disabled={started || recordPending}
        durations={{ focus: POMODORO_CONFIG.DEFAULT_FOCUS_MINUTES, break: POMODORO_CONFIG.DEFAULT_BREAK_MINUTES }} />
      <div className={`focus-clock${currentMode === 'break' ? ' focus-clock--break' : ''}`}>
        <svg className="focus-clock-ring" viewBox="0 0 180 180" aria-hidden="true">
          <circle className="focus-ring-track" cx="90" cy="90" r="78" />
          <circle className="focus-ring-progress" cx="90" cy="90" r="78" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
        </svg>
        <div className="focus-clock-value">
          <span className="focus-time" role="timer" aria-label={`${Math.floor(remainingSeconds / 60)} minutos e ${remainingSeconds % 60} segundos restantes`}>
            {timerLabel(remainingSeconds)}
          </span>
          <span className="focus-clock-caption">{currentMode === 'focus' ? 'para se concentrar' : 'para respirar'}</span>
        </div>
      </div>
      <p className="focus-session-state" role="status">
        <span className={`focus-state-dot${running ? ' is-running' : ''}`} aria-hidden="true" />
        {stateLabel}
      </p>
      {currentMode === 'focus' && (
        <div className="focus-task-selection">
          <label className="label" htmlFor={selectionId}>Em que você quer se concentrar?</label>
          <select id={selectionId} className="field" value={selectedTaskId ?? ''} disabled={started || recordPending} onChange={(event) => selectTask(event.target.value || null)}>
            <option value="">Sessão livre</option>
            {pending.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            {selected?.completed === 1 && <option value={selected.id}>{selected.title} · concluída</option>}
          </select>
          <p className="muted focus-selection-help">
            {started ? 'A tarefa fica vinculada até você reiniciar o tempo.' : 'Escolha uma tarefa ou reserve esse tempo para você.'}
          </p>
        </div>
      )}
      {started && <p className="muted focus-mode-help">Reinicie o tempo para escolher outra duração.</p>}
      <div className="focus-actions">
        {running ? (
          <button type="button" className="button primary" onClick={pausePomodoro}><Pause size={16} aria-hidden="true" /> Pausar</button>
        ) : pomodoroState === 'paused' ? (
          <button type="button" className="button primary" onClick={resumePomodoro}><Play size={16} aria-hidden="true" /> Continuar</button>
        ) : (
          <button type="button" className="button primary" onClick={() => startPomodoro(currentMode)} disabled={recordPending}><Play size={16} aria-hidden="true" /> {currentMode === 'focus' ? 'Começar foco' : 'Começar pausa'}</button>
        )}
        <button type="button" className="button secondary" onClick={resetPomodoro} disabled={(pomodoroState === 'idle' && remainingSeconds === totalDurationSeconds) || recordPending}>
          <RotateCcw size={15} aria-hidden="true" /> Reiniciar tempo
        </button>
      </div>
      {completed && currentMode === 'focus' && (
        <div className={`focus-completion${sessionSaveState === 'error' ? ' notice error' : ''}`} role={sessionSaveState === 'error' ? 'alert' : 'status'}>
          {sessionSaveState === 'saving' ? 'Registrando a sessão…'
            : sessionSaveState === 'saved' ? 'Sessão registrada. Sua tarefa continua sob seu controle: conclua quando estiver pronta.'
            : sessionSaveState === 'error' ? 'O tempo terminou, mas não foi possível salvar o registro. Tente registrar esta sessão antes de começar outra.'
            : 'O tempo terminou. Faça uma pausa e continue no seu ritmo.'}
          {sessionSaveState === 'error' && <button type="button" className="button secondary" disabled={isLoading} onClick={() => { void refreshData().catch(() => undefined); }}>Tentar registrar novamente</button>}
        </div>
      )}
    </section>
  );
}

export function RoutineModule() {
  const { tasks, habits, isLoading, hasLoadedData, error, clearError, refreshData, addTask, toggleTask, removeTask, addHabit, completeHabit, selectedTaskId } = useFocusStore(useShallow((state) => ({
    tasks: state.tasks, habits: state.habits, isLoading: state.isLoading, hasLoadedData: state.hasLoadedData, error: state.error,
    clearError: state.clearError, refreshData: state.refreshData, addTask: state.addTask,
    toggleTask: state.toggleTask, removeTask: state.removeTask, addHabit: state.addHabit,
    completeHabit: state.completeHabit, selectedTaskId: state.selectedTaskId,
  })));
  const taskId = useId();
  const priorityId = useId();
  const habitId = useId();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('med');
  const [newHabitName, setNewHabitName] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingHabit, setCreatingHabit] = useState(false);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [taskNotice, setTaskNotice] = useState('');
  const [habitNotice, setHabitNotice] = useState('');
  const pendingCount = tasks.filter((task) => task.completed === 0).length;
  const completedCount = tasks.length - pendingCount;
  const today = localDate();
  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);
  const yesterday = localDate(previousDay);
  const completedHabits = habits.filter((habit) => habit.last_completed === today).length;

  const handleCreateTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!newTaskTitle.trim() || creatingTask) return;
    setCreatingTask(true);
    setTaskNotice('');
    clearError();
    try {
      await addTask(newTaskTitle.trim(), newTaskPriority);
      setNewTaskTitle('');
      setTaskNotice('Tarefa adicionada. Você pode vinculá-la à próxima sessão de foco.');
    } catch {
      // A store apresenta a falha; o formulário mantém o conteúdo para tentar novamente.
    } finally {
      setCreatingTask(false);
    }
  };

  const handleCreateHabit = async (event: FormEvent) => {
    event.preventDefault();
    if (!newHabitName.trim() || creatingHabit) return;
    setCreatingHabit(true);
    setHabitNotice('');
    clearError();
    try {
      await addHabit(newHabitName.trim());
      setNewHabitName('');
      setHabitNotice('Hábito adicionado. Marque quando fizer hoje.');
    } catch {
      // Mantém o nome quando a gravação não foi confirmada.
    } finally {
      setCreatingHabit(false);
    }
  };

  const updateItem = async (id: string, action: () => Promise<void>, success: () => void) => {
    if (busyItems.has(id)) return;
    setBusyItems((current) => new Set(current).add(id));
    setTaskNotice('');
    setHabitNotice('');
    clearError();
    try {
      await action();
      success();
    } catch {
      // O estado anterior permanece visível quando a ação falha.
    } finally {
      setBusyItems((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  };

  return (
    <div className="routine-page">
      {error && (
        <div className="notice error routine-load-error" role="alert">
          <p>{error}</p>
          <div className="routine-notice-actions">
            <button type="button" className="button secondary" disabled={isLoading} onClick={() => { void refreshData().catch(() => undefined); }}>Tentar novamente</button>
            <button type="button" className="button ghost" onClick={clearError}>Fechar aviso</button>
          </div>
        </div>
      )}
      <div className="routine-layout">
        <div className="routine-support-column">
          <FocusCard />
          <section className="panel habit-panel" aria-labelledby={`${habitId}-heading`}>
            <header className="routine-panel-heading">
              <div>
                <h2 id={`${habitId}-heading`}>Pequenas constâncias</h2>
                <p className="muted">Hábitos que você quer levar para o dia a dia.</p>
              </div>
              <Flame size={20} className="habit-heading-icon" aria-hidden="true" />
            </header>
            {isLoading && habits.length === 0 ? <p className="muted" role="status">Carregando hábitos…</p>
              : !hasLoadedData && error && habits.length === 0 ? <p className="muted">Seus hábitos não puderam ser carregados.</p>
              : habits.length === 0 ? (
                <div className="empty-state routine-empty">
                  <Circle size={25} aria-hidden="true" />
                  <h3>Comece com um hábito simples</h3>
                  <p>Como ler por dez minutos ou fazer uma pausa. Você acompanha um dia de cada vez.</p>
                </div>
              ) : (
                <>
                  <p className="habit-today-count muted">{completedHabits} de {habits.length} {habits.length === 1 ? 'feito hoje' : 'feitos hoje'}</p>
                  <ul className="habit-list">
                    {habits.map((habit) => {
                      const completedToday = habit.last_completed === today;
                      return (
                        <li className={`habit-row${completedToday ? ' is-completed' : ''}`} key={habit.id}>
                          <button type="button" className="icon-button routine-check" disabled={completedToday || busyItems.has(habit.id)} aria-label={completedToday ? `${habit.name}: feito hoje` : `Marcar ${habit.name} como feito hoje`} onClick={() => { void updateItem(habit.id, () => completeHabit(habit.id), () => setHabitNotice(`${habit.name}: feito hoje.`)); }}>
                            {completedToday ? <CheckCircle2 size={21} aria-hidden="true" /> : <Circle size={21} aria-hidden="true" />}
                          </button>
                          <div className="habit-row-copy">
                            <span className="habit-name">{habit.name}</span>
                            <span className="muted">{completedToday ? 'Feito hoje' : 'Ainda não marcado hoje'}</span>
                          </div>
                          {habit.streak_count > 0 && (completedToday || habit.last_completed === yesterday) && <span className="habit-streak" title="Sequência de dias com este hábito"><Flame size={14} aria-hidden="true" /> {habit.streak_count} {habit.streak_count === 1 ? 'dia' : 'dias'}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            <form className="routine-create-form habit-create-form" onSubmit={handleCreateHabit}>
              <label className="label" htmlFor={habitId}>Adicionar hábito</label>
              <div className="routine-inline-form">
                <input id={habitId} className="field" type="text" maxLength={120} placeholder="Ex.: ler por dez minutos" value={newHabitName} onChange={(event) => setNewHabitName(event.target.value)} disabled={creatingHabit} required />
                <button type="submit" className="button secondary" disabled={creatingHabit || !newHabitName.trim()}><Plus size={16} aria-hidden="true" /> {creatingHabit ? 'Adicionando…' : 'Adicionar'}</button>
              </div>
            </form>
            {habitNotice && <p className="routine-feedback" role="status">{habitNotice}</p>}
          </section>
        </div>

        <section className="panel task-panel" aria-labelledby={`${taskId}-heading`}>
          <header className="routine-panel-heading">
            <div>
              <h2 id={`${taskId}-heading`}>Suas tarefas</h2>
              <p className="muted">Tire da cabeça. Escolha uma prioridade e comece.</p>
            </div>
            {tasks.length > 0 && <span className="badge">{pendingCount} {pendingCount === 1 ? 'pendente' : 'pendentes'}</span>}
          </header>
          <form className="routine-create-form task-create-form" onSubmit={handleCreateTask}>
            <div className="task-title-field">
              <label className="label" htmlFor={taskId}>O que você precisa fazer?</label>
              <input id={taskId} className="field" type="text" maxLength={240} placeholder="Ex.: preparar a próxima entrega" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} disabled={creatingTask} required />
            </div>
            <div className="task-priority-field">
              <label className="label" htmlFor={priorityId}>Prioridade</label>
              <select id={priorityId} className="field" value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value as TaskPriority)} disabled={creatingTask}>
                <option value="high">Alta</option><option value="med">Média</option><option value="low">Baixa</option>
              </select>
            </div>
            <button type="submit" className="button primary" disabled={creatingTask || !newTaskTitle.trim()}><Plus size={16} aria-hidden="true" /> {creatingTask ? 'Adicionando…' : 'Adicionar'}</button>
          </form>
          {taskNotice && <p className="routine-feedback" role="status">{taskNotice}</p>}
          {isLoading && tasks.length === 0 ? <p className="muted" role="status">Carregando tarefas…</p>
            : !hasLoadedData && error && tasks.length === 0 ? <p className="muted">Suas tarefas não puderam ser carregadas.</p>
            : tasks.length === 0 ? (
              <div className="empty-state routine-empty task-empty">
                <CheckCircle2 size={32} aria-hidden="true" />
                <h3>Espaço para o que importa</h3>
                <p>Adicione sua primeira tarefa acima. Depois, escolha-a no temporizador para dedicar um momento de foco.</p>
              </div>
            ) : (
              <ul className="task-list">
                {[...tasks.filter((task) => task.completed === 0), ...tasks.filter((task) => task.completed === 1)].map((task) => {
                  const isCompleted = task.completed === 1;
                  const overdue = !isCompleted && task.due_date !== null && task.due_date.slice(0, 10) < today;
                  return (
                    <li className={`task-row${isCompleted ? ' is-completed' : ''}${selectedTaskId === task.id ? ' is-selected' : ''}`} key={task.id}>
                      <button type="button" className="icon-button routine-check" aria-pressed={isCompleted} aria-label={`${isCompleted ? 'Reabrir' : 'Concluir'} tarefa: ${task.title}`} disabled={busyItems.has(task.id)} onClick={() => { void updateItem(task.id, () => toggleTask(task.id, task.completed), () => setTaskNotice(isCompleted ? 'Tarefa reaberta.' : 'Tarefa concluída.')); }}>
                        {isCompleted ? <CheckCircle2 size={21} aria-hidden="true" /> : <Circle size={21} aria-hidden="true" />}
                      </button>
                      <div className="task-row-copy">
                        <span className="task-name">{task.title}</span>
                        <div className="task-metadata">
                          <span className={`task-priority task-priority--${task.priority}`}>Prioridade {priorities[task.priority].toLocaleLowerCase('pt-BR')}</span>
                          {task.due_date && <span className={overdue ? 'task-due is-overdue' : 'task-due'}>{overdue ? 'Venceu em ' : 'Vence em '}<time dateTime={task.due_date}>{dueDateLabel(task.due_date)}</time></span>}
                          {selectedTaskId === task.id && !isCompleted && <span className="task-focus-tag"><Target size={12} aria-hidden="true" /> No seu foco</span>}
                          {isCompleted && <span className="task-completed-label"><Check size={12} aria-hidden="true" /> Concluída</span>}
                        </div>
                      </div>
                      <button type="button" className="icon-button task-delete" aria-label={`Excluir tarefa: ${task.title}`} title="Excluir tarefa" disabled={busyItems.has(task.id)} onClick={() => { void updateItem(task.id, () => removeTask(task.id), () => setTaskNotice('Tarefa excluída.')); }}><Trash2 size={16} aria-hidden="true" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          {tasks.length > 0 && <footer className="task-summary muted">{completedCount} de {tasks.length} {tasks.length === 1 ? 'tarefa concluída' : 'tarefas concluídas'}. {pendingCount === 0 ? 'Tudo em dia por aqui.' : 'Você define o seu ritmo.'}</footer>}
        </section>
      </div>
    </div>
  );
}
