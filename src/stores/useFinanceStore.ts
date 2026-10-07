import { create } from 'zustand';
import {
  fetchAccounts,
  fetchBudgets,
  fetchConsolidatedBalance,
  fetchTransactions,
  insertAccount,
  insertOrUpdateBudget,
  insertTransaction,
} from '../database/database';
import type {
  Account,
  AccountType,
  Budget,
  ConsolidatedBalance,
  Transaction,
  TransactionType,
} from '../database/types';

interface FinanceStore {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  consolidated: ConsolidatedBalance;
  isLoading: boolean;
  isNewTransactionModalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadFinancialData: () => Promise<void>;
  addAccount: (name: string, type: AccountType, initialBalanceCents?: number, color?: string) => Promise<void>;
  addTransaction: (params: {
    account_id: string;
    description: string;
    amount_cents: number;
    type: TransactionType;
    category: string;
    transaction_date?: string;
    installment_group_id?: string | null;
    installment_number?: number | null;
    installment_total?: number | null;
  }) => Promise<void>;
  setBudget: (category: string, limitCents: number, monthYear?: string) => Promise<void>;
}

// Utilitário de formatação em Reais a partir de centavos inteiros
export function formatCentsToBRL(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const reais = (abs / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}R$ ${reais}`;
}

export const useFinanceStore = create<FinanceStore>((set, get) => ({
  accounts: [],
  transactions: [],
  budgets: [],
  consolidated: {
    total_balance_cents: 0,
    monthly_income_cents: 0,
    monthly_expense_cents: 0,
    accounts_count: 0,
  },
  isLoading: false,
  isNewTransactionModalOpen: false,

  setModalOpen: (open: boolean) => set({ isNewTransactionModalOpen: open }),

  loadFinancialData: async () => {
    set({ isLoading: true });
    try {
      const [accounts, transactions, budgets, consolidated] = await Promise.all([
        fetchAccounts(),
        fetchTransactions(),
        fetchBudgets(),
        fetchConsolidatedBalance(),
      ]);

      set({
        accounts,
        transactions,
        budgets,
        consolidated,
        isLoading: false,
      });
    } catch (error) {
      console.error('[FinanceStore] Erro ao carregar dados financeiros:', error);
      set({ isLoading: false });
    }
  },

  addAccount: async (name, type, initialBalanceCents = 0, color = '#10b981') => {
    try {
      await insertAccount(name, type, initialBalanceCents, color);
      await get().loadFinancialData();
    } catch (error) {
      console.error('[FinanceStore] Erro ao criar conta:', error);
    }
  },

  addTransaction: async (params) => {
    try {
      await insertTransaction(params);
      // Sincroniza estado da interface imediatamente com os dados persistidos no SQLite
      await get().loadFinancialData();
    } catch (error) {
      console.error('[FinanceStore] Erro ao registrar transação:', error);
    }
  },

  setBudget: async (category, limitCents, monthYear) => {
    const my = monthYear || new Date().toISOString().slice(0, 7);
    try {
      await insertOrUpdateBudget(category, limitCents, my);
      const budgets = await fetchBudgets(my);
      set({ budgets });
    } catch (error) {
      console.error('[FinanceStore] Erro ao definir orçamento:', error);
    }
  },
}));
