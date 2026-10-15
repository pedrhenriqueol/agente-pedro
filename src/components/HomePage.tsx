import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRight, Check, Circle, Flame, Wallet, Clock3, Plus, Sparkles } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import { localDate } from '../database/date';
import { FocusCard } from './RoutineModule';
import { ActionConfirmation } from './ui/ActionConfirmation';
import type { Page } from '../lib/desktop';

export function HomePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const focus = useFocusStore(useShallow(state => ({ tasks: state.tasks, habits: state.habits,
    sessions: state.sessions, error: state.error, pomodoroState: state.pomodoroState,
    toggleTask: state.toggleTask, completeHabit: state.completeHabit, selectTask: state.selectTask })));
  const finance = useFinanceStore();
  const [feedback, setFeedback] = useState('');
  const [feedbackEvent, setFeedbackEvent] = useState(0);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const order = { high: 0, med: 1, low: 2 };
  const pending = focus.tasks.filter(t => !t.completed).sort((a, b) => order[a.priority] - order[b.priority]);
  const doneToday = focus.habits.filter(h => h.last_completed === localDate()).length;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const sessionsToday = focus.sessions.filter(s => localDate(new Date(s.completed_at)) === localDate());
  const minutesToday = sessionsToday.reduce((sum, s) => sum + s.duration_minutes, 0);
  const run = async (action: () => Promise<void>, message: string) => {
    setFeedback('');
    try { await action(); setFeedback(message); setFeedbackEvent(current => current + 1); } catch { /* The store keeps the specific failure message. */ }
  };
  return <div className="home-page">
    <section className="home-welcome">
      <div><p className="eyebrow">{date}</p><h1>{greeting}, Pedro<span>.</span></h1>
        <p className="home-lead">{pending.length
          ? 'Vamos abrir espaço para o que importa. Suas prioridades e atividades estão aqui.'
          : 'Seu dia começa com um pequeno passo. Escolha uma prioridade ou reserve um momento de foco.'}</p>
        <button type="button" className="button primary" onClick={() => onNavigate('routine')}><Plus size={16} aria-hidden="true" />Planejar minha rotina</button>
      </div>
      <div className="day-summary" aria-label="Resumo do dia">
        <div><span className="day-summary-icon"><Clock3 size={19} /></span><strong>{minutesToday}<small> min</small></strong><span>de foco concluído hoje</span></div>
        <div><span className="day-summary-icon"><Flame size={19} /></span><strong>{doneToday}<small> / {focus.habits.length}</small></strong><span>hábitos registrados hoje</span></div>
      </div>
    </section>
    {(focus.error || finance.error) && <div role="alert" className="notice error">{focus.error || finance.error}</div>}
    {feedback && <p role="status" className="notice success"><ActionConfirmation eventId={feedbackEvent} />{feedback}</p>}
    <div className="home-grid">
      <div className="home-column">
      <section className="panel priorities-panel">
        <header className="panel-heading"><div><span className="eyebrow">Um passo de cada vez</span><h2>Suas prioridades</h2></div>
          <button className="button ghost" type="button" onClick={() => onNavigate('routine')}>Ver rotina<ArrowRight size={15} /></button></header>
        {pending.length ? <ul className="priority-list">{pending.slice(0, 4).map(task => <li key={task.id}>
          <button className="task-check" type="button" aria-label={'Concluir ' + task.title} onClick={() => void run(() => focus.toggleTask(task.id, task.completed), 'Tarefa concluída.')}><Circle size={19} aria-hidden="true" /></button>
          <div><span>{task.title}</span><small>{task.due_date ? 'Prazo: ' + new Date(task.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem prazo definido'}</small></div>
          <button className="button ghost small" type="button" disabled={focus.pomodoroState === 'focus' || focus.pomodoroState === 'break' || focus.pomodoroState === 'paused'}
            onClick={() => { focus.selectTask(task.id); onNavigate('routine'); }}>Focar<ArrowRight size={14} /></button>
        </li>)}</ul> : <div className="empty-state home-empty"><Sparkles size={26} aria-hidden="true" /><h3>O que merece sua atenção?</h3>
          <p>Adicione uma tarefa e escolha por onde começar. Ela pode acompanhar sua próxima sessão de foco.</p>
          <button type="button" className="button secondary" onClick={() => onNavigate('routine')}>Adicionar minha primeira tarefa</button></div>}
      </section>
      <section className="panel home-habits">
        <header className="panel-heading"><div><span className="eyebrow">Constância no seu ritmo</span><h2>Hábitos</h2></div><Flame size={19} className="muted" /></header>
        {focus.habits.length ? <ul className="home-habit-list">{focus.habits.slice(0, 4).map(h => <li key={h.id}>
          <span>{h.name}<small>{h.last_completed === localDate(now) || h.last_completed === localDate(yesterday)
            ? h.streak_count + (h.streak_count === 1 ? ' dia seguido' : ' dias seguidos') : 'Pronto para retomar'}</small></span>
          <button type="button" className={'button small ' + (h.last_completed === localDate() ? 'secondary' : 'ghost')} disabled={h.last_completed === localDate()}
            aria-label={'Registrar hoje: ' + h.name} onClick={() => void run(() => focus.completeHabit(h.id), 'Hábito registrado para hoje.')}>
            {h.last_completed === localDate() ? <><Check size={14} />Feito hoje</> : 'Registrar'}</button>
        </li>)}</ul> : <div className="empty-state"><p>Escolha uma pequena prática para repetir. Leitura, caminhada ou uma pausa podem ser um bom começo.</p>
          <button type="button" className="button ghost" onClick={() => onNavigate('routine')}>Criar um hábito<ArrowRight size={15} /></button></div>}
      </section>
      </div>
      <div className="home-column">
      <FocusCard compact />
      <section className="panel home-finance">
        <header className="panel-heading"><div><span className="eyebrow">Seu dinheiro, com clareza</span><h2>Visão financeira</h2></div><Wallet size={20} className="muted" /></header>
        <span className="muted">Saldo das contas</span><strong className="home-balance">{formatCentsToBRL(finance.consolidated.total_balance_cents)}</strong>
        <div className="home-finance-summary"><div><span>Entradas no mês</span><strong>{formatCentsToBRL(finance.consolidated.monthly_income_cents)}</strong></div>
          <div><span>Saídas no mês</span><strong>{formatCentsToBRL(finance.consolidated.monthly_expense_cents)}</strong></div></div>
        <button type="button" className="button secondary" onClick={() => onNavigate('finance')}>{finance.accounts.length ? 'Acompanhar finanças' : 'Cadastrar minha primeira conta'}<ArrowRight size={15} /></button>
      </section>
      </div>
    </div>
  </div>;
}
