import { useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Building2, Check, ChevronRight, Plus, Target, Wallet } from 'lucide-react';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import type { AccountType, TransactionType } from '../database/types';
import { Dialog } from './ui/Dialog';
import '../styles/finance.css';

const EXPENSE_CATEGORIES = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Investimento', 'Outros'];
const CATEGORIES = [...EXPENSE_CATEGORIES.slice(0, -1), 'Salário', 'Outros'];
const ACCOUNT_TYPES: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança ou reserva',
  wallet: 'Dinheiro em mãos',
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentDay() {
  const now = new Date();
  return `${currentMonth()}-${String(now.getDate()).padStart(2, '0')}`;
}

// Convert the decimal text directly to integer cents. Extra decimal digits use
// half-up rounding without multiplying binary floating-point currency values.
function parseMoney(value: string, allowNegative = false): number | null {
  let text = value.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  let sign = 1;
  if (text.startsWith('-')) {
    if (!allowNegative) return null;
    sign = -1;
    text = text.slice(1);
  }
  if (!text) return null;

  let whole: string;
  let fraction: string;
  if (text.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) return null;
    [whole, fraction] = text.split(',');
    whole = whole.replace(/\./g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    whole = text.replace(/\./g, '');
    fraction = '';
  } else {
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    [whole, fraction = ''] = text.split('.');
  }

  const units = Number(whole);
  const decimalCents = Number(fraction.padEnd(2, '0').slice(0, 2));
  const roundedCent = fraction.length > 2 && fraction[2] >= '5' ? 1 : 0;
  const cents = units * 100 + decimalCents + roundedCent;
  return Number.isSafeInteger(cents) ? cents * sign : null;
}

function readableDate(value: string) {
  const day = value.slice(0, 10);
  const [year, month, date] = day.split('-');
  return year && month && date ? `${date}/${month}/${year}` : value;
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Não foi possível salvar. Seus campos foram mantidos; tente novamente.';
}

export function FinanceModule() {
  const {
    accounts, transactions, budgets, consolidated, isLoading, error, clearError,
    addTransaction, addAccount, setBudget, isNewTransactionModalOpen, setModalOpen,
  } = useFinanceStore();
  const month = currentMonth();
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthlyBudgets = budgets.filter((budget) => budget.month_year === month);
  const monthTransactions = transactions.filter((transaction) => transaction.transaction_date.slice(0, 7) === month);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const history = [...transactions].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at));

  const [success, setSuccess] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [category, setCategory] = useState('Alimentação');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [transactionDate, setTransactionDate] = useState(currentDay);
  const [transactionError, setTransactionError] = useState('');
  const [transactionPending, setTransactionPending] = useState(false);
  const [isAccountOpen, setAccountOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('checking');
  const [accountBalance, setAccountBalance] = useState('0,00');
  const [accountError, setAccountError] = useState('');
  const [accountPending, setAccountPending] = useState(false);
  const [isBudgetOpen, setBudgetOpen] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState('Alimentação');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [budgetPending, setBudgetPending] = useState(false);
  const transactionErrorRef = useRef<HTMLParagraphElement>(null);
  const accountErrorRef = useRef<HTMLParagraphElement>(null);
  const budgetErrorRef = useRef<HTMLParagraphElement>(null);
  const pendingRef = useRef(false);

  const effectiveAccountId = accounts.some((account) => account.id === selectedAccountId) ? selectedAccountId : accounts[0]?.id ?? '';
  const hasDialog = isNewTransactionModalOpen || isAccountOpen || isBudgetOpen;

  const startTransaction = () => {
    clearError();
    setTransactionError('');
    setSuccess('');
    setModalOpen(true);
  };

  const startAccount = () => {
    clearError();
    setAccountError('');
    setSuccess('');
    setAccountOpen(true);
  };

  const startBudget = (existingCategory?: string, existingLimit?: number) => {
    clearError();
    setBudgetError('');
    setSuccess('');
    if (existingCategory) {
      setBudgetCategory(existingCategory);
      setBudgetAmount(existingLimit === undefined ? '' : `${Math.trunc(existingLimit / 100)},${String(existingLimit % 100).padStart(2, '0')}`);
    }
    setBudgetOpen(true);
  };

  function focusValidation(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const cents = parseMoney(amount);
    if (!description.trim()) {
      setTransactionError('Dê um nome à movimentação, como mercado ou salário.');
      focusValidation('finance-description');
      return;
    }
    if (cents === null || cents <= 0) {
      setTransactionError('Informe um valor maior que zero, como 125,50.');
      focusValidation('finance-amount');
      return;
    }
    if (!effectiveAccountId) {
      setTransactionError('Crie uma conta para registrar sua movimentação.');
      requestAnimationFrame(() => transactionErrorRef.current?.focus());
      return;
    }
    if (!validDay(transactionDate)) {
      setTransactionError('Escolha uma data válida para a movimentação.');
      focusValidation('finance-date');
      return;
    }
    pendingRef.current = true;
    setTransactionPending(true);
    setTransactionError('');
    clearError();
    try {
      await addTransaction({
        account_id: effectiveAccountId,
        description: description.trim(),
        amount_cents: cents,
        type,
        category,
        transaction_date: transactionDate,
        installment_group_id: null,
        installment_number: null,
        installment_total: null,
      });
      setDescription('');
      setAmount('');
      setTransactionDate(currentDay());
      setModalOpen(false);
      setSuccess('Movimentação registrada. O saldo e os orçamentos foram atualizados.');
    } catch (cause) {
      setTransactionError(errorMessage(cause));
      requestAnimationFrame(() => transactionErrorRef.current?.focus());
    } finally {
      pendingRef.current = false;
      setTransactionPending(false);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const cents = parseMoney(accountBalance || '0', true);
    if (!accountName.trim()) {
      setAccountError('Informe um nome para reconhecer esta conta.');
      focusValidation('finance-account-name');
      return;
    }
    if (cents === null) {
      setAccountError('Confira o saldo inicial. Use um valor como 1.250,00 ou 0,00.');
      focusValidation('finance-account-balance');
      return;
    }
    pendingRef.current = true;
    setAccountPending(true);
    setAccountError('');
    clearError();
    try {
      await addAccount(accountName.trim(), accountType, cents);
      setAccountName('');
      setAccountBalance('0,00');
      setAccountOpen(false);
      setSuccess('Conta criada. Agora você pode registrar entradas e saídas.');
    } catch (cause) {
      setAccountError(errorMessage(cause));
      requestAnimationFrame(() => accountErrorRef.current?.focus());
    } finally {
      pendingRef.current = false;
      setAccountPending(false);
    }
  }

  async function createBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const cents = parseMoney(budgetAmount);
    if (cents === null || cents <= 0) {
      setBudgetError('Defina um limite maior que zero, como 800,00.');
      focusValidation('finance-budget-amount');
      return;
    }
    pendingRef.current = true;
    setBudgetPending(true);
    setBudgetError('');
    clearError();
    try {
      await setBudget(budgetCategory, cents, month);
      setBudgetAmount('');
      setBudgetOpen(false);
      setSuccess(`Limite de ${budgetCategory.toLocaleLowerCase('pt-BR')} salvo para ${monthLabel}.`);
    } catch (cause) {
      setBudgetError(errorMessage(cause));
      requestAnimationFrame(() => budgetErrorRef.current?.focus());
    } finally {
      pendingRef.current = false;
      setBudgetPending(false);
    }
  }

  return (
    <section className="finance-module" aria-labelledby="finance-title" aria-busy={isLoading}>
      <header className="finance-heading">
        <div><p className="eyebrow">Seu dinheiro, com clareza</p><h1 id="finance-title">Finanças</h1><p className="muted">Veja suas contas, acompanhe os gastos e planeje o mês.</p></div>
        <button type="button" className="button primary" onClick={accounts.length ? startTransaction : startAccount} disabled={isLoading}>
          <Plus size={16} />{accounts.length ? 'Nova movimentação' : 'Criar primeira conta'}
        </button>
      </header>

      {success && <div className="notice success finance-feedback" role="status"><Check size={17} /><span>{success}</span><button type="button" className="button ghost" onClick={() => setSuccess('')}>Dispensar</button></div>}
      {error && !hasDialog && <div className="notice error" role="alert">{error}</div>}
      {isLoading && <p className="muted" role="status">Atualizando suas informações…</p>}

      <div className="finance-summary">
        <article className="panel finance-stat"><span className="finance-stat-label"><Wallet size={17} />Saldo disponível</span><strong>{formatCentsToBRL(consolidated.total_balance_cents)}</strong><span className="muted">{accounts.length === 1 ? 'Em 1 conta' : `Em ${accounts.length} contas`}</span></article>
        <article className="panel finance-stat"><span className="finance-stat-label"><ArrowDownLeft size={17} />Entradas do mês</span><strong className="finance-income">{formatCentsToBRL(consolidated.monthly_income_cents)}</strong><span className="muted finance-month">{monthLabel}</span></article>
        <article className="panel finance-stat"><span className="finance-stat-label"><ArrowUpRight size={17} />Saídas do mês</span><strong>{formatCentsToBRL(consolidated.monthly_expense_cents)}</strong><span className="muted finance-month">{monthLabel}</span></article>
      </div>

      {!accounts.length && !isLoading && <section className="panel finance-onboarding" aria-labelledby="finance-start-title">
        <div className="finance-onboarding-intro"><span className="finance-symbol"><Wallet size={22} /></span><div><h2 id="finance-start-title">Comece pelo que você tem hoje</h2><p className="muted">Você não precisa preencher tudo de uma vez. Uma conta e seu primeiro registro já são um bom começo.</p></div></div>
        <ol className="finance-steps"><li><span>1</span><div><strong>Adicione uma conta</strong><p className="muted">Um banco, uma reserva ou dinheiro em mãos.</p></div></li><li><span>2</span><div><strong>Registre uma movimentação</strong><p className="muted">Uma entrada ou um gasto que aconteceu.</p></div></li><li><span>3</span><div><strong>Defina um limite para o mês</strong><p className="muted">Escolha uma categoria para acompanhar.</p></div></li></ol>
      </section>}

      <div className="finance-workspace">
        <div className="finance-sidebar">
          <section className="panel finance-section" aria-labelledby="finance-accounts-title">
            <header className="finance-section-heading"><div><h2 id="finance-accounts-title"><Building2 size={18} />Contas</h2><p className="muted">Os saldos que compõem seu total.</p></div><button type="button" className="button secondary" onClick={startAccount} disabled={isLoading}><Plus size={15} />Adicionar</button></header>
            {accounts.length ? <ul className="finance-account-list">{accounts.map((account) => <li key={account.id}><span className="finance-account-mark" style={{ backgroundColor: /^#[0-9a-f]{3,8}$/i.test(account.color ?? '') ? account.color! : 'var(--accent)' }} /><div><strong>{account.name}</strong><span className="muted">{ACCOUNT_TYPES[account.type]}</span></div><strong className="finance-account-value">{formatCentsToBRL(account.balance_cents)}</strong></li>)}</ul> : <p className="finance-inline-empty muted">Adicione sua primeira conta para acompanhar o saldo.</p>}
          </section>

          <section className="panel finance-section" aria-labelledby="finance-budgets-title">
            <header className="finance-section-heading"><div><h2 id="finance-budgets-title"><Target size={18} />Limites do mês</h2><p className="muted finance-month">{monthLabel}</p></div><button type="button" className="button secondary" onClick={() => startBudget()} disabled={isLoading}><Plus size={15} />Definir</button></header>
            {monthlyBudgets.length ? <ul className="finance-budget-list">{monthlyBudgets.map((budget) => {
              const spent = monthTransactions.filter((transaction) => transaction.type === 'expense' && transaction.category === budget.category).reduce((sum, transaction) => sum + transaction.amount_cents, 0);
              const percent = budget.limit_cents > 0 ? Math.round(spent / budget.limit_cents * 100) : 0;
              const remaining = budget.limit_cents - spent;
              return <li key={budget.id} className={remaining < 0 ? 'finance-budget-over' : percent >= 80 ? 'finance-budget-near' : ''}>
                <div className="finance-budget-heading"><strong>{budget.category}</strong><button type="button" className="button ghost" onClick={() => startBudget(budget.category, budget.limit_cents)} aria-label={`Editar limite de ${budget.category}`} disabled={isLoading}>Editar</button></div>
                <p className="finance-budget-amount"><span>{formatCentsToBRL(spent)}</span><span className="muted">de {formatCentsToBRL(budget.limit_cents)}</span></p>
                <div className="finance-budget-track" role="progressbar" aria-label={`Gastos de ${budget.category}`} aria-valuenow={Math.min(100, percent)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${formatCentsToBRL(spent)} gastos de um limite de ${formatCentsToBRL(budget.limit_cents)}`}><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
                <p className="finance-budget-status">{remaining < 0 ? `${formatCentsToBRL(-remaining)} acima do limite` : remaining === 0 ? 'Você atingiu o limite deste mês.' : `${formatCentsToBRL(remaining)} disponíveis nesta categoria`}</p>
              </li>;
            })}</ul> : <div className="finance-inline-empty"><p>Um limite ajuda a perceber os gastos antes de passar do planejado.</p><p className="muted">Comece por alimentação, lazer ou outra categoria importante para você.</p></div>}
          </section>
        </div>

        <section className="panel finance-section finance-history" aria-labelledby="finance-history-title">
          <header className="finance-section-heading"><div><h2 id="finance-history-title">Movimentações</h2><p className="muted">Seu histórico, do registro mais recente ao mais antigo.</p></div><span className="badge">{transactions.length} {transactions.length === 1 ? 'registro' : 'registros'}</span></header>
          {history.length ? <ul className="finance-transaction-list">{history.map((transaction) => <li key={transaction.id}>
            <span className={`finance-transaction-icon ${transaction.type === 'income' ? 'is-income' : ''}`} aria-hidden="true">{transaction.type === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
            <div className="finance-transaction-details"><strong>{transaction.description}</strong><p className="muted">{transaction.category} <span aria-hidden="true">·</span> {accountNames.get(transaction.account_id) ?? 'Conta anterior'}</p><time dateTime={transaction.transaction_date.slice(0, 10)}>{readableDate(transaction.transaction_date)}{transaction.installment_total ? ` · Parcela ${transaction.installment_number ?? 1} de ${transaction.installment_total}` : ''}</time></div>
            <strong className={`finance-transaction-value ${transaction.type === 'income' ? 'finance-income' : ''}`}><span className="finance-sr-only">{transaction.type === 'income' ? 'Entrada: ' : 'Saída: '}</span>{transaction.type === 'income' ? '+' : '−'} {formatCentsToBRL(transaction.amount_cents)}</strong>
          </li>)}</ul> : <div className="empty-state finance-empty-history"><span className="finance-symbol"><ArrowDownLeft size={24} /></span><h3>Seu histórico começa aqui</h3><p className="muted">Registre o próximo gasto ou entrada. Assim, você acompanha o que mudou no saldo.</p><button type="button" className="button secondary" onClick={accounts.length ? startTransaction : startAccount} disabled={isLoading}>{accounts.length ? 'Registrar movimentação' : 'Criar uma conta'}<ChevronRight size={15} /></button></div>}
        </section>
      </div>

      <Dialog open={isNewTransactionModalOpen} title="Nova movimentação" description="Registre uma entrada ou uma saída que aconteceu em uma das suas contas." onClose={() => { if (!transactionPending) { setModalOpen(false); clearError(); } }}>
        <form className="finance-form" onSubmit={createTransaction} noValidate>
          <fieldset className="finance-type-picker" disabled={transactionPending}><legend className="label">Tipo de movimentação</legend><div>{(['expense', 'income'] as const).map((option) => <label key={option} className={type === option ? 'is-selected' : ''}><input type="radio" name="transaction-type" checked={type === option} onChange={() => setType(option)} />{option === 'expense' ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}{option === 'expense' ? 'Saída' : 'Entrada'}</label>)}</div></fieldset>
          <div><label className="label" htmlFor="finance-description">O que foi?</label><input id="finance-description" className="field" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mercado, salário, internet…" maxLength={160} disabled={transactionPending} required /></div>
          <div className="finance-form-row"><div><label className="label" htmlFor="finance-amount">Valor em reais</label><input id="finance-amount" className="field" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" maxLength={24} disabled={transactionPending} required /></div><div><label className="label" htmlFor="finance-date">Data</label><input id="finance-date" className="field" type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} disabled={transactionPending} required /></div></div>
          <div className="finance-form-row"><div><label className="label" htmlFor="finance-account">Conta</label><select id="finance-account" className="field" value={effectiveAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} disabled={transactionPending || !accounts.length} required>{!accounts.length && <option value="">Crie uma conta primeiro</option>}{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div><label className="label" htmlFor="finance-category">Categoria</label><select id="finance-category" className="field" value={category} onChange={(event) => setCategory(event.target.value)} disabled={transactionPending}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></div></div>
          {!accounts.length && <div className="notice"><p>Você precisa de uma conta para guardar esta movimentação.</p><button type="button" className="button secondary" onClick={() => { setModalOpen(false); startAccount(); }}>Criar conta</button></div>}
          {transactionError && <p ref={transactionErrorRef} className="notice error" role="alert" tabIndex={-1}>{transactionError}</p>}
          <div className="finance-form-actions"><button type="button" className="button secondary" onClick={() => { setModalOpen(false); clearError(); }} disabled={transactionPending}>Cancelar</button><button className="button primary" type="submit" disabled={transactionPending || !accounts.length}>{transactionPending ? 'Salvando…' : 'Salvar movimentação'}</button></div>
        </form>
      </Dialog>

      <Dialog open={isAccountOpen} title="Adicionar conta" description="Dê um nome à conta e informe o saldo de hoje. Não é necessário conectar seu banco." onClose={() => { if (!accountPending) { setAccountOpen(false); clearError(); } }}>
        <form className="finance-form" onSubmit={createAccount} noValidate>
          <div><label className="label" htmlFor="finance-account-name">Nome da conta</label><input id="finance-account-name" className="field" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Meu banco, reserva, carteira…" maxLength={80} disabled={accountPending} required /></div>
          <div><label className="label" htmlFor="finance-account-type">Tipo de conta</label><select id="finance-account-type" className="field" value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)} disabled={accountPending}>{Object.entries(ACCOUNT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label className="label" htmlFor="finance-account-balance">Saldo de hoje, em reais</label><input id="finance-account-balance" className="field" inputMode="decimal" value={accountBalance} onChange={(event) => setAccountBalance(event.target.value)} placeholder="0,00" maxLength={24} disabled={accountPending} aria-describedby="finance-balance-hint" /><p id="finance-balance-hint" className="muted finance-field-hint">Pode ser zero ou um valor negativo, se a conta estiver no vermelho.</p></div>
          {accountError && <p ref={accountErrorRef} className="notice error" role="alert" tabIndex={-1}>{accountError}</p>}
          <div className="finance-form-actions"><button type="button" className="button secondary" onClick={() => { setAccountOpen(false); clearError(); }} disabled={accountPending}>Cancelar</button><button type="submit" className="button primary" disabled={accountPending}>{accountPending ? 'Criando…' : 'Criar conta'}</button></div>
        </form>
      </Dialog>

      <Dialog open={isBudgetOpen} title="Definir limite mensal" description={`Escolha quanto pretende gastar nesta categoria em ${monthLabel}. Salvar novamente atualiza o limite existente.`} onClose={() => { if (!budgetPending) { setBudgetOpen(false); clearError(); } }}>
        <form className="finance-form" onSubmit={createBudget} noValidate>
          <div><label className="label" htmlFor="finance-budget-category">Categoria</label><select id="finance-budget-category" className="field" value={budgetCategory} onChange={(event) => setBudgetCategory(event.target.value)} disabled={budgetPending}>{(EXPENSE_CATEGORIES.includes(budgetCategory) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, budgetCategory]).map((item) => <option key={item}>{item}</option>)}</select></div>
          <div><label className="label" htmlFor="finance-budget-amount">Limite em reais</label><input id="finance-budget-amount" className="field" inputMode="decimal" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} placeholder="800,00" maxLength={24} disabled={budgetPending} required /><p className="muted finance-field-hint">Só as saídas desta categoria e deste mês entram no acompanhamento.</p></div>
          {budgetError && <p ref={budgetErrorRef} className="notice error" role="alert" tabIndex={-1}>{budgetError}</p>}
          <div className="finance-form-actions"><button type="button" className="button secondary" onClick={() => { setBudgetOpen(false); clearError(); }} disabled={budgetPending}>Cancelar</button><button type="submit" className="button primary" disabled={budgetPending}>{budgetPending ? 'Salvando…' : 'Salvar limite'}</button></div>
        </form>
      </Dialog>
    </section>
  );
}
