import { useId } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFocusStore } from '../stores/useFocusStore';
import '../styles/island-today.css';

/** Selection shares the panel's session lock and its existing cross-window timer command. */
export function IslandTaskSelection() {
  const { tasks, selectedTaskId, selectTask, currentMode, pomodoroState, sessionSaveState } = useFocusStore(useShallow(state => ({
    tasks: state.tasks, selectedTaskId: state.selectedTaskId, selectTask: state.selectTask, currentMode: state.currentMode,
    pomodoroState: state.pomodoroState, sessionSaveState: state.sessionSaveState,
  })));
  const id = useId();
  const started = pomodoroState === 'focus' || pomodoroState === 'break' || pomodoroState === 'paused';
  const recordPending = sessionSaveState === 'saving' || sessionSaveState === 'error';
  const pending = tasks.filter(task => task.completed === 0);
  const selected = tasks.find(task => task.id === selectedTaskId);
  if (currentMode !== 'focus') return null;
  return <div className="island-task-selection">
    <label htmlFor={id}>Seu próximo passo</label>
    <select id={id} value={selectedTaskId ?? ''} disabled={started || recordPending}
      aria-describedby={started || recordPending ? `${id}-help` : undefined}
      onChange={event => selectTask(event.target.value || null)}>
      <option value="">Sessão livre</option>
      {pending.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
      {selected?.completed === 1 && <option value={selected.id}>{selected.title} · concluída</option>}
      {selectedTaskId && !selected && <option value={selectedTaskId}>Tarefa indisponível</option>}
    </select>
    {(started || recordPending) && <p id={`${id}-help`}>{recordPending ? 'Conclua o registro antes de trocar a tarefa.' : 'Reinicie a sessão para escolher outra tarefa.'}</p>}
  </div>;
}
