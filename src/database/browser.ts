import type { SqlDatabase } from './database';
import type { Account, Budget, Habit, PomodoroSession, Task, Transaction } from './types';

type Tables = {
  tasks: Task[];
  habits: Habit[];
  pomodoro_sessions: PomodoroSession[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
};
type Row = Record<string, unknown>;
const TABLES: (keyof Tables)[] = ['tasks', 'habits', 'pomodoro_sessions', 'accounts', 'transactions', 'budgets'];
export const BROWSER_STORAGE_KEY = 'agente_pedro_local_db';

/** Preview local. Cada operação lê o estado atual; nenhuma janela mantém uma cópia antiga. */
export class BrowserSqlFallback implements SqlDatabase {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {}

  private read(): Tables {
    const saved = this.storage.getItem(BROWSER_STORAGE_KEY);
    if (saved === null) {
      return { tasks: [], habits: [], pomodoro_sessions: [], accounts: [], transactions: [], budgets: [] };
    }
    let data: unknown;
    try { data = JSON.parse(saved); }
    catch { throw new Error('Não foi possível ler os dados locais. Os dados salvos foram preservados.'); }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('O formato dos dados locais é inválido. Nenhum registro foi substituído.');
    }
    const tables = data as Record<string, unknown>;
    for (const table of TABLES) {
      // Versões anteriores podem ainda não ter todas as tabelas.
      if (tables[table] === undefined) tables[table] = [];
      if (!Array.isArray(tables[table])) throw new Error(`Não foi possível ler ${table}. Os dados salvos foram preservados.`);
    }
    return tables as Tables;
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    const mutate = () => this.mutate(query, bindValues);
    // Evita perder gravações simultâneas entre abas quando Web Locks está disponível.
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(BROWSER_STORAGE_KEY, mutate);
    }
    return mutate();
  }

  private mutate(query: string, bindValues: unknown[]): { rowsAffected: number; lastInsertId?: number } {
    const tables = this.read();
    const sql = query.trim().replace(/\s+/g, ' ').replace(/;$/, '');
    const insertion = /^INSERT (OR IGNORE )?INTO (\w+)\s*\(([^)]+)\) VALUES\s*\(([^)]+)\)(.*)$/i.exec(sql);
    let rowsAffected = 0;
    if (insertion) {
      const [, ignore, tableName, columnSql, valueSql, conflictSql] = insertion;
      const table = this.tableName(tableName);
      const columns = columnSql.split(',').map((c) => c.trim().toLowerCase());
      let bindIndex = 0;
      const values = valueSql.split(',').map((value) => {
        const literal = value.trim();
        if (literal === '?') return bindValues[bindIndex++];
        if (/^NULL$/i.test(literal)) return null;
        if (/^-?\d+$/.test(literal)) return Number(literal);
        throw new Error(`Valor SQL não suportado no preview: ${literal}`);
      });
      if (values.length !== columns.length) throw new Error('Os valores SQL não correspondem às colunas.');
      const row = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
      const entries = tables[table] as unknown as Row[];
      const existing = entries.find((item) => item.id === row.id);
      if (existing) {
        if (ignore) return { rowsAffected: 0 };
        throw new Error(`O registro ${String(row.id)} já existe.`);
      }
      if (table === 'budgets' && conflictSql) {
        const budget = tables.budgets.find((item) => item.category === row.category && item.month_year === row.month_year);
        this.validate(table, row, tables);
        if (budget) {
          budget.limit_cents = row.limit_cents as number;
          budget.updated_at = bindValues[bindIndex] as string;
        } else entries.push({ ...row, updated_at: null });
      } else {
        if (conflictSql) throw new Error('Conflito SQL não suportado no preview.');
        const withDefaults = { updated_at: null, ...row };
        if (table === 'habits') Object.assign(withDefaults, { streak_count: 0, last_completed: null });
        this.validate(table, withDefaults, tables);
        entries.push(withDefaults);
        if (table === 'transactions') {
          const account = tables.accounts.find((item) => item.id === row.account_id)!;
          account.balance_cents += (row.type === 'income' ? 1 : -1) * (row.amount_cents as number);
          account.updated_at = row.created_at as string;
        }
      }
      rowsAffected = 1;
    } else {
      const update = /^UPDATE (tasks|habits) SET (.+) WHERE id = \?$/i.exec(sql);
      const deletion = /^DELETE FROM (tasks) WHERE id = \?$/i.exec(sql);
      if (update) {
        const table = this.tableName(update[1]);
        const assignments = update[2].split(',').map((part) => /^\s*(\w+)\s*=\s*\?\s*$/.exec(part));
        if (assignments.some((part) => !part)) throw new Error('Atualização SQL não suportada no preview.');
        const entry = (tables[table] as unknown as Row[]).find((item) => item.id === bindValues[assignments.length]);
        if (entry) {
          assignments.forEach((part, i) => { entry[part![1].toLowerCase()] = bindValues[i]; });
          this.validate(table, entry, tables);
          rowsAffected = 1;
        }
      } else if (deletion) {
        const before = tables.tasks.length;
        tables.tasks = tables.tasks.filter((item) => item.id !== bindValues[0]);
        rowsAffected = before - tables.tasks.length;
      } else throw new Error(`Operação SQL não suportada no preview: ${sql}`);
    }
    // Registro e saldo são publicados juntos, em uma única gravação. Falhas não publicam estado parcial.
    if (rowsAffected) this.storage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(tables));
    return { rowsAffected };
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const sql = query.trim().replace(/\s+/g, ' ').replace(/;$/, '');
    const selection = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+?))?(?: LIMIT (\d+|\?))?$/i.exec(sql);
    if (!selection) throw new Error(`Consulta SQL não suportada no preview: ${sql}`);
    const [, projection, tableName, condition, ordering, limit] = selection;
    const table = this.tableName(tableName);
    let rows = this.read()[table] as unknown as Row[];
    let bindIndex = 0;
    if (condition) {
      const filters = condition.split(/\s+AND\s+/i).map((part) => {
        const match = /^(\w+)\s*(=|LIKE)\s*\?$/i.exec(part);
        if (!match) throw new Error(`Filtro SQL não suportado no preview: ${part}`);
        const [, column, operator] = match;
        const value = bindValues[bindIndex++];
        if (operator.toUpperCase() === 'LIKE') {
          const pattern = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
          const regex = new RegExp(`^${pattern}$`, 'i');
          return (row: Row) => regex.test(String(row[column.toLowerCase()]));
        }
        return (row: Row) => row[column.toLowerCase()] === value;
      });
      rows = rows.filter((row) => filters.every((filter) => filter(row)));
    }
    if (ordering) {
      const order = ordering.split(',').map((part) => {
        const match = /^\s*(\w+)(?:\s+(ASC|DESC))?\s*$/i.exec(part);
        if (!match) throw new Error('Ordenação SQL não suportada no preview.');
        return { column: match[1].toLowerCase(), direction: match[2]?.toUpperCase() === 'DESC' ? -1 : 1 };
      });
      rows.sort((left, right) => {
        for (const { column, direction } of order) {
          const a = left[column] as string | number | null;
          const b = right[column] as string | number | null;
          const comparison = a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;
          if (comparison) return comparison * direction;
        }
        return 0;
      });
    }
    if (limit) rows = rows.slice(0, limit === '?' ? Number(bindValues[bindIndex]) : Number(limit));
    if (projection !== '*') {
      const columns = projection.split(',').map((column) => column.trim().toLowerCase());
      rows = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
    }
    return rows as T;
  }

  private tableName(name: string): keyof Tables {
    const table = name.toLowerCase() as keyof Tables;
    if (!TABLES.includes(table)) throw new Error(`Tabela SQL não suportada no preview: ${name}`);
    return table;
  }

  private validate(table: keyof Tables, row: Row, tables: Tables): void {
    const integer = (value: unknown, positive = false) => typeof value === 'number' && Number.isSafeInteger(value) && (!positive || value > 0);
    if (table === 'tasks' && (!['low', 'med', 'high'].includes(String(row.priority)) || ![0, 1].includes(Number(row.completed)))) {
      throw new Error('Prioridade ou conclusão de tarefa inválida.');
    }
    if (table === 'habits' && (!integer(row.streak_count) || Number(row.streak_count) < 0)) throw new Error('Sequência de hábito inválida.');
    if (table === 'pomodoro_sessions' && !integer(row.duration_minutes, true)) throw new Error('Duração de foco inválida.');
    if (table === 'accounts' && (!integer(row.balance_cents) || !['checking', 'wallet', 'savings'].includes(String(row.type)))) {
      throw new Error('Tipo de conta ou saldo inválido.');
    }
    if (table === 'budgets' && !integer(row.limit_cents, true)) throw new Error('O limite deve ser um número positivo em centavos.');
    if (table === 'transactions') {
      if (!integer(row.amount_cents, true) || !['income', 'expense'].includes(String(row.type))) throw new Error('Valor ou tipo de movimentação inválido.');
      const account = tables.accounts.find((item) => item.id === row.account_id);
      if (!account) throw new Error('A conta selecionada não existe.');
      if (!integer(account.balance_cents + (row.type === 'income' ? 1 : -1) * Number(row.amount_cents))) throw new Error('O saldo excede o limite de valores suportados.');
    }
  }
}
