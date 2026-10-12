import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeApplication, loadApplication, MemoryStorage, sqliteAdapter } from './database-harness.mjs';

const storageKey = 'agente_pedro_local_db';

for (const backend of ['browser', 'sqlite']) {
  test(`${backend}: adapters reais persistem tarefas, hábitos, foco e orçamento`, async (t) => {
    const { app } = backend === 'sqlite' ? await createNativeApplication(t) : await loadApplication(t);
    assert.deepEqual(await app.fetchTasks(), []);
    assert.deepEqual(await app.fetchAccounts(), []);
    const task = await app.insertTask('Revisar interface', 'high', '2026-10-20');
    let tasks = await app.fetchTasks();
    assert.equal(tasks[0].completed, 0);
    assert.equal(tasks[0].due_date, '2026-10-20');
    assert.match(tasks[0].created_at, /^\d{4}-\d{2}-\d{2}T/);
    await app.updateTaskCompletion(task.id, true);
    assert.equal((await app.fetchTasks())[0].completed, 1);
    await app.updateTaskCompletion('missing', true);
    await app.deleteTask(task.id);
    assert.deepEqual(await app.fetchTasks(), []);

    const first = await app.insertHabit('Ler');
    const second = await app.insertHabit('Caminhar');
    await app.registerHabitCompletion(second.id);
    await app.registerHabitCompletion(second.id);
    const habits = await app.fetchHabits();
    assert.equal(habits.find((habit) => habit.id === first.id).streak_count, 0);
    assert.equal(habits.find((habit) => habit.id === second.id).streak_count, 1);
    await assert.rejects(app.registerHabitCompletion('missing'), /não encontrado/);

    const original = await app.persistPomodoroSession(25, 'shared-completion');
    const repeated = await app.persistPomodoroSession(25, 'shared-completion');
    assert.deepEqual(repeated, original);
    assert.equal((await app.fetchPomodoroSessions()).length, 1);

    await app.insertOrUpdateBudget('Alimentação', 20000, '2026-10');
    await app.insertOrUpdateBudget('Alimentação', 30000, '2026-10');
    await app.insertOrUpdateBudget('Alimentação', 40000, '2026-11');
    const budgets = await app.fetchBudgets('2026-10');
    assert.equal(budgets.length, 1);
    assert.equal(budgets[0].limit_cents, 30000);
    assert.equal((await app.fetchBudgets('2026-11'))[0].limit_cents, 40000);
  });

  test(`${backend}: transação e saldo são atômicos, com datas e valores válidos`, async (t) => {
    const { app } = backend === 'sqlite' ? await createNativeApplication(t) : await loadApplication(t);
    const account = await app.insertAccount('Minha conta', 'checking', 5000);
    const today = app.localDate();
    const lastMonth = new Date();
    lastMonth.setDate(1);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await app.insertTransaction({ account_id: account.id, description: 'Recebimento', amount_cents: 3200, type: 'income', category: 'Trabalho', transaction_date: today });
    await app.insertTransaction({ account_id: account.id, description: 'Compra anterior', amount_cents: 1050, type: 'expense', category: 'Casa', transaction_date: app.localDate(lastMonth) });
    const balance = await app.fetchConsolidatedBalance();
    assert.deepEqual(balance, { total_balance_cents: 7150, monthly_income_cents: 3200, monthly_expense_cents: 0, accounts_count: 1 });
    assert.equal((await app.fetchTransactions())[0].description, 'Recebimento');
    const count = (await app.fetchTransactions()).length;
    await assert.rejects(app.insertTransaction({ account_id: 'missing', description: 'Não grava', amount_cents: 500, type: 'expense', category: 'Casa' }));
    for (const invalid of [-100, 0, 100.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(app.insertTransaction({ account_id: account.id, description: 'Não grava', amount_cents: invalid, type: 'expense', category: 'Casa' }));
    }
    await assert.rejects(app.insertTransaction({ account_id: account.id, description: 'Não grava', amount_cents: 100, type: 'expense', category: 'Casa', transaction_date: '2026-02-31' }));
    assert.equal((await app.fetchTransactions()).length, count);
    assert.equal((await app.fetchAccounts())[0].balance_cents, 7150);
  });
}

test('SQLite: inicialização aceita conexões alternadas do pool sem exigir PRAGMAs da conexão anterior', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pedro-pool-'));
  const path = join(directory, 'pooled.db');
  const connections = [new DatabaseSync(path), new DatabaseSync(path)];
  t.after(async () => {
    connections.forEach(connection => connection.close());
    await rm(directory, { recursive: true, force: true });
  });
  // SQLx abre conexões com FK habilitado e synchronous=FULL. Cada comando do
  // plugin pode adquirir outra conexão; o antigo SET NORMAL + SELECT falhava.
  connections.forEach(connection => {
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  });
  const adapters = connections.map(sqliteAdapter);
  let next = 0;
  const acquire = () => adapters[next++ % adapters.length];
  const pool = {
    execute: (query, binds) => acquire().execute(query, binds),
    select: (query, binds) => acquire().select(query, binds),
  };
  const { app } = await loadApplication(t, { loadNative: async () => pool });
  await app.getDatabase();
  const account = await app.insertAccount('Pool nativo', 'wallet', 1000);
  await app.insertTransaction({ account_id: account.id, description: 'Gravação íntegra', amount_cents: 250, type: 'expense', category: 'Casa' });
  assert.equal((await app.fetchAccounts())[0].balance_cents, 750);
  assert.equal((await app.fetchTransactions()).length, 1);
  for (const connection of connections) {
    assert.equal(connection.prepare('PRAGMA synchronous').get().synchronous, 2);
    assert.equal(connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  }
});

test('SQLite: inicialização rejeita gravação com synchronous desligado', async (t) => {
  const { app, db } = await createNativeApplication(t);
  db.exec('PRAGMA synchronous=OFF;');
  await assert.rejects(app.getDatabase(), /Não foi possível abrir os dados/);
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 0);
});

test('SQLite: migrações idempotentes e trigger se repetem sem alterar saldos anteriores', async (t) => {
  const { app, db } = await createNativeApplication(t);
  await app.getDatabase();
  const schemaSql = await readFile(new URL('../src/database/schema.sql', import.meta.url), 'utf8');
  // O arquivo distribuído corresponde às mesmas instruções usadas pela aplicação.
  const withoutComments = schemaSql.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
  for (const statement of app.SCHEMA_STATEMENTS) assert.ok(withoutComments.includes(statement.replace(/\s+/g, ' ').trim()));
  const account = await app.insertAccount('Saldo existente', 'checking', 7500);
  await app.insertTransaction({ account_id: account.id, description: 'Entrada', amount_cents: 2500, type: 'income', category: 'Outros' });
  await app.initializeNativeDatabase(await app.getDatabase());
  db.exec(schemaSql);
  assert.equal((await app.fetchAccounts())[0].balance_cents, 10000);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'transactions_update_account_balance'").get().count, 1);
  assert.throws(() => db.prepare('INSERT INTO transactions (id,account_id,description,amount_cents,type,category,transaction_date,created_at) VALUES (?,?,?,?,?,?,?,?)').run('bad', account.id, 'Inválida', 50.25, 'expense', 'Casa', '2026-10-12', new Date().toISOString()));
  assert.equal((await app.fetchAccounts())[0].balance_cents, 10000);
});

test('SQLite: falha do trigger reverte também a inserção da movimentação', async (t) => {
  const { app, db } = await createNativeApplication(t);
  const account = await app.insertAccount('Minha conta', 'wallet', 1000);
  db.exec("CREATE TRIGGER reject_balance_update BEFORE UPDATE OF balance_cents ON accounts BEGIN SELECT RAISE(ABORT, 'write rejected'); END;");
  await assert.rejects(app.insertTransaction({ account_id: account.id, description: 'Falha', amount_cents: 500, type: 'expense', category: 'Casa' }), /write rejected/);
  assert.deepEqual(await app.fetchTransactions(), []);
  assert.equal((await app.fetchAccounts())[0].balance_cents, 1000);
});

test('Browser: duas instâncias leem o estado fresco e salvam movimentação + saldo uma única vez', async (t) => {
  const storage = new MemoryStorage();
  const { app } = await loadApplication(t, { storage });
  const a = new app.BrowserSqlFallback(storage);
  const b = new app.BrowserSqlFallback(storage);
  assert.deepEqual(await a.select('SELECT * FROM tasks'), []);
  assert.deepEqual(await b.select('SELECT * FROM tasks'), []);
  await a.execute('INSERT INTO tasks (id,title,priority,completed,due_date,created_at) VALUES (?,?,?,0,?,?)', ['one', 'Um', 'low', null, '2026-10-10']);
  await b.execute('INSERT INTO tasks (id,title,priority,completed,due_date,created_at) VALUES (?,?,?,0,?,?)', ['two', 'Dois', 'high', '2026-10-20', '2026-10-11']);
  assert.equal((await a.select('SELECT * FROM tasks')).length, 2);
  assert.equal((await a.select('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 1'))[0].id, 'two');
  const account = await app.insertAccount('Conta', 'wallet', 1000);
  const writes = storage.writes;
  await app.insertTransaction({ account_id: account.id, description: 'Uma gravação', amount_cents: 250, type: 'expense', category: 'Casa' });
  assert.equal(storage.writes - writes, 1);
  assert.equal((await b.select('SELECT * FROM accounts WHERE id = ?', [account.id]))[0].balance_cents, 750);
});

test('Browser: dados anteriores e JSON inválido nunca são substituídos por demonstrações', async (t) => {
  const storage = new MemoryStorage();
  const old = { tasks: [], habits: [], accounts: [{ id: 'old', name: 'Antiga', type: 'checking', balance_cents: 250000, color: null, created_at: '2026-01-01', updated_at: null }], transactions: [{ id: 'initial', account_id: 'old', description: 'Aporte legado', amount_cents: 250000, type: 'income', category: 'Aporte', transaction_date: '2026-01-01', created_at: '2026-01-01' }] };
  storage.setItem(storageKey, JSON.stringify(old));
  const { app } = await loadApplication(t, { storage });
  assert.equal((await app.fetchAccounts())[0].balance_cents, 250000);
  await app.insertTask('Nova', 'low');
  assert.equal((await app.fetchTransactions()).length, 1);
  assert.equal((await app.fetchAccounts())[0].balance_cents, 250000);
  storage.setItem(storageKey, '{invalid-json');
  await assert.rejects(app.fetchTasks(), /preservados/);
  assert.equal(storage.getItem(storageKey), '{invalid-json');
});

test('Nativo: conexão concorrente é compartilhada; falha propaga sem criar preview', async (t) => {
  const diagnostics = [];
  t.mock.method(console, 'error', (...args) => diagnostics.push(args));
  const storage = new MemoryStorage();
  let calls = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { app } = await loadApplication(t, { storage, loadNative: async () => { calls++; await waiting; throw new Error('native unavailable'); } });
  const results = Promise.allSettled([app.getDatabase(), app.getDatabase(), app.getDatabase()]);
  release();
  const resolved = await results;
  assert.equal(calls, 1);
  assert.ok(resolved.every((result) => result.status === 'rejected' && /abrir os dados/.test(result.reason.message)));
  assert.equal(storage.getItem(storageKey), null);
  assert.match(diagnostics[0][0], /Não foi possível abrir/);
  await assert.rejects(app.getDatabase(), /abrir os dados/);
  assert.equal(calls, 2, 'Uma nova tentativa pode reconectar após falha.');
});


test('Browser: falha de armazenamento preserva transação e saldo anteriores', async (t) => {
  const storage = new MemoryStorage();
  const { app } = await loadApplication(t, { storage });
  const account = await app.insertAccount('Conta', 'wallet', 1000);
  const original = storage.getItem(storageKey);
  storage.setItem = () => { throw new Error('storage quota exceeded'); };
  await assert.rejects(app.insertTransaction({ account_id: account.id, description: 'Não salva', amount_cents: 250, type: 'expense', category: 'Casa' }), /quota/);
  assert.equal(storage.getItem(storageKey), original);
  assert.deepEqual(await app.fetchTransactions(), []);
  assert.equal((await app.fetchAccounts())[0].balance_cents, 1000);
});


test('SQLite: migração de dados antigos não recalcula nem apaga os saldos salvos', async (t) => {
  const { app, db } = await createNativeApplication(t);
  for (const statement of app.SCHEMA_STATEMENTS.filter((sql) => !sql.startsWith('CREATE TRIGGER'))) db.exec(statement);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO accounts (id,name,type,balance_cents,color,created_at) VALUES (?,?,?,?,?,?)').run('legacy-account', 'Legado', 'checking', 7500, null, now);
  db.prepare('INSERT INTO transactions (id,account_id,description,amount_cents,type,category,transaction_date,created_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy-tx', 'legacy-account', 'Anterior', 2000, 'income', 'Outros', '2026-01-01', now);
  await app.getDatabase();
  assert.equal((await app.fetchAccounts())[0].balance_cents, 7500);
  assert.equal((await app.fetchTransactions()).length, 1);
  await app.insertTransaction({ account_id: 'legacy-account', description: 'Nova entrada', amount_cents: 1000, type: 'income', category: 'Outros' });
  assert.equal((await app.fetchAccounts())[0].balance_cents, 8500);
  assert.equal((await app.fetchTransactions()).length, 2);
});


for (const backend of ['browser', 'sqlite']) {
  test(`${backend}: foco recuperado mantém o prazo original e rejeita instantes inválidos`, async (t) => {
    const { app } = backend === 'sqlite' ? await createNativeApplication(t) : await loadApplication(t);
    const deadline = '2026-10-11T23:58:00.000Z';
    const first = await app.persistPomodoroSession(25, 'recovered-deadline', deadline);
    assert.equal(first.completed_at, deadline);
    const duplicate = await app.persistPomodoroSession(30, first.id, '2026-10-12T12:00:00.000Z');
    assert.deepEqual(duplicate, first, 'A primeira conclusão prevalece entre janelas e reaberturas.');
    for (const invalid of ['', 'not-a-date', '2026-02-31T12:00:00.000Z', '2026-10-12', '2026-10-12T24:00:00.000Z', '2026-10-12T12:60:00.000Z', null]) {
      await assert.rejects(app.persistPomodoroSession(25, `invalid-${invalid}`, invalid), /instante de conclusão/);
    }
    const sessions = await app.fetchPomodoroSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].completed_at, deadline);
    const ordinary = await app.persistPomodoroSession(25, 'ordinary-session');
    assert.ok(Number.isFinite(Date.parse(ordinary.completed_at)), 'O terceiro argumento continua opcional.');
  });
}
