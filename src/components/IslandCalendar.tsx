import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDate, calendarDays, moveCalendarDay, moveCalendarMonth } from '../lib/islandCalendar';
import { WAAPI_ENTER, WAAPI_EXIT } from '../lib/motionProfiles';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { usePageActive, useReducedMotion } from './ui/PageTransition';
import '../styles/island-calendar-motion.css';

const weekdayLabels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const shortWeekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const dayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

interface IslandCalendarProps {
  month: string;
  selected: string;
  today: string;
  counts: ReadonlyMap<string, number>;
  onSelect: (day: string) => void;
  onMonth: (month: string) => void;
}

interface CalendarFrame {
  month: string;
  selected: string;
  today: string;
  counts: ReadonlyMap<string, number>;
}

interface CalendarTransition {
  month: string;
  outgoing: CalendarFrame | null;
  direction: 1 | -1;
  revision: number;
}

export function IslandCalendar({ month, selected, today, counts, onSelect, onMonth }: IslandCalendarProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion(usePreferencesStore(state => state.reduceMotion));
  const pageActive = usePageActive();
  const committed = useRef<CalendarFrame>({ month, selected, today, counts });
  const [transition, setTransition] = useState<CalendarTransition>(() => ({ month, outgoing: null, direction: 1, revision: 0 }));
  const layers = useRef(new Map<string, HTMLDivElement>());
  const visible = useRef(new Set([month]));
  const animations = useRef<Animation[]>([]);
  const sequence = useRef(0);
  const pendingFocus = useRef<number | null>(null);
  const days = calendarDays(month);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // One tab stop remains available when browsing a month that does not contain the selection.
  const tabStop = days.includes(selected) ? selected : `${month}-01`;

  if (transition.month !== month) {
    let outgoing: CalendarFrame | null = null;
    let opacity = -1;
    // During A → B → C, B may still be almost transparent. Keep the drawn, dominant
    // month instead of discarding A for an invisible B. A reversal reuses the target layer.
    for (const frame of [committed.current, ...(transition.outgoing ? [transition.outgoing] : [])]) {
      const node = layers.current.get(frame.month);
      if (frame.month === month || !node?.isConnected) continue;
      const drawnOpacity = Number.parseFloat(getComputedStyle(node).opacity);
      if (drawnOpacity > opacity) { outgoing = frame; opacity = drawnOpacity; }
    }
    setTransition({ month, outgoing: reduceMotion ? null : outgoing,
      direction: month > transition.month ? 1 : -1, revision: transition.revision + 1 });
  }

  useLayoutEffect(() => { committed.current = { month, selected, today, counts }; }, [month, selected, today, counts]);

  useLayoutEffect(() => {
    const epoch = ++sequence.current;
    const frames = [month, ...(transition.outgoing ? [transition.outgoing.month] : [])];
    // Preserve drawn positions on a quick reversal, including the month currently leaving.
    const samples = new Map<string, { opacity: string; transform: string }>();
    for (const id of frames) {
      const node = layers.current.get(id);
      if (!node) continue;
      const style = visible.current.has(id) ? getComputedStyle(node) : null;
      samples.set(id, style ? { opacity: style.opacity, transform: style.transform }
        : { opacity: '0', transform: `translateX(${transition.direction * 12}px)` });
    }
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    visible.current = new Set(frames);
    const available = pageActive && document.visibilityState !== 'hidden'
      && !root.current?.closest('[hidden], [inert], [aria-hidden="true"]');
    for (const id of frames) {
      const node = layers.current.get(id);
      const sample = samples.get(id);
      if (!node || !sample) continue;
      const active = id === month;
      node.style.opacity = active ? '1' : '0';
      node.style.transform = active ? 'none' : `translateX(${transition.direction * -8}px)`;
      if (transition.outgoing && !reduceMotion && available) {
        animations.current.push(node.animate([sample, { opacity: node.style.opacity, transform: node.style.transform }],
          active ? WAAPI_ENTER : WAAPI_EXIT));
      }
    }
    const finish = () => {
      if (epoch !== sequence.current) return;
      visible.current = new Set([month]);
      setTransition(current => current.revision === transition.revision && current.outgoing ? { ...current, outgoing: null } : current);
    };
    if (animations.current.length) void Promise.allSettled(animations.current.map(animation => animation.finished)).then(finish);
    else finish();
  }, [month, transition.revision, pageActive, reduceMotion]);

  useEffect(() => {
    // The island also conceals its body outside PageVisibilityContext. Stop rather than replay
    // a partially completed passage when it is collapsed, switched, or hidden by Windows.
    const settleIfHidden = () => {
      if (document.visibilityState !== 'hidden' && !root.current?.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      sequence.current++;
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      const active = layers.current.get(committed.current.month);
      if (active) { active.style.opacity = '1'; active.style.transform = 'none'; }
      visible.current = new Set([committed.current.month]);
      setTransition(current => current.outgoing ? { ...current, outgoing: null } : current);
      if (pendingFocus.current !== null) { cancelAnimationFrame(pendingFocus.current); pendingFocus.current = null; }
    };
    const observer = new MutationObserver(settleIfHidden);
    for (let ancestor: HTMLElement | null = root.current; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden'] });
    }
    document.addEventListener('visibilitychange', settleIfHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', settleIfHidden);
      sequence.current++;
      animations.current.forEach(animation => animation.cancel());
      if (pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current);
    };
  }, []);

  function move(event: KeyboardEvent<HTMLButtonElement>, value: string) {
    let next: string;
    if (event.key === 'ArrowRight') next = moveCalendarDay(value, 1);
    else if (event.key === 'ArrowLeft') next = moveCalendarDay(value, -1);
    else if (event.key === 'ArrowDown') next = moveCalendarDay(value, 7);
    else if (event.key === 'ArrowUp') next = moveCalendarDay(value, -7);
    else if (event.key === 'Home') next = moveCalendarDay(value, -calendarDate(value).getDay());
    else if (event.key === 'End') next = moveCalendarDay(value, 6 - calendarDate(value).getDay());
    else if (event.key === 'PageDown') next = moveCalendarMonth(value, 1);
    else if (event.key === 'PageUp') next = moveCalendarMonth(value, -1);
    else return;
    event.preventDefault();
    const origin = event.currentTarget;
    onSelect(next);
    if (pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current);
    pendingFocus.current = requestAnimationFrame(() => {
      pendingFocus.current = null;
      const target = buttons.current.get(next);
      if (!document.hasFocus() || !target?.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      if (document.activeElement !== document.body && document.activeElement !== origin) return;
      target.focus({ preventScroll: true });
    });
  }

  function renderWeeks(frame: CalendarFrame, active: boolean) {
    const frameDays = frame.month === month ? days : calendarDays(frame.month);
    return Array.from({ length: 6 }, (_, week) => <div key={week} className="island-calendar-week" role="row">
      {frameDays.slice(week * 7, week * 7 + 7).map(value => {
        const count = frame.counts.get(value) ?? 0;
        const label = `${dayLabel.format(calendarDate(value))}${count ? `, ${count} ${count === 1 ? 'tarefa pendente' : 'tarefas pendentes'}` : ''}`;
        return <div key={value} role="gridcell" aria-selected={frame.selected === value}>
          <button ref={active ? node => { if (node) buttons.current.set(value, node); else buttons.current.delete(value); } : undefined} type="button"
            tabIndex={active && tabStop === value ? 0 : -1} aria-label={label} aria-current={frame.today === value ? 'date' : undefined}
            data-outside={value.slice(0, 7) !== frame.month || undefined} data-selected={frame.selected === value || undefined}
            data-today={frame.today === value || undefined} data-tasks={count > 0 || undefined}
            onClick={active ? () => onSelect(value) : undefined} onKeyDown={active ? event => move(event, value) : undefined}>
            <span>{Number(value.slice(-2))}</span>{count > 0 && <i aria-hidden="true" />}
          </button>
        </div>;
      })}
    </div>);
  }

  const frames: CalendarFrame[] = [...(transition.outgoing ? [transition.outgoing] : []), { month, selected, today, counts }];

  return <div ref={root} className="island-calendar" data-month-direction={transition.direction === 1 ? 'forward' : 'backward'}
    data-month-transitioning={Boolean(transition.outgoing)}>
    <div className="island-calendar-heading">
      <strong id={titleId} aria-live="polite" aria-atomic="true">{monthLabel.format(calendarDate(`${month}-01`))}</strong>
      <div>
        <button type="button" aria-label="Mês anterior" title="Mês anterior" onClick={() => onMonth(moveCalendarMonth(`${month}-01`, -1).slice(0, 7))}><ChevronLeft size={13} aria-hidden="true" /></button>
        <button type="button" aria-label="Próximo mês" title="Próximo mês" onClick={() => onMonth(moveCalendarMonth(`${month}-01`, 1).slice(0, 7))}><ChevronRight size={13} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="island-calendar-grid" role="grid" aria-labelledby={titleId}>
      <div className="island-calendar-week" role="row">{weekdayLabels.map((label, index) => <span key={label} role="columnheader" aria-label={label}>{shortWeekdays[index]}</span>)}</div>
      <div className="island-calendar-months">
        {frames.map(frame => {
          const active = frame.month === month;
          return <div key={frame.month} ref={node => { if (node) layers.current.set(frame.month, node); else layers.current.delete(frame.month); }}
            className="island-calendar-month" role="rowgroup" data-calendar-month={frame.month} data-presence={active ? 'active' : 'leaving'}
            aria-hidden={!active || undefined} inert={!active || undefined}>
            {renderWeeks(frame, active)}
          </div>;
        })}
      </div>
    </div>
    <button type="button" className="island-calendar-today" onClick={() => onSelect(today)}>Voltar para hoje</button>
  </div>;
}
