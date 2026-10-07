import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'agente_pedro.db');

test('Validação de Ciclo de Vida e Persistência do Agente Pedro', async (t) => {
  const nonce = Date.now();
  const taskId = `task-pers-${nonce}`;
  const habitId = `habit-pers-${nonce}`;
  const pomoId = `pomo-pers-${nonce}`;
  const accId = `acc-pers-${nonce}`;
  const txId = `tx-pers-${nonce}`;
  const budgetId = `bg-pers-${nonce}`;
  const budgetCategory = `Serviços-${nonce}`;
  const now = new Date().toISOString();

  // ETAPA 1: Abrir banco, gravar registros e fechar aplicação
  await t.test('Gravação dos registros no banco SQLite', () => {
    const db1 = new DatabaseSync(DB_PATH);

    // Grava Tarefa Prioritária
    db1.prepare(`
      INSERT INTO tasks (id, title, priority, completed, due_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, 'Tarefa de Teste Persistente', 'high', 0, '2026-10-07', now);

    // Grava Hábito com Streak
    db1.prepare(`
      INSERT INTO habits (id, name, frequency, streak_count, last_completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(habitId, 'Hábito de Teste Persistente', 'daily', 7, '2026-10-07', now);

    // Grava Sessão Pomodoro concluída de 25 minutos
    db1.prepare(`
      INSERT INTO pomodoro_sessions (id, duration_minutes, completed_at)
      VALUES (?, ?, ?)
    `).run(pomoId, 25, now);

    // Grava Conta
    db1.prepare(`
      INSERT INTO accounts (id, name, type, balance_cents, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(accId, 'Banco Digital Persistente', 'checking', 100000, '#10b981', now);

    // Grava Transação em centavos (R$ 150,00 -> 15000 centavos)
    db1.prepare(`
      INSERT INTO transactions (id, account_id, description, amount_cents, type, category, transaction_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(txId, accId, 'Assinatura Nuvem', 15000, 'expense', budgetCategory, '2026-10-07', now);

    // Atualiza saldo transacional
    db1.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(15000, accId);

    // Grava Orçamento Mensal
    db1.prepare(`
      INSERT OR REPLACE INTO budgets (id, category, limit_cents, month_year, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(budgetId, budgetCategory, 50000, '2026-10', now);

    // Fecha a conexão (simulando shutdown da aplicação)
    db1.close();
  });

  // ETAPA 2: Reabertura do banco e asserção de dados
  await t.test('Reabertura da aplicação e verificação de persistência real', () => {
    const db2 = new DatabaseSync(DB_PATH);

    // Consulta Tarefa
    const task = db2.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    assert.ok(task, 'A tarefa deve continuar existindo após fechar a aplicação');
    assert.equal(task.title, 'Tarefa de Teste Persistente');
    assert.equal(task.priority, 'high');
    assert.equal(task.completed, 0);

    // Consulta Hábito
    const habit = db2.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
    assert.ok(habit, 'O hábito deve continuar existindo após reiniciar');
    assert.equal(habit.streak_count, 7);

    // Consulta Pomodoro
    const pomo = db2.prepare('SELECT * FROM pomodoro_sessions WHERE id = ?').get(pomoId);
    assert.ok(pomo, 'A sessão Pomodoro de 25 min deve estar persistida');
    assert.equal(pomo.duration_minutes, 25);

    // Consulta Conta e Saldo Materializado
    const account = db2.prepare('SELECT * FROM accounts WHERE id = ?').get(accId);
    assert.ok(account, 'A conta deve continuar existindo');
    assert.equal(account.balance_cents, 85000, 'Saldo deve permanecer exatamente 85000 centavos (R$ 850,00)');

    // Consulta Transação
    const tx = db2.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
    assert.ok(tx, 'A transação deve continuar existindo intacta');
    assert.equal(tx.amount_cents, 15000);
    assert.equal(tx.type, 'expense');

    // Consulta Orçamento
    const budget = db2.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId);
    assert.ok(budget, 'O orçamento mensal deve persistir');
    assert.equal(budget.limit_cents, 50000);

    db2.close();
  });
});
