import { create } from 'zustand';
import {
  fetchAccounts, fetchBudgets, fetchConsolidatedBalance, fetchTransactions,
  insertAccount, insertOrUpdateBudget, insertTransaction,
} from '../database/database';
import { localMonth } from '../database/date';
import type { Account, AccountType, Budget, ConsolidatedBalance, Transaction, TransactionType } from '../database/types';
import { publishStateEvent, registerStateHandler } from '../services/stateBridge';

interface FinanceStore {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  consolidated: ConsolidatedBalance;
  isLoading: boolean;
  hasLoadedData: boolean;
  error: string | null;
  clearError: () => void;
  isNewTransactionModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  loadFinancialData: () => Promise<void>;
  refreshData: () => Promise<void>;
  addAccount: (name: string, type: AccountType, initialBalanceCents?: number, color?: string) => Promise<void>;
  addTransaction: (params: {
    account_id: string; description: string; amount_cents: number; type: TransactionType; category: string;
    transaction_date?: string; installment_group_id?: string | null;
    installment_number?: number | null; installment_total?: number | null;
  }) => Promise<void>;
  setBudget: (category: string, limitCents: number, monthYear?: string) => Promise<void>;
}

export function formatCentsToBRL(cents: number): string {
  const reais = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}R$ ${reais}`;
}

let loaded = false;
let loadPromise: Promise<void> | null = null;

async function loadData(): Promise<void> {
  if (loadPromise) return loadPromise;
  useFinanceStore.setState({ isLoading: true });
  loadPromise = (async () => {
    try {
      const [accounts, transactions, budgets, consolidated] = await Promise.all([
        fetchAccounts(), fetchTransactions(), fetchBudgets(), fetchConsolidatedBalance(),
      ]);
      useFinanceStore.setState({ accounts, transactions, budgets, consolidated, isLoading: false, hasLoadedData: true, error: null });
      loaded = true;
    } catch (error) {
      useFinanceStore.setState({ isLoading: false, error: 'Não foi possível carregar suas finanças. Tente novamente.' });
      throw error;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function mutate(action: () => Promise<unknown>, message: string): Promise<void> {
  useFinanceStore.setState({ error: null });
  try {
    await action();
  } catch (error) {
    useFinanceStore.setState({ error: message });
    throw error;
  }
  try {
    // Reusing a read started before the write could restore an old balance.
    if (loadPromise) await loadPromise;
    await loadData();
  } catch {
    useFinanceStore.setState({ error: 'O registro foi salvo, mas não foi possível atualizar as finanças. Tente atualizar novamente.' });
  }
  await publishStateEvent('finance:changed');
}

export const useFinanceStore = create<FinanceStore>((set) => ({
  accounts: [], transactions: [], budgets: [],
  consolidated: { total_balance_cents: 0, monthly_income_cents: 0, monthly_expense_cents: 0, accounts_count: 0 },
  isLoading: false, hasLoadedData: false, isNewTransactionModalOpen: false, error: null,
  clearError: () => set({ error: null }),
  setModalOpen: (open) => set({ isNewTransactionModalOpen: open }),
  loadFinancialData: () => loaded ? Promise.resolve() : loadData(),
  refreshData: async () => {
    if (loadPromise) await loadPromise;
    await loadData();
  },
  addAccount: async (name, type, initialBalanceCents = 0, color = '#10b981') => {
    await mutate(() => insertAccount(name.trim(), type, initialBalanceCents, color),
      'Não foi possível salvar a conta. Confira os dados e tente novamente.');
  },
  addTransaction: async (params) => {
    await mutate(() => insertTransaction(params),
      'Não foi possível salvar a movimentação. Confira os dados e tente novamente.');
  },
  setBudget: async (category, limitCents, monthYear) => {
    await mutate(() => insertOrUpdateBudget(category, limitCents, monthYear ?? localMonth()),
      'Não foi possível salvar o limite. Confira os dados e tente novamente.');
  },
}));

registerStateHandler('finance:changed', () => {
  void useFinanceStore.getState().refreshData().catch(() => { /* The store exposes a readable error. */ });
});
