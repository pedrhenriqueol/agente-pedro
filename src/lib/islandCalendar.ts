import { isLocalDate, localDate } from '../database/date';

/** Noon keeps navigation in the local calendar even across daylight-saving changes. */
export function calendarDate(value: string): Date {
  if (!isLocalDate(value)) throw new Error('Data de calendário inválida.');
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function calendarDays(month: string): string[] {
  const first = calendarDate(`${month}-01`);
  first.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first);
    day.setDate(first.getDate() + index);
    return localDate(day);
  });
}

export function moveCalendarDay(value: string, days: number): string {
  const date = calendarDate(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

/** Clamp the ordinal so Jan 31 → Feb 28/29 instead of silently skipping February. */
export function moveCalendarMonth(value: string, months: number): string {
  const date = calendarDate(value);
  const ordinal = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
  date.setDate(Math.min(ordinal, last));
  return localDate(date);
}
