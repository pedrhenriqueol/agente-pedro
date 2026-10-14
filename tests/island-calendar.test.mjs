import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/islandCalendar.ts'], bundle: true, write: false, format: 'cjs', platform: 'node' });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, Date, Error });
const { calendarDays, moveCalendarDay, moveCalendarMonth, calendarDate } = module.exports;

test('Calendário mantém semanas completas de domingo a sábado entre meses e anos', () => {
  const october = Array.from(calendarDays('2026-10'));
  assert.equal(october.length, 42);
  assert.equal(october[0], '2026-09-27');
  assert.equal(october[41], '2026-11-07');
  assert.equal(new Set(october).size, 42);
  assert.equal(calendarDate(october[0]).getDay(), 0);
  assert.equal(calendarDate(october[41]).getDay(), 6);
  const january = Array.from(calendarDays('2027-01'));
  assert.equal(january[0], '2026-12-27');
  assert.equal(january[41], '2027-02-06');
});

test('Navegação mensal preserva o dia e limita o ordinal em fevereiro e anos bissextos', () => {
  assert.equal(moveCalendarMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(moveCalendarMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(moveCalendarMonth('2026-03-31', -1), '2026-02-28');
  assert.equal(moveCalendarMonth('2026-12-13', 1), '2027-01-13');
  assert.equal(moveCalendarMonth('2027-01-13', -1), '2026-12-13');
  assert.equal(moveCalendarDay('2028-02-28', 1), '2028-02-29');
  assert.equal(moveCalendarDay('2028-02-29', 1), '2028-03-01');
  assert.throws(() => calendarDate('2026-02-31'), /inválida/);
});

test('Navegação de dias usa calendário local perto da mudança de horário de verão', () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(moveCalendarDay('2026-03-07', 1), '2026-03-08');
    assert.equal(moveCalendarDay('2026-03-08', 1), '2026-03-09');
    assert.equal(moveCalendarDay('2026-11-01', -1), '2026-10-31');
    assert.equal(calendarDate('2026-03-08').getHours(), 12);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
