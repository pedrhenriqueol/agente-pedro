import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, CircleCheck, Coffee, Pause, Play, RefreshCw, RotateCcw, Sparkles, Wallet } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { requestPage, syncIslandSize } from '../lib/desktop';
import '../styles/desktop.css';

function formatTimer(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function DynamicIsland() {
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  const [error, setError] = useState('');
  const requestedExpansion = useRef(false);
  const resizeSequence = useRef(0);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactExpander = useRef<HTMLButtonElement>(null);
  const expandedExpander = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const focus = useFocusStore();
  const { consolidated, accounts } = useFinanceStore();
  const { islandIdle, islandOpacity, reduceMotion } = usePreferencesStore();
  const active = focus.pomodoroState === 'focus' || focus.pomodoroState === 'break';
  const paused = focus.pomodoroState === 'paused';
  const saving = focus.sessionSaveState === 'saving';
  const saveFailed = focus.sessionSaveState === 'error';
  const recordPending = saving || saveFailed;
  const finished = focus.pomodoroState === 'completed';
  const selectedTask = focus.tasks.find((task) => task.id === focus.selectedTaskId && task.completed === 0);
  const pendingTasks = focus.tasks.filter((task) => task.completed === 0).length;
  const progress = focus.totalDurationSeconds > 0 ? 1 - focus.remainingSeconds / focus.totalDurationSeconds : 0;
  const modeName = focus.currentMode === 'focus' ? 'Foco' : 'Pausa';
  const status = saveFailed ? 'Sessão concluída · registro pendente' : saving ? 'Registrando sua sessão…' : finished ? 'Sessão concluída' : paused ? 'Sessão pausada' : active ? `${modeName} em andamento` : 'Um passo de cada vez';

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })), 10000);
    return () => {
      clearInterval(interval);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    if (expanded) expandedExpander.current?.focus({ preventScroll: true });
    else if (wasExpanded.current) compactExpander.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(''), 4500);
    return () => clearTimeout(timeout);
  }, [error]);

  async function toggleExpansion() {
    const next = !requestedExpansion.current;
    requestedExpansion.current = next;
    const sequence = ++resizeSequence.current;
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    setError('');
    if (next) {
      try {
        // Grow the native frame first so the entrance is never clipped by its old bounds.
        await syncIslandSize(true);
        if (sequence === resizeSequence.current) setExpanded(true);
      } catch {
        requestedExpansion.current = false;
        setError('Não foi possível expandir a ilha.');
      }
    } else {
      setExpanded(false);
      // Keep the larger native frame until the visual exit has finished.
      resizeTimer.current = setTimeout(() => {
        syncIslandSize(false).catch(() => setError('Não foi possível recolher a ilha.'));
      }, reduceMotion ? 0 : 300);
    }
  }

  async function openPage(page: 'home' | 'routine' | 'finance') {
    try { await requestPage(page); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o painel.'); }
  }

  function controlTimer() {
    if (saveFailed) { void focus.refreshData().catch(() => {}); }
    else if (active) focus.pausePomodoro();
    else if (paused) focus.resumePomodoro();
    else focus.startPomodoro(focus.currentMode);
  }

  const compactMode = active || paused || finished ? 'focus' : islandIdle;
  const styles = { '--widget-opacity': islandOpacity } as CSSProperties;

  return (
    <div className="desktop-widget-shell island-shell" style={styles} data-reduce-motion={reduceMotion}>
      <section className={`pedro-island ${expanded ? 'is-expanded' : ''}`} aria-label="Ilha do Pedro" onKeyDown={(event) => { if (expanded && event.key === 'Escape') { event.preventDefault(); void toggleExpansion(); } }}>
        <div className="island-compact" aria-hidden={expanded} inert={expanded || undefined}>
          <button className="island-identity" type="button" onClick={() => openPage('home')} aria-label="Abrir Hoje no painel do Pedro" title="Abrir o painel">
            <span className="pedro-widget-mark"><Sparkles size={16} aria-hidden="true" /></span>
            <span>{currentTime}</span>
          </button>
          <button className="island-context" type="button" onClick={toggleExpansion} aria-expanded={expanded} aria-controls="island-details" aria-label="Expandir ilha do Pedro">
            {compactMode === 'focus' ? <><span className={`island-status-dot ${active ? 'is-active' : ''}`} /><span>{saveFailed ? 'Registro pendente' : saving ? 'Registrando…' : finished ? 'Concluído' : formatTimer(focus.remainingSeconds)}</span><small>{paused ? 'Pausado' : modeName}</small></> : compactMode === 'balance' ? <><Wallet size={14} /><span>{accounts.length ? formatCentsToBRL(consolidated.total_balance_cents) : 'Suas finanças'}</span></> : compactMode === 'minimal' ? <span>Pedro</span> : <><span className="island-status-dot" /><span>Seu dia, com calma</span></>}
          </button>
          <button ref={compactExpander} className="widget-icon-button island-expander" type="button" onClick={toggleExpansion} aria-expanded={expanded} aria-controls="island-details" aria-label="Expandir ilha" title="Expandir ilha"><ChevronDown size={16} /></button>
        </div>

        <div id="island-details" className="island-details" aria-hidden={!expanded} inert={!expanded || undefined}>
          <header className="island-expanded-header">
            <div className="island-heading"><span className="pedro-widget-mark"><Sparkles size={16} aria-hidden="true" /></span><div><strong>Pedro</strong><span>{status}</span></div></div>
            <div className="island-header-actions"><button className="widget-icon-button" type="button" onClick={() => openPage('home')} title="Abrir painel" aria-label="Abrir painel"><ArrowUpRight size={17} /></button><button ref={expandedExpander} className="widget-icon-button" type="button" onClick={toggleExpansion} title="Recolher ilha" aria-label="Recolher ilha"><ChevronUp size={17} /></button></div>
          </header>

          <div className="island-focus-block">
            <div className="island-focus-top"><div className="island-mode-picker" aria-label="Tipo de sessão"><button type="button" className={focus.currentMode === 'focus' ? 'is-selected' : ''} onClick={() => focus.setPomodoroMode('focus')} disabled={active || paused || recordPending}>Foco</button><button type="button" className={focus.currentMode === 'break' ? 'is-selected' : ''} onClick={() => focus.setPomodoroMode('break')} disabled={active || paused || recordPending}><Coffee size={12} />Pausa</button></div><span className="island-clock">{currentTime}</span></div>
            <div className="island-timer-line"><div><span className="island-timer" role="timer" aria-label={`Tempo restante: ${formatTimer(focus.remainingSeconds)}`}>{formatTimer(focus.remainingSeconds)}</span><p className="island-task-name" title={selectedTask?.title}>{saveFailed ? 'Tente registrar novamente pelo botão ao lado.' : selectedTask?.title || (focus.currentMode === 'break' ? 'Respire. Você merece uma pausa.' : 'Escolha uma tarefa ou apenas comece.')}</p></div><div className="island-timer-actions"><button className="island-play-button" type="button" onClick={controlTimer} disabled={saving || (saveFailed && focus.isLoading)} aria-label={saveFailed ? 'Tentar registrar sessão novamente' : active ? 'Pausar sessão' : paused ? 'Continuar sessão' : 'Iniciar sessão'} title={saveFailed ? 'Tentar registrar novamente' : active ? 'Pausar' : paused ? 'Continuar' : 'Iniciar'}>{saveFailed ? <RefreshCw size={17} /> : active ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><button className="widget-icon-button" type="button" onClick={focus.resetPomodoro} disabled={recordPending} aria-label="Reiniciar sessão" title="Reiniciar"><RotateCcw size={15} /></button></div></div>
            <div className="island-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, progress)) * 100)}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} /></div>
          </div>

          <footer className="island-summary"><button type="button" onClick={() => openPage('routine')}><CircleCheck size={14} /><span>{pendingTasks ? `${pendingTasks} ${pendingTasks === 1 ? 'tarefa pendente' : 'tarefas pendentes'}` : 'Seu próximo passo'}</span><ArrowUpRight size={12} /></button><button type="button" onClick={() => openPage('finance')}><Wallet size={14} /><span>{accounts.length ? formatCentsToBRL(consolidated.total_balance_cents) : 'Finanças'}</span></button></footer>
        </div>
      </section>
      {error && <p className="widget-error" role="alert">{error}</p>}
    </div>
  );
}
