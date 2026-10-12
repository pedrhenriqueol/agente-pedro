// Mantido em conjunto com schema.sql; validado pelo teste da migração real.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('low', 'med', 'high')),
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);`,
  `CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'daily',
    streak_count INTEGER NOT NULL DEFAULT 0,
    last_completed TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);`,
  `CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id TEXT PRIMARY KEY,
    duration_minutes INTEGER NOT NULL,
    completed_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('checking', 'wallet', 'savings')),
    balance_cents INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);`,
  `CREATE TABLE IF NOT EXISTS transactions (
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
);`,
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    limit_cents INTEGER NOT NULL,
    month_year TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE(category, month_year)
);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);`,
  `CREATE INDEX IF NOT EXISTS idx_budgets_month_year ON budgets(month_year);`,
  `CREATE TRIGGER IF NOT EXISTS validate_transaction_insert
BEFORE INSERT ON transactions
BEGIN
    SELECT CASE WHEN typeof(NEW.amount_cents) != 'integer' OR NEW.amount_cents <= 0 OR NEW.amount_cents > 9007199254740991
        THEN RAISE(ABORT, 'amount_cents must be a positive integer') END;
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id)
        THEN RAISE(ABORT, 'account does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id
        AND abs(balance_cents + CASE WHEN NEW.type = 'income' THEN NEW.amount_cents ELSE -NEW.amount_cents END) <= 9007199254740991
    ) THEN RAISE(ABORT, 'balance exceeds safe integer range') END;
END;`,
  `CREATE TRIGGER IF NOT EXISTS transactions_update_account_balance
AFTER INSERT ON transactions
BEGIN
    UPDATE accounts
    SET balance_cents = balance_cents + CASE WHEN NEW.type = 'income' THEN NEW.amount_cents ELSE -NEW.amount_cents END,
        updated_at = NEW.created_at
    WHERE id = NEW.account_id;
END;`,
  `CREATE TRIGGER IF NOT EXISTS validate_account_insert
BEFORE INSERT ON accounts
BEGIN
    SELECT CASE WHEN typeof(NEW.balance_cents) != 'integer' OR abs(NEW.balance_cents) > 9007199254740991
        THEN RAISE(ABORT, 'balance_cents must be a safe integer') END;
END;`,
  `CREATE TRIGGER IF NOT EXISTS validate_budget_insert
BEFORE INSERT ON budgets
BEGIN
    SELECT CASE WHEN typeof(NEW.limit_cents) != 'integer' OR NEW.limit_cents <= 0 OR NEW.limit_cents > 9007199254740991
        THEN RAISE(ABORT, 'limit_cents must be a positive integer') END;
END;`,
  `CREATE TRIGGER IF NOT EXISTS validate_budget_update
BEFORE UPDATE OF limit_cents ON budgets
BEGIN
    SELECT CASE WHEN typeof(NEW.limit_cents) != 'integer' OR NEW.limit_cents <= 0 OR NEW.limit_cents > 9007199254740991
        THEN RAISE(ABORT, 'limit_cents must be a positive integer') END;
END;`,
];
