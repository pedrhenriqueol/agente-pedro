import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUpRight, CalendarDays, Check, Circle, Flame, ListTodo, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { localDate, previousLocalDate } from '../database/date';
import type { TaskPriority } from '../database/types';
import { useFocusStore } from '../stores/useFocusStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { RetainedTransition } from './ui/PageTransition';
import { SelectionIndicator } from './ui/SelectionIndicator';
import { ActionConfirmation } from './ui/ActionConfirmation';
import { IslandCalendar } from './IslandCalendar';
import { calendarDate } from '../lib/islandCalendar';
import '../styles/island-today.css';

const tabs = [{ id: 'agenda', label: 'Agenda', Icon: CalendarDays }, { id: 'tasks', label: 'Tarefas', Icon: ListTodo }, { id: 'habits', label: 'Hábitos', Icon: Flame }] as const;
type TodayTab = typeof tabs[number]['id'];
const priorityOrder: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 };
const VISIBLE_ITEMS = 4;
const dateLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeLabel = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** A small, operational view of the same local routine shown in the panel. */
export function IslandToday({ onOpenPanel }: { onOpenPanel: () => void }) {
  const { tasks, habits, isLoading, hasLoadedData, error, addTask, toggleTask, completeHabit, clearError, refreshData } = useFocusStore(useShallow(state => ({
    tasks: state.tasks, habits: state.habits, isLoading: state.isLoading, hasLoadedData: state.hasLoadedData,
    error: state.error, addTask: state.addTask, toggleTask: state.toggleTask, completeHabit: state.completeHabit,
    clearError: state.clearError, refreshData: state.refreshData,
  })));
  const reduceMotion = usePreferencesStore(state => state.reduceMotion);
  const [tab, setTab] = useState<TodayTab>('agenda');
  const [today, setToday] = useState(localDate);
  const [clock, setClock] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(localDate);
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [draft, setDraft] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');
  const [agendaFormVisible, setAgendaFormVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeEvent, setNoticeEvent] = useState(0);
  const confirmationCount = useRef(0);
  const [busyItems, setBusyItems] = useState<Set<string>>(() => new Set());
  const busy = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  const taskInput = useRef<HTMLInputElement>(null);
  const agendaInput = useRef<HTMLInputElement>(null);
  const taskButtons = useRef(new Map<string, HTMLButtonElement>());
  const agendaButtons = useRef(new Map<string, HTMLButtonElement>());
  const habitButtons = useRef(new Map<string, HTMLButtonElement>());
  const tabStrip = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const pending = tasks.filter(task => task.completed === 0 && (!task.due_date || task.due_date <= today)).sort((a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') || priorityOrder[a.priority] - priorityOrder[b.priority]
      || b.created_at.localeCompare(a.created_at));
  const yesterday = previousLocalDate(new Date(`${today}T12:00:00`));
  const completedHabits = habits.filter(habit => habit.last_completed === today).length;
  const orderedHabits = [...habits].sort((a, b) => Number(a.last_completed === today) - Number(b.last_completed === today));
  const creating = busyItems.has('create-task');
  const creatingAgenda = busyItems.has('create-agenda-task');
  const agendaTasks = tasks.filter(task => task.completed === 0 && task.due_date === selectedDate)
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.created_at.localeCompare(a.created_at));
  const datedTasks = new Map<string, number>();
  for (const task of tasks) if (task.completed === 0 && task.due_date) datedTasks.set(task.due_date, (datedTasks.get(task.due_date) ?? 0) + 1);
  const hasCompletedDate = tasks.some(task => task.completed !== 0 && task.due_date === selectedDate);

  useEffect(() => {
    let previousToday = localDate();
    const update = () => {
      const now = new Date();
      const nextToday = localDate(now);
      setClock(now);
      setToday(nextToday);
      if (nextToday !== previousToday) {
        setSelectedDate(current => current === previousToday ? nextToday : current);
        setMonth(current => current === previousToday.slice(0, 7) ? nextToday.slice(0, 7) : current);
        previousToday = nextToday;
      }
    };
    const interval = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);

  async function run(key: string, action: () => Promise<void>, success: () => void, returnFocus?: () => HTMLElement | null) {
    // This ref guards two activations before React has committed the disabled state.
    if (busy.current.has(key)) return;
    busy.current.add(key);
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ownedFocus = origin !== null && root.current?.contains(origin);
    let succeeded = false;
    setBusyItems(new Set(busy.current));
    setNotice('');
    clearError();
    try {
      await action(); success(); succeeded = true;
      setNoticeEvent(key === 'refresh' ? 0 : ++confirmationCount.current);
    }
    catch { /* The store retains the precise persistence error and the input draft. */ }
    finally {
      busy.current.delete(key); setBusyItems(new Set(busy.current));
      if (returnFocus && ownedFocus) requestAnimationFrame(() => {
        // DOM focus only, and only while the interaction still belongs to this
        // visible island. A navigation or switch to another app wins immediately.
        if (!document.hasFocus() || !root.current?.isConnected || root.current.closest('[hidden], [inert], [aria-hidden="true"]')) return;
        if (document.activeElement !== document.body && document.activeElement !== origin) return;
        const target = !succeeded && origin?.isConnected ? origin : returnFocus();
        target?.focus({ preventScroll: true });
      });
    }
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    void run('create-task', () => addTask(title, 'med', localDate()), () => { setDraft(''); setNotice('Tarefa adicionada para hoje.'); }, () => taskInput.current);
  }

  function createAgendaTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = agendaDraft.trim();
    const dueDate = selectedDate;
    if (!title) return;
    void run('create-agenda-task', () => addTask(title, 'med', dueDate), () => {
      setAgendaDraft(''); setNotice(`Tarefa adicionada para ${calendarDate(dueDate).toLocaleDateString('pt-BR')}.`);
    }, () => agendaInput.current);
  }

  function selectDate(value: string) {
    setSelectedDate(value); setMonth(value.slice(0, 7)); setNotice('');
  }

  function toggleAgendaForm(origin: HTMLButtonElement) {
    const show = !agendaFormVisible;
    setAgendaFormVisible(show);
    if (show) requestAnimationFrame(() => {
      const input = agendaInput.current;
      if (!document.hasFocus() || !input?.isConnected || input.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      if (document.activeElement === origin || document.activeElement === document.body) input.focus({ preventScroll: true });
    });
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    else return;
    event.preventDefault();
    setNotice('');
    setTab(tabs[target].id);
    tabRefs.current[target]?.focus({ preventScroll: true });
  }

  return <div ref={root} className="island-today" aria-label="Resumo de hoje">
    <div className="island-today-toolbar"><div ref={tabStrip} className="island-today-tabs" role="tablist" aria-label="Sua rotina hoje">
      {tabs.map(({ id: value, label, Icon }, index) => <button key={value} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab"
        id={`${id}-tab-${value}`} aria-controls={`${id}-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
        onClick={() => { setNotice(''); setTab(value); }} onKeyDown={event => moveTab(event, index)}>
        <Icon size={12} aria-hidden="true" /><span>{label}</span>{value !== 'agenda' && <small>{value === 'tasks' ? pending.length : `${completedHabits}/${habits.length}`}</small>}
      </button>)}
      <SelectionIndicator owner={tabStrip} selection={tab} selector="[aria-selected='true']" className="island-today-indicator" />
    </div><div className="island-today-actions">
      {tab === 'agenda' && <button type="button" aria-label="Nova tarefa na agenda" title="Adicionar tarefa na data selecionada" aria-expanded={agendaFormVisible}
        aria-controls={`${id}-agenda-create`} disabled={creatingAgenda} onClick={event => toggleAgendaForm(event.currentTarget)}><Plus size={14} aria-hidden="true" /></button>}
      <button type="button" aria-label="Ver rotina completa" title="Ver rotina completa" onClick={onOpenPanel}><ArrowUpRight size={14} aria-hidden="true" /></button>
    </div></div>
    {error && <div className="island-today-notice is-error" role="alert"><span>{error}</span>
      <button type="button" className="widget-icon-button" aria-label="Atualizar rotina" title="Tentar novamente" disabled={isLoading || busyItems.has('refresh')}
        onClick={() => { void run('refresh', refreshData, () => setNotice('Rotina atualizada.'), () => tabRefs.current[tabs.findIndex(item => item.id === tab)]); }}><RefreshCw size={13} aria-hidden="true" /></button>
    </div>}
    <RetainedTransition value={tab} reduceMotion={reduceMotion} values={tabs.map(item => item.id)}
      containerClassName="island-today-presence" sectionClassName="island-today-tabpanel" slotAttribute="data-section"
      tabId={value => `${id}-tab-${value}`} panelId={value => `${id}-panel-${value}`}>
      {category => category === 'agenda' ? <>
        <div className="island-agenda-layout">
          <div className="island-agenda-summary">
            <time className="island-agenda-clock" dateTime={clock.toISOString()}>{timeLabel.format(clock)}</time>
            <p className="island-agenda-date">{dateLabel.format(calendarDate(selectedDate))}</p>
            {isLoading && !hasLoadedData ? <p className="island-today-empty" role="status">Carregando suas tarefas…</p>
              : !hasLoadedData && error ? <p className="island-today-empty">Suas tarefas não puderam ser carregadas.</p>
              : agendaTasks.length ? <ul className="island-today-list island-agenda-tasks" aria-label="Tarefas na data selecionada">{agendaTasks.slice(0, 3).map(task => <li key={task.id}>
                <button ref={node => { if (node) agendaButtons.current.set(task.id, node); else agendaButtons.current.delete(task.id); }} className="island-today-check" type="button"
                  aria-disabled={busyItems.has(task.id)} aria-label={`Concluir tarefa: ${task.title}`}
                  onClick={() => { const next = agendaTasks.slice(0, 3).find(item => item.id !== task.id);
                    void run(task.id, () => toggleTask(task.id, 0), () => setNotice('Tarefa concluída.'), () => next ? agendaButtons.current.get(next.id) || tabRefs.current[0] : agendaFormVisible ? agendaInput.current : tabRefs.current[0]); }}>
                  {busyItems.has(task.id) ? <LoaderCircle size={14} className="island-today-spinner" aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
                </button>
                <span className="island-today-item-copy"><strong title={task.title}>{task.title}</strong>{task.priority === 'high' && <small>Prioridade alta</small>}</span>
              </li>)}</ul>
              : <p className="island-agenda-empty">{hasCompletedDate ? 'Tarefas deste dia concluídas.' : selectedDate === today ? 'Nada marcado para hoje.' : 'Nenhuma tarefa com prazo neste dia.'}</p>}
            {agendaTasks.length > 3 && <p className="island-today-more">+{agendaTasks.length - 3} {agendaTasks.length - 3 === 1 ? 'tarefa no painel' : 'tarefas no painel'}</p>}
          </div>
          <IslandCalendar month={month} selected={selectedDate} today={today} counts={datedTasks} onSelect={selectDate} onMonth={setMonth} />
        </div>
        <form id={`${id}-agenda-create`} className="island-today-create island-agenda-create" hidden={!agendaFormVisible} inert={!agendaFormVisible || undefined}
          onSubmit={createAgendaTask} aria-label="Adicionar tarefa na data selecionada" aria-busy={creatingAgenda}>
          <label className="island-sr-status" htmlFor={`${id}-agenda-task`}>Nova tarefa para {calendarDate(selectedDate).toLocaleDateString('pt-BR')}</label>
          <input ref={agendaInput} id={`${id}-agenda-task`} type="text" autoComplete="off" maxLength={240} placeholder={selectedDate === today ? 'Nova tarefa para hoje…' : `Nova tarefa para ${calendarDate(selectedDate).toLocaleDateString('pt-BR')}…`}
            value={agendaDraft} readOnly={creatingAgenda} onChange={event => setAgendaDraft(event.target.value)} />
          <button type="submit" disabled={creatingAgenda || !agendaDraft.trim()} aria-label="Adicionar tarefa na data selecionada" title="Adicionar tarefa">
            {creatingAgenda ? <LoaderCircle size={15} className="island-today-spinner" aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
          </button>
        </form>
      </> : category === 'tasks' ? <>
        {isLoading && !hasLoadedData ? <p className="island-today-empty" role="status">Carregando sua rotina…</p>
          : !hasLoadedData && error ? <p className="island-today-empty">Suas tarefas não puderam ser carregadas.</p>
          : pending.length ? <ul className="island-today-list" aria-label="Tarefas para agora">{pending.slice(0, VISIBLE_ITEMS).map(task => <li key={task.id}>
            <button ref={node => { if (node) taskButtons.current.set(task.id, node); else taskButtons.current.delete(task.id); }} className="island-today-check" type="button" aria-disabled={busyItems.has(task.id)} aria-label={`Concluir tarefa: ${task.title}`}
              onClick={() => { const next = pending.slice(0, VISIBLE_ITEMS).find(item => item.id !== task.id);
                void run(task.id, () => toggleTask(task.id, 0), () => setNotice('Tarefa concluída.'), () => next ? taskButtons.current.get(next.id) || taskInput.current : taskInput.current); }}>
              {busyItems.has(task.id) ? <LoaderCircle size={16} className="island-today-spinner" aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
            </button>
            <span className="island-today-item-copy"><strong title={task.title}>{task.title}</strong><small>{task.due_date && task.due_date < today ? 'Prazo anterior' : task.due_date === today ? 'Para hoje' : 'Sem prazo'}{task.priority === 'high' ? ' · prioridade alta' : ''}</small></span>
          </li>)}</ul>
          : <p className="island-today-empty">Um dia com espaço. Adicione uma prioridade para começar.</p>}
        {pending.length > VISIBLE_ITEMS && <p className="island-today-more">Mais {pending.length - VISIBLE_ITEMS} {pending.length - VISIBLE_ITEMS === 1 ? 'tarefa no painel' : 'tarefas no painel'}.</p>}
        <form className="island-today-create" onSubmit={createTask} aria-label="Adicionar tarefa para hoje" aria-busy={creating}>
          <label className="island-sr-status" htmlFor={`${id}-task`}>Nova tarefa para hoje</label>
          <input ref={taskInput} id={`${id}-task`} type="text" autoComplete="off" maxLength={240} placeholder="Uma tarefa para hoje…" value={draft} readOnly={creating}
            onChange={event => setDraft(event.target.value)} />
          <button type="submit" disabled={creating || !draft.trim()} aria-label="Adicionar tarefa para hoje" title="Adicionar tarefa">
            {creating ? <LoaderCircle size={15} className="island-today-spinner" aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
          </button>
        </form>
        {pending.length > 0 && <p className="island-today-help">Inclui tarefas sem prazo e pendências.</p>}
      </> : <>
        {isLoading && !hasLoadedData ? <p className="island-today-empty" role="status">Carregando seus hábitos…</p>
          : !hasLoadedData && error ? <p className="island-today-empty">Seus hábitos não puderam ser carregados.</p>
          : habits.length ? <ul className="island-today-list" aria-label="Hábitos de hoje">{orderedHabits.slice(0, VISIBLE_ITEMS).map(habit => {
            const done = habit.last_completed === today;
            const streak = done || habit.last_completed === yesterday ? habit.streak_count : 0;
            return <li key={habit.id} className={done ? 'is-complete' : undefined}>
              <button ref={node => { if (node) habitButtons.current.set(habit.id, node); else habitButtons.current.delete(habit.id); }} className="island-today-check" type="button" disabled={done} aria-disabled={busyItems.has(habit.id) || done}
                aria-label={done ? `Hábito registrado hoje: ${habit.name}` : `Registrar hábito hoje: ${habit.name}`}
                onClick={() => { if (useFocusStore.getState().habits.find(item => item.id === habit.id)?.last_completed === localDate()) return;
                  const next = orderedHabits.slice(0, VISIBLE_ITEMS).find(item => item.id !== habit.id && item.last_completed !== today);
                  void run(habit.id, () => completeHabit(habit.id), () => setNotice('Hábito registrado para hoje.'), () => next ? habitButtons.current.get(next.id) || tabRefs.current[2] : tabRefs.current[2]); }}>
                {busyItems.has(habit.id) ? <LoaderCircle size={16} className="island-today-spinner" aria-hidden="true" /> : done ? <Check size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
              </button>
              <span className="island-today-item-copy"><strong title={habit.name}>{habit.name}</strong><small>{done ? 'Registrado hoje' : streak ? `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'}` : 'Pronto para retomar'}</small></span>
            </li>;
          })}</ul> : <p className="island-today-empty">Crie um hábito na rotina e registre por aqui quando fizer.</p>}
        {habits.length > VISIBLE_ITEMS && <p className="island-today-more">Mais {habits.length - VISIBLE_ITEMS} {habits.length - VISIBLE_ITEMS === 1 ? 'hábito no painel' : 'hábitos no painel'}.</p>}
      </>}
    </RetainedTransition>
    {notice && <p className="island-today-notice" role="status"><ActionConfirmation eventId={noticeEvent} />{notice}</p>}
  </div>;
}
