export type TaskPriority = 'low' | 'med' | 'high';

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  completed: number; // 0 ou 1
  due_date: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Habit {
  id: string;
  name: string;
  frequency: string;
  streak_count: number;
  last_completed: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface PomodoroSession {
  id: string;
  duration_minutes: number;
  completed_at: string;
}

export type AccountType = 'checking' | 'wallet' | 'savings';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance_cents: number; // inteiro em centavos
  color: string | null;
  created_at: string;
  updated_at: string | null;
}

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  account_id: string;
  description: string;
  amount_cents: number; // inteiro em centavos
  type: TransactionType;
  category: string;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  transaction_date: string;
  created_at: string;
  updated_at: string | null;
}

export interface Budget {
  id: string;
  category: string;
  limit_cents: number; // inteiro em centavos
  month_year: string; // formato 'AAAA-MM'
  created_at: string;
  updated_at: string | null;
}

export interface ConsolidatedBalance {
  total_balance_cents: number;
  monthly_income_cents: number;
  monthly_expense_cents: number;
  accounts_count: number;
}
