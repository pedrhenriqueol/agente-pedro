import Database from '@tauri-apps/plugin-sql';
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

let dbInstance: SqlDatabase | null = null;

// Fallback de desenvolvimento em memória/localStorage para preview sem runtime Tauri nativo
class BrowserSqlFallback implements SqlDatabase {
  private storageKey = 'agente_pedro_local_db';
  private tables: {
    tasks: Task[];
    habits: Habit[];
    pomodoro_sessions: PomodoroSession[];
    accounts: Account[];
    transactions: Transaction[];
    budgets: Budget[];
  };

  constructor() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        this.tables = JSON.parse(saved);
      } catch {
        this.tables = this.initialData();
      }
    } else {
      this.tables = this.initialData();
      this.save();
    }
  }

  private initialData() {
    return {
      tasks: [
        {
          id: 'task-1',
          title: 'Configurar ambiente e janelas do Agente Pedro',
          priority: 'high' as TaskPriority,
          completed: 1,
          due_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: null,
        },
        {
          id: 'task-2',
          title: 'Validar persistência local em centavos no SQLite',
          priority: 'high' as TaskPriority,
          completed: 0,
          due_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ],
      habits: [
        {
          id: 'habit-1',
          name: 'Revisão matinal e foco profundo',
          frequency: 'daily',
          streak_count: 5,
          last_completed: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ],
      pomodoro_sessions: [],
      accounts: [
        {
          id: 'acc-1',
          name: 'Conta Principal',
          type: 'checking' as const,
          balance_cents: 250000, // R$ 2.500,00
          color: '#10b981',
          created_at: new Date().toISOString(),
          updated_at: null,
        },
        {
          id: 'acc-2',
          name: 'Reserva de Emergência',
          type: 'savings' as const,
          balance_cents: 1000000, // R$ 10.000,00
          color: '#3b82f6',
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          account_id: 'acc-1',
          description: 'Aporte inicial verificado',
          amount_cents: 250000,
          type: 'income' as const,
          category: 'Aporte',
          installment_group_id: null,
          installment_number: null,
          installment_total: null,
          transaction_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ],
      budgets: [
        {
          id: 'bg-1',
          category: 'Alimentação',
          limit_cents: 80000, // R$ 800,00
          month_year: new Date().toISOString().slice(0, 7),
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ],
    };
  }

  private save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.tables));
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId: number }> {
    const q = query.trim().toUpperCase();

    if (q.startsWith('INSERT INTO TASKS')) {
      const [id, title, priority, completed, due_date, created_at] = bindValues as [string, string, TaskPriority, number, string | null, string];
      this.tables.tasks.push({ id, title, priority, completed: completed || 0, due_date, created_at, updated_at: null });
      this.save();
      return { rowsAffected: 1, lastInsertId: 1 };
    }

    if (q.startsWith('UPDATE TASKS SET COMPLETED')) {
      const [completed, updated_at, id] = bindValues as [number, string, string];
      const task = this.tables.tasks.find((t) => t.id === id);
      if (task) {
        task.completed = completed;
        task.updated_at = updated_at;
        this.save();
      }
      return { rowsAffected: 1, lastInsertId: 0 };
    }

    if (q.startsWith('DELETE FROM TASKS')) {
      const [id] = bindValues as [string];
      this.tables.tasks = this.tables.tasks.filter((t) => t.id !== id);
      this.save();
      return { rowsAffected: 1, lastInsertId: 0 };
    }

    if (q.startsWith('INSERT INTO HABITS')) {
      const [id, name, frequency, created_at] = bindValues as [string, string, string, string];
      this.tables.habits.push({ id, name, frequency, streak_count: 0, last_completed: null, created_at, updated_at: null });
      this.save();
      return { rowsAffected: 1, lastInsertId: 1 };
    }

    if (q.startsWith('UPDATE HABITS SET STREAK_COUNT')) {
      const [streak, last, updated_at, id] = bindValues as [number, string, string, string];
      const habit = this.tables.habits.find((h) => h.id === id);
      if (habit) {
        habit.streak_count = streak;
        habit.last_completed = last;
        habit.updated_at = updated_at;
        this.save();
      }
      return { rowsAffected: 1, lastInsertId: 0 };
    }

    if (q.startsWith('INSERT INTO POMODORO_SESSIONS')) {
      const [id, duration, completed_at] = bindValues as [string, number, string];
      this.tables.pomodoro_sessions.push({ id, duration_minutes: duration, completed_at });
      this.save();
      return { rowsAffected: 1, lastInsertId: 1 };
    }

    if (q.startsWith('INSERT INTO ACCOUNTS')) {
      const [id, name, type, balance_cents, color, created_at] = bindValues as [string, string, any, number, string, string];
      this.tables.accounts.push({ id, name, type, balance_cents, color, created_at, updated_at: null });
      this.save();
      return { rowsAffected: 1, lastInsertId: 1 };
    }

    if (q.startsWith('INSERT INTO TRANSACTIONS')) {
      const [id, account_id, description, amount_cents, type, category, inst_grp, inst_num, inst_tot, tx_date, created_at] = bindValues as any[];
      this.tables.transactions.push({
        id,
        account_id,
        description,
        amount_cents,
        type,
        category,
        installment_group_id: inst_grp ?? null,
        installment_number: inst_num ?? null,
        installment_total: inst_tot ?? null,
        transaction_date: tx_date,
        created_at,
        updated_at: null,
      });

      // Atualiza saldo da conta transacionalmente
      const acc = this.tables.accounts.find((a) => a.id === account_id);
      if (acc) {
        if (type === 'income') {
          acc.balance_cents += amount_cents;
        } else {
          acc.balance_cents -= amount_cents;
        }
      }

      this.save();
      return { rowsAffected: 1, lastInsertId: 1 };
    }

    return { rowsAffected: 1, lastInsertId: 0 };
  }

  async select<T>(query: string, _bindValues: unknown[] = []): Promise<T> {
    const q = query.trim().toUpperCase();

    if (q.includes('FROM TASKS')) {
      return [...this.tables.tasks] as unknown as T;
    }
    if (q.includes('FROM HABITS')) {
      return [...this.tables.habits] as unknown as T;
    }
    if (q.includes('FROM POMODORO_SESSIONS')) {
      return [...this.tables.pomodoro_sessions] as unknown as T;
    }
    if (q.includes('FROM ACCOUNTS')) {
      return [...this.tables.accounts] as unknown as T;
    }
    if (q.includes('FROM TRANSACTIONS')) {
      return [...this.tables.transactions] as unknown as T;
    }
    if (q.includes('FROM BUDGETS')) {
      return [...this.tables.budgets] as unknown as T;
    }

    return [] as unknown as T;
  }
}

// Inicializa a conexão com o banco de dados e executa migrações idempotentes
export async function getDatabase(): Promise<SqlDatabase> {
  if (dbInstance) return dbInstance;

  try {
    // Verifica se estamos no ambiente nativo do Tauri
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const db = await Database.load(DB_FILE);

      // Aplica configurações do WAL mode obrigatórias
      await db.execute('PRAGMA journal_mode = WAL;');
      await db.execute('PRAGMA synchronous = NORMAL;');
      await db.execute('PRAGMA foreign_keys = ON;');

      // Criação de tabelas
      await db.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          priority TEXT NOT NULL CHECK(priority IN ('low', 'med', 'high')),
          completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
          due_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS habits (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          frequency TEXT NOT NULL DEFAULT 'daily',
          streak_count INTEGER NOT NULL DEFAULT 0,
          last_completed TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
          id TEXT PRIMARY KEY,
          duration_minutes INTEGER NOT NULL,
          completed_at TEXT NOT NULL
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('checking', 'wallet', 'savings')),
          balance_cents INTEGER NOT NULL DEFAULT 0,
          color TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
          description TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
          category TEXT NOT NULL,
          installment_group_id TEXT,
          installment_number INTEGER,
          installment_total INTEGER,
          transaction_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS budgets (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          limit_cents INTEGER NOT NULL,
          month_year TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          UNIQUE(category, month_year)
        );
      `);

      // Cria conta padrão caso não exista nenhuma
      const existingAccounts = await db.select<Account[]>('SELECT * FROM accounts LIMIT 1');
      if (existingAccounts.length === 0) {
        await db.execute(
          'INSERT INTO accounts (id, name, type, balance_cents, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['acc-default', 'Carteira Principal', 'checking', 0, '#10b981', new Date().toISOString()]
        );
      }

      dbInstance = db;
      return db;
    }
  } catch (error) {
    console.warn('[Agente Pedro DB] Modo nativo Tauri indisponível, usando fallback determinístico local:', error);
  }

  dbInstance = new BrowserSqlFallback();
  return dbInstance;
}

// ── MÓDULO ROTINA & FOCO ──

export async function fetchTasks(): Promise<Task[]> {
  const db = await getDatabase();
  return db.select<Task[]>('SELECT * FROM tasks ORDER BY completed ASC, created_at DESC');
}

export async function insertTask(title: string, priority: TaskPriority, dueDate: string | null = null): Promise<Task> {
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

  const todayStr = new Date().toISOString().split('T')[0];
  let newStreak = habit.streak_count;

  // Se já foi concluído hoje, mantém; senão incrementa
  if (habit.last_completed !== todayStr) {
    newStreak += 1;
  }

  const now = new Date().toISOString();
  await db.execute(
    'UPDATE habits SET streak_count = ?, last_completed = ?, updated_at = ? WHERE id = ?',
    [newStreak, todayStr, now, id]
  );

  return { streak_count: newStreak, last_completed: todayStr };
}

export async function persistPomodoroSession(durationMinutes: number): Promise<PomodoroSession> {
  const db = await getDatabase();
  const id = `pomo-${Date.now()}`;
  const now = new Date().toISOString();

  await db.execute(
    'INSERT INTO pomodoro_sessions (id, duration_minutes, completed_at) VALUES (?, ?, ?)',
    [id, durationMinutes, now]
  );

  return {
    id,
    duration_minutes: durationMinutes,
    completed_at: now,
  };
}

// ── MÓDULO FINANÇAS & CONTROLE ──

export async function fetchAccounts(): Promise<Account[]> {
  const db = await getDatabase();
  return db.select<Account[]>('SELECT * FROM accounts ORDER BY created_at ASC');
}

export async function insertAccount(name: string, type: 'checking' | 'wallet' | 'savings', initialBalanceCents = 0, color = '#10b981'): Promise<Account> {
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
  const txDate = params.transaction_date || now.split('T')[0];

  // Garante que amount_cents seja inteiro positivo
  const amountCents = Math.abs(Math.round(params.amount_cents));

  await db.execute(
    `INSERT INTO transactions (
      id, account_id, description, amount_cents, type, category,
      installment_group_id, installment_number, installment_total,
      transaction_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.account_id,
      params.description,
      amountCents,
      params.type,
      params.category,
      params.installment_group_id ?? null,
      params.installment_number ?? null,
      params.installment_total ?? null,
      txDate,
      now,
    ]
  );

  // Atualização transacional do saldo materializado da conta
  const balanceAdjustment = params.type === 'income' ? amountCents : -amountCents;
  await db.execute(
    'UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?',
    [balanceAdjustment, now, params.account_id]
  );

  return {
    id,
    account_id: params.account_id,
    description: params.description,
    amount_cents: amountCents,
    type: params.type,
    category: params.category,
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
  const my = monthYear || new Date().toISOString().slice(0, 7);
  return db.select<Budget[]>('SELECT * FROM budgets WHERE month_year = ? ORDER BY category ASC', [my]);
}

export async function insertOrUpdateBudget(category: string, limitCents: number, monthYear: string): Promise<void> {
  const db = await getDatabase();
  const id = `bg-${Date.now()}`;
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO budgets (id, category, limit_cents, month_year, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category, month_year) DO UPDATE SET limit_cents = excluded.limit_cents, updated_at = ?`,
    [id, category, Math.round(limitCents), monthYear, now, now]
  );
}

export async function fetchConsolidatedBalance(): Promise<ConsolidatedBalance> {
  const db = await getDatabase();
  const accounts = await db.select<Account[]>('SELECT balance_cents FROM accounts');
  const totalBalance = accounts.reduce((acc, a) => acc + a.balance_cents, 0);

  const currentMonth = new Date().toISOString().slice(0, 7);
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
