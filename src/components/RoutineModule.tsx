import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Circle,
  Flame,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import type { TaskPriority } from '../database/types';

export const RoutineModule: React.FC = () => {
  const {
    pomodoroState,
    currentMode,
    totalDurationSeconds,
    remainingSeconds,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    resetPomodoro,
    tasks,
    habits,
    addTask,
    toggleTask,
    removeTask,
    addHabit,
    completeHabit,
  } = useFocusStore();

  // Estados dos formulários de inserção
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('high');
  const [newHabitName, setNewHabitName] = useState('');

  const progressPercentage = Math.round(
    ((totalDurationSeconds - remainingSeconds) / totalDurationSeconds) * 100
  );

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    await addTask(newTaskTitle, newTaskPriority);
    setNewTaskTitle('');
  };

  const handleCreateHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHabitName.trim()) return;
    await addHabit(newHabitName);
    setNewHabitName('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* ── COLUNA ESQUERDA: POMODORO & FOCO (5 colunas) ── */}
      <div className="lg:col-span-5 flex flex-col space-y-5">
        <div className="bg-industrial-surface border border-industrial-border rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
            <div className="flex items-center space-x-2">
              <Clock size={16} className="text-industrial-accent" />
              <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                TEMPORIZADOR POMODORO
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-industrial-card border border-industrial-border text-industrial-muted">
              {currentMode === 'focus' ? 'SESSÃO DE 25 MIN' : 'PAUSA DE 5 MIN'}
            </span>
          </div>

          {/* Seletores de Modo */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            <button
              type="button"
              onClick={() => startPomodoro('focus')}
              className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all border ${
                currentMode === 'focus'
                  ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent shadow-sm'
                  : 'bg-industrial-card border-industrial-border text-industrial-muted hover:text-slate-200'
              }`}
            >
              FOCO (25m)
            </button>
            <button
              type="button"
              onClick={() => startPomodoro('break')}
              className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all border ${
                currentMode === 'break'
                  ? 'bg-blue-500/15 border-blue-500 text-blue-400 shadow-sm'
                  : 'bg-industrial-card border-industrial-border text-industrial-muted hover:text-slate-200'
              }`}
            >
              PAUSA (5m)
            </button>
          </div>

          {/* Display Central do Timer */}
          <div className="flex flex-col items-center justify-center my-4">
            <div className="text-6xl font-mono font-bold tracking-tight text-slate-100">
              {formatTimer(remainingSeconds)}
            </div>
            <div className="flex items-center space-x-2 mt-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  pomodoroState === 'focus'
                    ? 'bg-industrial-accent animate-pulse'
                    : pomodoroState === 'break'
                    ? 'bg-blue-400 animate-pulse'
                    : pomodoroState === 'paused'
                    ? 'bg-industrial-warning'
                    : 'bg-industrial-subtle'
                }`}
              />
              <span className="text-xs font-mono uppercase tracking-wider text-industrial-muted">
                {pomodoroState === 'idle'
                  ? 'Pronto para iniciar'
                  : pomodoroState === 'paused'
                  ? 'Pausado'
                  : pomodoroState === 'completed'
                  ? 'Sessão concluída e salva!'
                  : 'Em andamento'}
              </span>
            </div>

            {/* Barra de Progresso */}
            <div className="w-full bg-industrial-card border border-industrial-border h-2 rounded-full overflow-hidden mt-6">
              <div
                className={`h-full transition-all duration-500 ${
                  currentMode === 'focus' ? 'bg-industrial-accent' : 'bg-blue-400'
                }`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Ações do Pomodoro */}
          <div className="flex items-center justify-center space-x-3 mt-6 pt-4 border-t border-industrial-border/60">
            {pomodoroState === 'idle' || pomodoroState === 'completed' ? (
              <button
                type="button"
                onClick={() => startPomodoro(currentMode)}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs tracking-wider transition-all"
              >
                <Play size={14} fill="currentColor" />
                <span>INICIAR</span>
              </button>
            ) : pomodoroState === 'paused' ? (
              <button
                type="button"
                onClick={resumePomodoro}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs tracking-wider transition-all"
              >
                <Play size={14} fill="currentColor" />
                <span>CONTINUAR</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={pausePomodoro}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-industrial-warning text-industrial-bg font-semibold text-xs tracking-wider transition-all hover:opacity-95"
              >
                <Pause size={14} fill="currentColor" />
                <span>PAUSAR</span>
              </button>
            )}

            <button
              type="button"
              onClick={resetPomodoro}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg bg-industrial-card border border-industrial-border hover:bg-industrial-hover text-industrial-muted hover:text-slate-100 text-xs font-mono transition-all"
            >
              <RotateCcw size={14} />
              <span>RESET</span>
            </button>
          </div>
        </div>

        {/* ── RASTREADOR DE HÁBITOS COM STREAKS ── */}
        <div className="bg-industrial-surface border border-industrial-border rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
            <div className="flex items-center space-x-2">
              <Flame size={16} className="text-industrial-warning" />
              <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                HÁBITOS & STREAKS
              </h3>
            </div>
            <span className="text-[11px] font-mono text-industrial-subtle">
              {habits.length} cadastrados
            </span>
          </div>

          {/* Lista de Hábitos */}
          <div className="space-y-2 mb-4 max-h-56 overflow-y-auto pr-1">
            {habits.length === 0 ? (
              <div className="text-center py-6 text-xs font-mono text-industrial-subtle">
                Nenhum hábito cadastrado ainda.
              </div>
            ) : (
              habits.map((habit) => {
                const todayStr = new Date().toISOString().split('T')[0];
                const completedToday = habit.last_completed === todayStr;

                return (
                  <div
                    key={habit.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-industrial-card border border-industrial-border hover:border-industrial-subtle/50 transition-all"
                  >
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        onClick={() => completeHabit(habit.id)}
                        className={`transition-colors ${
                          completedToday
                            ? 'text-industrial-accent'
                            : 'text-industrial-subtle hover:text-industrial-muted'
                        }`}
                        title={completedToday ? 'Concluído hoje' : 'Marcar como feito hoje'}
                      >
                        {completedToday ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      <span
                        className={`text-xs font-medium ${
                          completedToday ? 'line-through text-industrial-muted' : 'text-slate-200'
                        }`}
                      >
                        {habit.name}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-industrial-surface border border-industrial-border text-industrial-warning font-mono text-xs">
                      <Flame size={12} fill="currentColor" />
                      <span className="font-bold">{habit.streak_count}</span>
                      <span className="text-[10px] text-industrial-subtle">dias</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Adicionar Hábito */}
          <form onSubmit={handleCreateHabit} className="flex space-x-2 pt-2 border-t border-industrial-border/60">
            <input
              type="text"
              placeholder="Novo hábito (ex: Leitura técnica)..."
              value={newHabitName}
              onChange={(e) => setNewHabitName(e.target.value)}
              className="flex-1 bg-industrial-card border border-industrial-border rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-industrial-subtle focus:outline-none focus:border-industrial-accent"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-industrial-hover hover:bg-industrial-card border border-industrial-border text-industrial-accent hover:text-industrial-accentHover text-xs font-mono font-semibold flex items-center space-x-1 transition-all"
            >
              <Plus size={13} />
              <span>CRIAR</span>
            </button>
          </form>
        </div>
      </div>

      {/* ── COLUNA DIREITA: TAREFAS PRIORITÁRIAS DO DIA (7 colunas) ── */}
      <div className="lg:col-span-7 bg-industrial-surface border border-industrial-border rounded-xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
            <div className="flex items-center space-x-2">
              <Sparkles size={16} className="text-industrial-accent" />
              <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                TAREFAS PRIORITÁRIAS DO DIA
              </h3>
            </div>
            <div className="flex items-center space-x-2 text-[11px] font-mono text-industrial-subtle">
              <Calendar size={13} />
              <span>{new Date().toLocaleDateString('pt-BR')}</span>
            </div>
          </div>

          {/* Formulário de Adicionar Tarefa */}
          <form onSubmit={handleCreateTask} className="flex flex-col sm:flex-row gap-2 mb-5">
            <input
              type="text"
              placeholder="Descreva a tarefa prioritária..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              className="flex-1 bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-industrial-subtle focus:outline-none focus:border-industrial-accent"
            />

            <div className="flex space-x-2">
              <select
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                className="bg-industrial-card border border-industrial-border rounded-lg px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-industrial-accent"
              >
                <option value="high">Alta (High)</option>
                <option value="med">Média (Med)</option>
                <option value="low">Baixa (Low)</option>
              </select>

              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs font-mono flex items-center space-x-1.5 transition-all"
              >
                <Plus size={14} />
                <span>ADICIONAR</span>
              </button>
            </div>
          </form>

          {/* Lista de Tarefas */}
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {tasks.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-industrial-border rounded-xl">
                <p className="text-xs font-mono text-industrial-subtle mb-1">
                  Nenhuma tarefa pendente para hoje.
                </p>
                <p className="text-[11px] text-industrial-subtle/80">
                  Adicione uma tarefa no formulário acima.
                </p>
              </div>
            ) : (
              tasks.map((task) => {
                const isCompleted = task.completed === 1;

                return (
                  <div
                    key={task.id}
                    className={`flex items-center justify-between p-3.5 rounded-lg border transition-all ${
                      isCompleted
                        ? 'bg-industrial-card/40 border-industrial-border/50 opacity-60'
                        : 'bg-industrial-card border-industrial-border hover:border-industrial-subtle/60'
                    }`}
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleTask(task.id, task.completed)}
                        className={`transition-colors shrink-0 ${
                          isCompleted
                            ? 'text-industrial-accent'
                            : 'text-industrial-subtle hover:text-industrial-muted'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>

                      <span
                        className={`text-xs truncate ${
                          isCompleted
                            ? 'line-through text-industrial-subtle'
                            : 'text-slate-100 font-medium'
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {/* Badge de Prioridade */}
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
                          task.priority === 'high'
                            ? 'bg-industrial-danger/15 border-industrial-danger/40 text-industrial-danger'
                            : task.priority === 'med'
                            ? 'bg-industrial-warning/15 border-industrial-warning/40 text-industrial-warning'
                            : 'bg-slate-500/15 border-slate-500/40 text-slate-400'
                        }`}
                      >
                        {task.priority}
                      </span>

                      {/* Excluir Tarefa */}
                      <button
                        type="button"
                        onClick={() => removeTask(task.id)}
                        className="p-1 rounded hover:bg-industrial-hover text-industrial-subtle hover:text-industrial-danger transition-colors"
                        title="Excluir tarefa"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Resumo do Rodapé */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-industrial-border/60 text-[11px] font-mono text-industrial-subtle">
          <span>
            {tasks.filter((t) => t.completed === 1).length} de {tasks.length} concluídas
          </span>
          <span className="text-industrial-accent">
            {tasks.length > 0
              ? `${Math.round((tasks.filter((t) => t.completed === 1).length / tasks.length) * 100)}% de conclusão`
              : '0% de conclusão'}
          </span>
        </div>
      </div>
    </div>
  );
};
