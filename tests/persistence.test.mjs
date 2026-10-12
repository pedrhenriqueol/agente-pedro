import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApplication, MemoryStorage } from './database-harness.mjs';

for (const backend of ['browser', 'sqlite']) {
  test(`${backend}: reabrir a aplicação preserva registros, saldo e identidade de foco`, async (t) => {
    const storage = new MemoryStorage();
    const directory = await mkdtemp(join(tmpdir(), 'pedro-reopen-'));
    const path = join(directory, 'isolated.db');
    let db = backend === 'sqlite' ? new DatabaseSync(path) : null;
    t.after(async () => { db?.close(); await rm(directory, { recursive: true, force: true }); });
    const first = await loadApplication(t, { storage, nativeDb: db });
    const task = await first.app.insertTask('Revisão', 'high', '2026-10-20');
    await first.app.updateTaskCompletion(task.id, true);
    const habit = await first.app.insertHabit('Leitura');
    await first.app.registerHabitCompletion(habit.id);
    const session = await first.app.persistPomodoroSession(25, 'persisted-session');
    const account = await first.app.insertAccount('Conta', 'checking', 100000);
    await first.app.insertTransaction({ account_id: account.id, description: 'Assinatura', amount_cents: 15000, type: 'expense', category: 'Serviços', transaction_date: '2026-10-10' });
    await first.app.insertOrUpdateBudget('Serviços', 50000, '2026-10');
    const tasksBeforeClose = await first.app.fetchTasks();
    db?.close();
    db = backend === 'sqlite' ? new DatabaseSync(path) : null;
    const second = await loadApplication(t, { storage, nativeDb: db });
    assert.deepEqual(await second.app.fetchTasks(), tasksBeforeClose);
    assert.equal((await second.app.fetchHabits())[0].streak_count, 1);
    assert.deepEqual((await second.app.fetchPomodoroSessions())[0], session);
    assert.equal((await second.app.fetchAccounts())[0].balance_cents, 85000);
    assert.equal((await second.app.fetchTransactions())[0].amount_cents, 15000);
    assert.equal((await second.app.fetchBudgets('2026-10'))[0].limit_cents, 50000);
    await second.app.persistPomodoroSession(25, session.id);
    assert.equal((await second.app.fetchPomodoroSessions()).length, 1);
  });
}

for (const backend of ['browser', 'sqlite']) {
  test(`${backend}: sequência de hábito usa o calendário local e reinicia após intervalo`, async (t) => {
    const timezone = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    const RealDate = Date;
    let instant = '2026-10-13T01:30:00.000Z';
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return new RealDate(instant).getTime(); }
    };
    t.after(() => { globalThis.Date = RealDate; if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; });
    const directory = await mkdtemp(join(tmpdir(), 'pedro-local-date-'));
    const db = backend === 'sqlite' ? new DatabaseSync(join(directory, 'local-date.db')) : null;
    t.after(async () => { db?.close(); await rm(directory, { recursive: true, force: true }); });
    const { app } = await loadApplication(t, { nativeDb: db });
    assert.equal(app.localDate(), '2026-10-12');
    assert.equal(app.localMonth(new RealDate('2026-11-01T01:30:00Z')), '2026-10');
    const habit = await app.insertHabit('Rotina');
    const adapter = await app.getDatabase();
    await adapter.execute('UPDATE habits SET streak_count = ?, last_completed = ?, updated_at = ? WHERE id = ?', [7, '2026-10-11', instant, habit.id]);
    const completion = await app.registerHabitCompletion(habit.id);
    assert.deepEqual(completion, { streak_count: 8, last_completed: '2026-10-12' });
    assert.equal((await app.registerHabitCompletion(habit.id)).streak_count, 8);
    instant = '2026-10-16T01:30:00.000Z';
    assert.deepEqual(await app.registerHabitCompletion(habit.id), { streak_count: 1, last_completed: '2026-10-15' });
  });
}
