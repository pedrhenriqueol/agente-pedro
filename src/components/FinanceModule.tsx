import React, { useState } from 'react';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  CreditCard,
  PieChart,
  X,
  Building2,
  DollarSign,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import type { AccountType, TransactionType } from '../database/types';

export const FinanceModule: React.FC = () => {
  const {
    accounts,
    transactions,
    budgets,
    consolidated,
    addTransaction,
    addAccount,
    setBudget,
    isNewTransactionModalOpen,
    setModalOpen,
  } = useFinanceStore();

  // Estados do Modal de Nova Transação
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [category, setCategory] = useState('Alimentação');
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || 'acc-default');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentTotal, setInstallmentTotal] = useState(2);

  // Estados do Modal de Nova Conta
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<AccountType>('checking');
  const [newAccBalanceStr, setNewAccBalanceStr] = useState('0');

  // Estados do Modal de Novo Orçamento
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState('Alimentação');
  const [budgetLimitStr, setBudgetLimitStr] = useState('');

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAmount = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(cleanAmount) || cleanAmount <= 0) return;

    const amountCents = Math.round(cleanAmount * 100);
    const targetAccountId = selectedAccountId || accounts[0]?.id;

    if (!targetAccountId) {
      alert('Selecione ou crie uma conta primeiro.');
      return;
    }

    await addTransaction({
      account_id: targetAccountId,
      description: description.trim() || 'Transação sem descrição',
      amount_cents: amountCents,
      type,
      category,
      installment_group_id: isInstallment ? `inst-${Date.now()}` : null,
      installment_number: isInstallment ? 1 : null,
      installment_total: isInstallment ? installmentTotal : null,
    });

    setDescription('');
    setAmountStr('');
    setIsInstallment(false);
    setModalOpen(false);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const initialClean = parseFloat(newAccBalanceStr.replace(',', '.')) || 0;
    const initialCents = Math.round(initialClean * 100);

    await addAccount(newAccName.trim(), newAccType, initialCents);
    setNewAccName('');
    setNewAccBalanceStr('0');
    setIsAccountModalOpen(false);
  };

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitClean = parseFloat(budgetLimitStr.replace(',', '.'));
    if (isNaN(limitClean) || limitClean <= 0) return;

    await setBudget(budgetCategory, Math.round(limitClean * 100));
    setBudgetLimitStr('');
    setIsBudgetModalOpen(false);
  };

  return (
    <div className="flex flex-col space-y-6">
      {/* ── CARDS DE RESUMO CONSOLIDADO ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Saldo Total */}
        <div className="bg-industrial-surface border border-industrial-border rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-industrial-muted mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">
              Saldo Consolidado
            </span>
            <Wallet size={16} className="text-industrial-accent" />
          </div>
          <div className="text-2xl font-mono font-bold tracking-tight text-slate-100">
            {formatCentsToBRL(consolidated.total_balance_cents)}
          </div>
          <div className="text-[11px] font-mono text-industrial-subtle mt-2">
            {accounts.length} contas conectadas
          </div>
        </div>

        {/* Entradas do Mês */}
        <div className="bg-industrial-surface border border-industrial-border rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-industrial-muted mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">
              Receitas do Mês
            </span>
            <ArrowDownLeft size={16} className="text-industrial-accent" />
          </div>
          <div className="text-2xl font-mono font-bold tracking-tight text-industrial-accent">
            {formatCentsToBRL(consolidated.monthly_income_cents)}
          </div>
          <div className="text-[11px] font-mono text-industrial-subtle mt-2 flex items-center space-x-1">
            <TrendingUp size={12} className="text-industrial-accent" />
            <span>Mês vigente (AAAA-MM)</span>
          </div>
        </div>

        {/* Saídas do Mês */}
        <div className="bg-industrial-surface border border-industrial-border rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-industrial-muted mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">
              Despesas do Mês
            </span>
            <ArrowUpRight size={16} className="text-industrial-danger" />
          </div>
          <div className="text-2xl font-mono font-bold tracking-tight text-industrial-danger">
            {formatCentsToBRL(consolidated.monthly_expense_cents)}
          </div>
          <div className="text-[11px] font-mono text-industrial-subtle mt-2 flex items-center space-x-1">
            <TrendingDown size={12} className="text-industrial-danger" />
            <span>Controle transacional</span>
          </div>
        </div>
      </div>

      {/* ── LINHA PRINCIPAL: CONTAS & TRANSAÇÕES ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Coluna Esquerda: Contas e Orçamentos (5 colunas) */}
        <div className="lg:col-span-5 flex flex-col space-y-5">
          {/* Card Contas */}
          <div className="bg-industrial-surface border border-industrial-border rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <Building2 size={16} className="text-industrial-accent" />
                <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                  CONTAS & CARTEIRAS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(true)}
                className="px-2.5 py-1 rounded bg-industrial-card border border-industrial-border hover:bg-industrial-hover text-industrial-accent text-xs font-mono font-semibold flex items-center space-x-1 transition-all"
              >
                <Plus size={12} />
                <span>NOVA</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-industrial-card border border-industrial-border"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: acc.color || '#10b981' }}
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-100">{acc.name}</div>
                      <div className="text-[10px] font-mono uppercase text-industrial-subtle">
                        {acc.type === 'checking'
                          ? 'Corrente'
                          : acc.type === 'savings'
                          ? 'Poupança / Reserva'
                          : 'Carteira Física'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-100">
                    {formatCentsToBRL(acc.balance_cents)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card Orçamentos por Categoria */}
          <div className="bg-industrial-surface border border-industrial-border rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <PieChart size={16} className="text-industrial-warning" />
                <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                  ORÇAMENTOS DO MÊS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBudgetModalOpen(true)}
                className="px-2.5 py-1 rounded bg-industrial-card border border-industrial-border hover:bg-industrial-hover text-industrial-warning text-xs font-mono font-semibold flex items-center space-x-1 transition-all"
              >
                <Plus size={12} />
                <span>DEFINIR</span>
              </button>
            </div>

            <div className="space-y-3">
              {budgets.length === 0 ? (
                <div className="text-center py-6 text-xs font-mono text-industrial-subtle">
                  Nenhum orçamento definido para este mês.
                </div>
              ) : (
                budgets.map((b) => {
                  const spentCents = transactions
                    .filter((t) => t.category === b.category && t.type === 'expense')
                    .reduce((sum, t) => sum + t.amount_cents, 0);
                  const pct = Math.min(100, Math.round((spentCents / b.limit_cents) * 100));

                  return (
                    <div key={b.id} className="p-3 rounded-lg bg-industrial-card border border-industrial-border">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-semibold text-slate-200">{b.category}</span>
                        <span className="font-mono text-[11px] text-industrial-muted">
                          {formatCentsToBRL(spentCents)} / {formatCentsToBRL(b.limit_cents)}
                        </span>
                      </div>
                      <div className="w-full bg-industrial-surface h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            pct >= 100
                              ? 'bg-industrial-danger'
                              : pct >= 80
                              ? 'bg-industrial-warning'
                              : 'bg-industrial-accent'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Coluna Direita: Histórico de Transações (7 colunas) */}
        <div className="lg:col-span-7 bg-industrial-surface border border-industrial-border rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-industrial-border/60 pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <CreditCard size={16} className="text-industrial-accent" />
                <h3 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                  HISTÓRICO DE TRANSAÇÕES
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs font-mono flex items-center space-x-1.5 transition-all"
              >
                <Plus size={14} />
                <span>NOVA TRANSAÇÃO</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {transactions.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-industrial-border rounded-xl">
                  <p className="text-xs font-mono text-industrial-subtle mb-1">
                    Nenhuma movimentação registrada.
                  </p>
                  <p className="text-[11px] text-industrial-subtle/80">
                    Clique em "Nova Transação" para registrar receitas ou despesas.
                  </p>
                </div>
              ) : (
                transactions.map((t) => {
                  const isIncome = t.type === 'income';

                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-3.5 rounded-lg bg-industrial-card border border-industrial-border hover:border-industrial-subtle/60 transition-all"
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isIncome
                              ? 'bg-industrial-accent/15 text-industrial-accent'
                              : 'bg-industrial-danger/15 text-industrial-danger'
                          }`}
                        >
                          {isIncome ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-100">{t.description}</div>
                          <div className="flex items-center space-x-2 text-[10px] font-mono text-industrial-subtle mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-industrial-surface border border-industrial-border">
                              {t.category}
                            </span>
                            {t.installment_total && (
                              <span className="px-1.5 py-0.5 rounded bg-industrial-surface border border-industrial-border text-industrial-warning">
                                Parc. {t.installment_number || 1}/{t.installment_total}
                              </span>
                            )}
                            <span>{t.transaction_date}</span>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`text-xs font-mono font-bold ${
                          isIncome ? 'text-industrial-accent' : 'text-industrial-danger'
                        }`}
                      >
                        {isIncome ? '+' : '-'} {formatCentsToBRL(t.amount_cents)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 mt-4 border-t border-industrial-border/60 text-[11px] font-mono text-industrial-subtle">
            <span>{transactions.length} registros no SQLite</span>
            <span>Valores inteiros em centavos (ACID)</span>
          </div>
        </div>
      </div>

      {/* ── MODAL: NOVA TRANSAÇÃO ── */}
      {isNewTransactionModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-industrial-surface border border-industrial-border rounded-xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-4">
              <h3 className="font-mono text-sm font-bold text-slate-100 flex items-center space-x-2">
                <DollarSign size={16} className="text-industrial-accent" />
                <span>REGISTRAR TRANSAÇÃO</span>
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-industrial-muted hover:text-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-4">
              {/* Tipo: Despesa ou Receita */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={`py-2 text-xs font-mono font-semibold rounded-lg border transition-all ${
                    type === 'expense'
                      ? 'bg-industrial-danger/20 border-industrial-danger text-industrial-danger'
                      : 'bg-industrial-card border-industrial-border text-industrial-muted'
                  }`}
                >
                  DESPESA (-)
                </button>
                <button
                  type="button"
                  onClick={() => setType('income')}
                  className={`py-2 text-xs font-mono font-semibold rounded-lg border transition-all ${
                    type === 'income'
                      ? 'bg-industrial-accent/20 border-industrial-accent text-industrial-accent'
                      : 'bg-industrial-card border-industrial-border text-industrial-muted'
                  }`}
                >
                  RECEITA (+)
                </button>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Supermercado, Salário, Internet..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-industrial-accent"
                />
              </div>

              {/* Valor em Reais */}
              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Valor (R$)
                </label>
                <input
                  type="text"
                  required
                  placeholder="0,00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs font-mono font-semibold text-slate-100 focus:outline-none focus:border-industrial-accent"
                />
              </div>

              {/* Conta & Categoria */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                    Conta
                  </label>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full bg-industrial-card border border-industrial-border rounded-lg px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-industrial-accent"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                    Categoria
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-industrial-card border border-industrial-border rounded-lg px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-industrial-accent"
                  >
                    <option value="Alimentação">Alimentação</option>
                    <option value="Moradia">Moradia</option>
                    <option value="Transporte">Transporte</option>
                    <option value="Saúde">Saúde</option>
                    <option value="Lazer">Lazer</option>
                    <option value="Educação">Educação</option>
                    <option value="Salário">Salário</option>
                    <option value="Investimento">Investimento</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>
              </div>

              {/* Opção de Parcelamento */}
              <div className="pt-2 border-t border-industrial-border/60">
                <label className="flex items-center space-x-2 cursor-pointer text-xs font-mono text-slate-300">
                  <input
                    type="checkbox"
                    checked={isInstallment}
                    onChange={(e) => setIsInstallment(e.target.checked)}
                    className="rounded bg-industrial-card border-industrial-border text-industrial-accent focus:ring-0"
                  />
                  <span>Compra Parcelada (preparado para grupo de parcelas)</span>
                </label>

                {isInstallment && (
                  <div className="mt-2 flex items-center space-x-2">
                    <span className="text-[11px] font-mono text-industrial-subtle">
                      Número total de parcelas:
                    </span>
                    <input
                      type="number"
                      min={2}
                      max={72}
                      value={installmentTotal}
                      onChange={(e) => setInstallmentTotal(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-20 bg-industrial-card border border-industrial-border rounded px-2 py-1 text-xs font-mono text-slate-100"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-industrial-border/60">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-industrial-card border border-industrial-border text-industrial-muted hover:text-slate-100 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs font-mono"
                >
                  Salvar Transação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: NOVA CONTA ── */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-industrial-surface border border-industrial-border rounded-xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-4">
              <h3 className="font-mono text-sm font-bold text-slate-100">NOVA CONTA / CARTEIRA</h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="text-industrial-muted hover:text-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Nome da Conta
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank, Inter, Dinheiro vivo..."
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-industrial-accent"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">Tipo</label>
                <select
                  value={newAccType}
                  onChange={(e) => setNewAccType(e.target.value as AccountType)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-industrial-accent"
                >
                  <option value="checking">Conta Corrente</option>
                  <option value="savings">Poupança / Reserva</option>
                  <option value="wallet">Carteira Física</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Saldo Inicial (R$)
                </label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={newAccBalanceStr}
                  onChange={(e) => setNewAccBalanceStr(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-industrial-accent"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-industrial-border/60">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-industrial-card border border-industrial-border text-industrial-muted hover:text-slate-100 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-industrial-accent hover:bg-industrial-accentHover text-industrial-bg font-semibold text-xs font-mono"
                >
                  Criar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: DEFINIR ORÇAMENTO ── */}
      {isBudgetModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-industrial-surface border border-industrial-border rounded-xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-4">
              <h3 className="font-mono text-sm font-bold text-slate-100">DEFINIR ORÇAMENTO MENSAL</h3>
              <button
                type="button"
                onClick={() => setIsBudgetModalOpen(false)}
                className="text-industrial-muted hover:text-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateBudget} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Categoria
                </label>
                <select
                  value={budgetCategory}
                  onChange={(e) => setBudgetCategory(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-2.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-industrial-accent"
                >
                  <option value="Alimentação">Alimentação</option>
                  <option value="Moradia">Moradia</option>
                  <option value="Transporte">Transporte</option>
                  <option value="Saúde">Saúde</option>
                  <option value="Lazer">Lazer</option>
                  <option value="Educação">Educação</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-industrial-subtle mb-1">
                  Limite Mensal (R$)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 800,00"
                  value={budgetLimitStr}
                  onChange={(e) => setBudgetLimitStr(e.target.value)}
                  className="w-full bg-industrial-card border border-industrial-border rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-industrial-accent"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-industrial-border/60">
                <button
                  type="button"
                  onClick={() => setIsBudgetModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-industrial-card border border-industrial-border text-industrial-muted hover:text-slate-100 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-industrial-warning hover:opacity-90 text-industrial-bg font-semibold text-xs font-mono"
                >
                  Salvar Limite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
