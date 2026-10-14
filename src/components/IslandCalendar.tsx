import { useId, useRef, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDate, calendarDays, moveCalendarDay, moveCalendarMonth } from '../lib/islandCalendar';

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

export function IslandCalendar({ month, selected, today, counts, onSelect, onMonth }: IslandCalendarProps) {
  const titleId = useId();
  const days = calendarDays(month);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // One tab stop remains available when browsing a month that does not contain the selection.
  const tabStop = days.includes(selected) ? selected : `${month}-01`;

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
    requestAnimationFrame(() => {
      const target = buttons.current.get(next);
      if (!document.hasFocus() || !target?.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      if (document.activeElement !== document.body && document.activeElement !== origin) return;
      target.focus({ preventScroll: true });
    });
  }

  return <div className="island-calendar">
    <div className="island-calendar-heading">
      <strong id={titleId}>{monthLabel.format(calendarDate(`${month}-01`))}</strong>
      <div>
        <button type="button" aria-label="Mês anterior" title="Mês anterior" onClick={() => onMonth(moveCalendarMonth(`${month}-01`, -1).slice(0, 7))}><ChevronLeft size={13} aria-hidden="true" /></button>
        <button type="button" aria-label="Próximo mês" title="Próximo mês" onClick={() => onMonth(moveCalendarMonth(`${month}-01`, 1).slice(0, 7))}><ChevronRight size={13} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="island-calendar-grid" role="grid" aria-labelledby={titleId}>
      <div className="island-calendar-week" role="row">{weekdayLabels.map((label, index) => <span key={label} role="columnheader" aria-label={label}>{shortWeekdays[index]}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div key={week} className="island-calendar-week" role="row">
        {days.slice(week * 7, week * 7 + 7).map(value => {
          const count = counts.get(value) ?? 0;
          const label = `${dayLabel.format(calendarDate(value))}${count ? `, ${count} ${count === 1 ? 'tarefa pendente' : 'tarefas pendentes'}` : ''}`;
          return <div key={value} role="gridcell" aria-selected={selected === value}>
            <button ref={node => { if (node) buttons.current.set(value, node); else buttons.current.delete(value); }} type="button"
              tabIndex={tabStop === value ? 0 : -1} aria-label={label} aria-current={today === value ? 'date' : undefined}
              data-outside={value.slice(0, 7) !== month || undefined} data-selected={selected === value || undefined}
              data-today={today === value || undefined} data-tasks={count > 0 || undefined}
              onClick={() => onSelect(value)} onKeyDown={event => move(event, value)}>
              <span>{Number(value.slice(-2))}</span>{count > 0 && <i aria-hidden="true" />}
            </button>
          </div>;
        })}
      </div>)}
    </div>
    <button type="button" className="island-calendar-today" onClick={() => onSelect(today)}>Voltar para hoje</button>
  </div>;
}
