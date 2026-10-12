import Database from '@tauri-apps/plugin-sql';
import { BrowserSqlFallback } from './browser';
import { SCHEMA_STATEMENTS } from './schema';
import { isLocalDate, isLocalMonth, localDate, localMonth, previousLocalDate } from './date';
import type {
  Account,
  Budget,
  ConsolidatedBalance,
  Habit,
  PomodoroSession,
  Task,
  TaskPriority,
  Transaction,
} from './types';

// Nome do arquivo de banco SQLite
export const DB_FILE = 'sqlite:agente_pedro.db';

// Interface unificada para operações SQL
export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

let databasePromise: Promise<SqlDatabase> | null = null;

/** Inicialização compartilhada entre chamadas concorrentes; erros nativos nunca viram dados de preview. */
export async function getDatabase(): Promise<SqlDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function initializeDatabase(): Promise<SqlDatabase> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return new BrowserSqlFallback();
  }
  try {
    const db = await Database.load(DB_FILE);
    await initializeNativeDatabase(db);
    return db;
  } catch (error) {
    console.error('[Agente Pedro DB] Não foi possível abrir o banco local:', error);
    throw new Error('Não foi possível abrir os dados do aplicativo. Tente novamente; seus registros não foram substituídos.', { cause: error });
  }
}

export async function initializeNativeDatabase(db: SqlDatabase): Promise<void> {
  // journal_mode retorna linhas: SELECT consome o retorno corretamente no plugin SQL.
  const mode = await db.select<{ journal_mode: string }[]>('PRAGMA journal_mode = WAL;');
  if (mode[0]?.journal_mode?.toLowerCase() !== 'wal') throw new Error('O banco não confirmou o modo WAL.');
  // O plugin usa um pool: SET e SELECT podem pegar conexões diferentes. SQLx
  // abre cada conexão com synchronous=FULL; preservamos esse default seguro.
  // NORMAL/EXTRA também são seguros para WAL; OFF não é aceito.
  const synchronous = await db.select<{ synchronous: number }[]>('PRAGMA synchronous;');
  if (![1, 2, 3].includes(synchronous[0]?.synchronous)) throw new Error('O banco não confirmou a configuração de gravação.');
  await db.execute('PRAGMA foreign_keys = ON;');
  const foreignKeys = await db.select<{ foreign_keys: number }[]>('PRAGMA foreign_keys;');
  if (foreignKeys[0]?.foreign_keys !== 1) throw new Error('O banco não confirmou a integridade entre contas e movimentações.');
  for (const statement of SCHEMA_STATEMENTS) await db.execute(statement);
}

// ── MÓDULO ROTINA & FOCO ──

export async function fetchTasks(): Promise<Task[]> {
  const db = await getDatabase();
  return db.select<Task[]>('SELECT * FROM tasks ORDER BY completed ASC, created_at DESC');
}

export async function insertTask(title: string, priority: TaskPriority, dueDate: string | null = null): Promise<Task> {
  title = requiredText(title, 'O título da tarefa');
  if (!['low', 'med', 'high'].includes(priority)) throw new Error('A prioridade é inválida.');
  if (dueDate !== null && !isLocalDate(dueDate)) throw new Error('O prazo da tarefa é inválido.');
  const db = await getDatabase();
  const id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.execute(
    'INSERT INTO tasks (id, title, priority, completed, due_date, created_at) VALUES (?, ?, ?, 0, ?, ?)',
    [id, title, priority, dueDate, now]
  );

  return {
    id,
    title,
    priority,
    completed: 0,
    due_date: dueDate,
    created_at: now,
    updated_at: null,
  };
}

export async function updateTaskCompletion(id: string, completed: boolean): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute('UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?', [
    completed ? 1 : 0,
    now,
    id,
  ]);
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
}

export async function fetchHabits(): Promise<Habit[]> {
  const db = await getDatabase();
  return db.select<Habit[]>('SELECT * FROM habits ORDER BY created_at ASC');
}

export async function insertHabit(name: string, frequency = 'daily'): Promise<Habit> {
  name = requiredText(name, 'O nome do hábito');
  const db = await getDatabase();
  const id = `habit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.execute(
    'INSERT INTO habits (id, name, frequency, created_at) VALUES (?, ?, ?, ?)',
    [id, name, frequency, now]
  );

  return {
    id,
    name,
    frequency,
    streak_count: 0,
    last_completed: null,
    created_at: now,
    updated_at: null,
  };
}

export async function registerHabitCompletion(id: string): Promise<{ streak_count: number; last_completed: string }> {
  const db = await getDatabase();
  const habits = await db.select<Habit[]>('SELECT * FROM habits WHERE id = ?', [id]);
  const habit = habits[0];
  if (!habit) throw new Error('Hábito não encontrado');

  const todayStr = localDate();
  // Hoje é idempotente; ontem continua a sequência; um intervalo reinicia em um.
  const newStreak = habit.last_completed === todayStr
    ? habit.streak_count
    : habit.last_completed === previousLocalDate() ? habit.streak_count + 1 : 1;

  const now = new Date().toISOString();
  await db.execute(
    'UPDATE habits SET streak_count = ?, last_completed = ?, updated_at = ? WHERE id = ?',
    [newStreak, todayStr, now, id]
  );

  return { streak_count: newStreak, last_completed: todayStr };
}

export async function fetchPomodoroSessions(): Promise<PomodoroSession[]> {
  const db = await getDatabase();
  return db.select<PomodoroSession[]>('SELECT * FROM pomodoro_sessions ORDER BY completed_at DESC');
}

export async function persistPomodoroSession(durationMinutes: number, sessionId?: string, completedAt?: string): Promise<PomodoroSession> {
  assertInteger(durationMinutes, 'A duração da sessão', true);
  const completion = completedAt === undefined ? new Date().toISOString() : completionTimestamp(completedAt);
  const db = await getDatabase();
  const id = sessionId || `pomo-${crypto.randomUUID()}`;
  await db.execute(
    'INSERT OR IGNORE INTO pomodoro_sessions (id, duration_minutes, completed_at) VALUES (?, ?, ?)',
    [id, durationMinutes, completion]
  );
  const rows = await db.select<PomodoroSession[]>('SELECT * FROM pomodoro_sessions WHERE id = ?', [id]);
  if (!rows[0]) throw new Error('Não foi possível confirmar o registro da sessão de foco.');
  return rows[0];
}

// ── MÓDULO FINANÇAS & CONTROLE ──

export async function fetchAccounts(): Promise<Account[]> {
  const db = await getDatabase();
  return db.select<Account[]>('SELECT * FROM accounts ORDER BY created_at ASC');
}

export async function insertAccount(name: string, type: 'checking' | 'wallet' | 'savings', initialBalanceCents = 0, color = '#10b981'): Promise<Account> {
  name = requiredText(name, 'O nome da conta');
  assertInteger(initialBalanceCents, 'O saldo inicial');
  if (!['checking', 'wallet', 'savings'].includes(type)) throw new Error('O tipo da conta é inválido.');
  const db = await getDatabase();
  const id = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.execute(
    'INSERT INTO accounts (id, name, type, balance_cents, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, type, initialBalanceCents, color, now]
  );

  return {
    id,
    name,
    type,
    balance_cents: initialBalanceCents,
    color,
    created_at: now,
    updated_at: null,
  };
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.select<Transaction[]>('SELECT * FROM transactions ORDER BY transaction_date DESC, created_at DESC');
}

/**
 * REGRA DE FONTE DE VERDADE DO SALDO:
 * Inserção de transação e atualização do saldo da conta são realizadas de forma
 * atômica/transacional. O saldo na tabela accounts serve como materialização
 * de alto desempenho, com integridade garantida por chave estrangeira.
 */
export async function insertTransaction(params: {
  account_id: string;
  description: string;
  amount_cents: number;
  type: 'income' | 'expense';
  category: string;
  transaction_date?: string;
  installment_group_id?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
}): Promise<Transaction> {
  const db = await getDatabase();
  const id = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const txDate = params.transaction_date || localDate();
  if (!isLocalDate(txDate)) throw new Error('A data da movimentação é inválida.');
  if (!['income', 'expense'].includes(params.type)) throw new Error('O tipo da movimentação é inválido.');

  assertInteger(params.amount_cents, 'O valor da movimentação', true);
  const amountCents = params.amount_cents;
  const description = requiredText(params.description, 'A descrição');
  const category = requiredText(params.category, 'A categoria');
  requiredText(params.account_id, 'A conta');
  const installmentNumber = params.installment_number ?? null;
  const installmentTotal = params.installment_total ?? null;
  if (installmentNumber !== null || installmentTotal !== null) {
    if (installmentNumber === null || installmentTotal === null) throw new Error('Informe a parcela e o total de parcelas.');
    assertInteger(installmentNumber, 'A parcela', true);
    assertInteger(installmentTotal, 'O total de parcelas', true);
    if (installmentNumber > installmentTotal) throw new Error('A parcela não pode exceder o total de parcelas.');
  }

  await db.execute(
    `INSERT INTO transactions (
      id, account_id, description, amount_cents, type, category,
      installment_group_id, installment_number, installment_total,
      transaction_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.account_id,
      description,
      amountCents,
      params.type,
      category,
      params.installment_group_id ?? null,
      params.installment_number ?? null,
      params.installment_total ?? null,
      txDate,
      now,
    ]
  );

  return {
    id,
    account_id: params.account_id,
    description,
    amount_cents: amountCents,
    type: params.type,
    category,
    installment_group_id: params.installment_group_id ?? null,
    installment_number: params.installment_number ?? null,
    installment_total: params.installment_total ?? null,
    transaction_date: txDate,
    created_at: now,
    updated_at: null,
  };
}

export async function fetchBudgets(monthYear?: string): Promise<Budget[]> {
  const db = await getDatabase();
  const my = monthYear || localMonth();
  if (!isLocalMonth(my)) throw new Error('O mês do orçamento é inválido.');
  return db.select<Budget[]>('SELECT * FROM budgets WHERE month_year = ? ORDER BY category ASC', [my]);
}

export async function insertOrUpdateBudget(category: string, limitCents: number, monthYear: string): Promise<void> {
  category = requiredText(category, 'A categoria');
  assertInteger(limitCents, 'O limite do orçamento', true);
  if (!isLocalMonth(monthYear)) throw new Error('O mês do orçamento é inválido.');
  const db = await getDatabase();
  const id = `bg-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO budgets (id, category, limit_cents, month_year, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category, month_year) DO UPDATE SET limit_cents = excluded.limit_cents, updated_at = ?`,
    [id, category, limitCents, monthYear, now, now]
  );
}

export async function fetchConsolidatedBalance(): Promise<ConsolidatedBalance> {
  const db = await getDatabase();
  const accounts = await db.select<Account[]>('SELECT balance_cents FROM accounts');
  const totalBalance = accounts.reduce((acc, a) => acc + a.balance_cents, 0);

  const currentMonth = localMonth();
  const txs = await db.select<Transaction[]>(
    'SELECT amount_cents, type FROM transactions WHERE transaction_date LIKE ?',
    [`${currentMonth}%`]
  );

  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === 'income') income += t.amount_cents;
    else expense += t.amount_cents;
  }

  return {
    total_balance_cents: totalBalance,
    monthly_income_cents: income,
    monthly_expense_cents: expense,
    accounts_count: accounts.length,
  };
}


function assertInteger(value: number, label: string, positive = false): void {
  if (!Number.isSafeInteger(value) || (positive && value <= 0)) {
    throw new Error(`${label} deve ser um inteiro${positive ? ' positivo' : ''} válido.`);
  }
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} é obrigatório.`);
  return value.trim();
}


/** Registros recuperados usam o prazo original, evitando atribuir o foco ao dia da reabertura. */
function completionTimestamp(value: string): string {
  const isoUtc = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
  if (typeof value !== 'string' || !isoUtc.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('O instante de conclusão da sessão é inválido.');
  }
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 10) !== value.slice(0, 10)) throw new Error('O instante de conclusão da sessão é inválido.');
  return normalized;
}
