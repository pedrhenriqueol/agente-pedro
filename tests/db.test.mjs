import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'test_db.db');
const SCHEMA_PATH = join(process.cwd(), 'src', 'database', 'schema.sql');

test('SQLite WAL Mode e Schema Inicial', async (t) => {
  if (existsSync(DB_PATH)) {
    try { unlinkSync(DB_PATH); } catch {}
  }

  const db = new DatabaseSync(DB_PATH);

  await t.test('1. Aplicação e validação do modo WAL', () => {
    db.exec('PRAGMA journal_mode = WAL;');
    const res = db.prepare('PRAGMA journal_mode;').get();
    assert.equal(res.journal_mode, 'wal', 'O modo WAL deve estar ativado');

    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    const fk = db.prepare('PRAGMA foreign_keys;').get();
    assert.equal(fk.foreign_keys, 1, 'Foreign keys devem estar ativas');
  });

  await t.test('2. Execução da migration e criação de tabelas', () => {
    const schemaSql = readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schemaSql);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
    const tableNames = tables.map((r) => r.name);

    assert.ok(tableNames.includes('tasks'), 'Tabela tasks deve existir');
    assert.ok(tableNames.includes('habits'), 'Tabela habits deve existir');
    assert.ok(tableNames.includes('pomodoro_sessions'), 'Tabela pomodoro_sessions deve existir');
    assert.ok(tableNames.includes('accounts'), 'Tabela accounts deve existir');
    assert.ok(tableNames.includes('transactions'), 'Tabela transactions deve existir');
    assert.ok(tableNames.includes('budgets'), 'Tabela budgets deve existir');
  });

  await t.test('3. Integridade financeira e modelagem estrita em centavos', () => {
    const now = new Date().toISOString();

    // Cria conta com saldo inicial de R$ 50,00 (5000 centavos)
    db.prepare(`
      INSERT INTO accounts (id, name, type, balance_cents, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('acc-test-1', 'Conta Corrente Teste', 'checking', 5000, '#10b981', now);

    // Cria transação de despesa de R$ 10,50 (1050 centavos)
    db.prepare(`
      INSERT INTO transactions (id, account_id, description, amount_cents, type, category, transaction_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('tx-test-1', 'acc-test-1', 'Almoço Executivo', 1050, 'expense', 'Alimentação', '2026-10-07', now);

    // Atualização atômica do saldo
    db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(1050, 'acc-test-1');

    const acc = db.prepare('SELECT balance_cents FROM accounts WHERE id = ?').get('acc-test-1');
    assert.equal(acc.balance_cents, 3950, 'Saldo deve ser exatamente 3950 centavos (R$ 39,50)');

    // Testa violação de chave estrangeira
    assert.throws(() => {
      db.prepare(`
        INSERT INTO transactions (id, account_id, description, amount_cents, type, category, transaction_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('tx-invalida', 'acc-inexistente', 'Teste Falha', 500, 'expense', 'Outros', '2026-10-07', now);
    }, 'Transação vinculada a conta inexistente deve falhar por restrição de chave estrangeira');
  });

  db.close();
});
