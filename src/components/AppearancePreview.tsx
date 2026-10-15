import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { ArrowDownUp, CalendarDays, ChevronDown, Focus, LayoutGrid, Maximize2, Minimize2, Music2, Palette, Pause, Play, RotateCcw, Sparkles, Volume2, Wallet } from 'lucide-react';
import { PedroMascot } from './PedroMascot';
import { RetainedTransition, usePageActive, useReducedMotion } from './ui/PageTransition';
import { CONTENT_ENTER, CONTENT_EXIT, SURFACE_CLOSE, SURFACE_OPEN } from '../lib/motionProfiles';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useFocusStore } from '../stores/useFocusStore';
import { formatCentsToBRL, useFinanceStore } from '../stores/useFinanceStore';
import { useMediaStore } from '../stores/useMediaStore';
import '../styles/appearance-preview.css';

type Preview = 'current' | 'focus' | 'music' | 'idle';
const previewModes = ['clock', 'minimal', 'focus', 'music', 'balance'] as const;
const localTime = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** A local presentation only: testing it never controls the desktop windows or an activity. */
export function AppearancePreview() {
  const p = usePreferencesStore();
  const focus = useFocusStore();
  const finance = useFinanceStore();
  const media = useMediaStore();
  const [preview, setPreview] = useState<Preview>('current');
  const [expanded, setExpanded] = useState(false);
  const [time, setTime] = useState(localTime);
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const [desktopWidth, setDesktopWidth] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== 'hidden');
  const desktop = useRef<HTMLDivElement>(null);
  const measured = useRef(false);
  const frameWidth = useMotionValue(96);
  const frameHeight = useMotionValue(24);
  const summaryHeight = useMotionValue(24);
  const detailsOpacity = useMotionValue(0);
  const detailsY = useMotionValue(5);
  const detailsId = useId();
  const helpId = useId();
  const pageActive = usePageActive();
  const reduced = useReducedMotion(p.reduceMotion);
  const immediate = reduced || !pageActive || !documentVisible;
  const hybrid = p.islandVisibility === 'hybrid';
  const active = focus.pomodoroState === 'focus' || focus.pomodoroState === 'break';
  const focusPresent = active || focus.pomodoroState === 'paused' || focus.sessionSaveState === 'saving' || focus.sessionSaveState === 'error';
  const session = media.displaySession;
  const currentMode = focusPresent ? 'focus' : session ? 'music' : focus.pomodoroState === 'completed' ? 'focus' : p.islandIdle;
  const mode = preview === 'current' ? currentMode : preview === 'idle' ? p.islandIdle : preview;
  const hasActivity = mode === 'focus' || mode === 'music' || mode === 'balance';
  const seconds = Math.max(0, Math.floor(focus.remainingSeconds));
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const selectedTask = focus.tasks.find(task => task.id === focus.selectedTaskId && task.completed === 0);
  const focusStatus = focus.sessionSaveState === 'error' ? 'Registro pendente' : focus.sessionSaveState === 'saving' ? 'Registrando sessão…'
    : focus.pomodoroState === 'paused' ? 'Sessão pausada' : focus.pomodoroState === 'completed' ? 'Sessão concluída'
      : active ? focus.currentMode === 'break' ? 'Pausa em andamento' : 'Foco em andamento' : 'Sua próxima sessão';
  const musicStatus = media.presentationPhase === 'updating' ? 'Atualizando faixa…' : media.presentationPhase === 'unavailable' ? 'Reprodução indisponível'
    : media.presentationPhase === 'loading' ? 'Buscando reprodução…' : session?.playbackStatus === 'playing' ? 'Em reprodução'
      : session?.playbackStatus === 'paused' ? 'Pausado' : session ? 'Sua música' : 'Aguardando reprodução';
  const emptyMusicTitle = media.presentationPhase === 'unavailable' ? 'Reprodução indisponível' : media.presentationPhase === 'loading' ? 'Buscando reprodução…' : 'Sua música, por perto';
  const progress = Math.max(0, Math.min(1, focus.totalDurationSeconds > 0 ? 1 - focus.remainingSeconds / focus.totalDurationSeconds : 0));
  const artwork = session?.artwork && session.artwork !== failedArtwork ? session.artwork : null;
  const balance = finance.accounts.length ? formatCentsToBRL(finance.consolidated.total_balance_cents) : 'Suas finanças';
  const width = desktopWidth || 300;
  const compactWidth = Math.min(hasActivity ? 280 : 96, Math.max(0, width - (hasActivity && p.topControlsEnabled ? 66 : 0)));
  const expandedWidth = width * (p.islandSize === 'small' ? .85 : p.islandSize === 'large' ? 1 : .93);
  const targetWidth = expanded ? expandedWidth : compactWidth;
  const targetHeight = expanded ? 166 : hasActivity ? 30 : 24;
  const targetSummaryHeight = expanded || hasActivity ? 30 : 24;

  useLayoutEffect(() => {
    const values = [frameWidth, frameHeight, summaryHeight, detailsOpacity, detailsY];
    const targets = [targetWidth, targetHeight, targetSummaryHeight, expanded ? 1 : 0, expanded || immediate ? 0 : 5];
    values.forEach(value => value.stop());
    if (immediate || !measured.current) values.forEach((value, index) => value.set(targets[index]));
    else {
      const surface = expanded ? SURFACE_OPEN : SURFACE_CLOSE;
      const content = expanded ? CONTENT_ENTER : CONTENT_EXIT;
      values.forEach((value, index) => { animate(value, targets[index], index < 3 ? surface : content); });
    }
    measured.current = desktopWidth > 0;
    // Stop without resetting values: rapid reversals continue from the frame on screen.
    return () => { values.forEach(value => value.stop()); };
  }, [targetWidth, targetHeight, targetSummaryHeight, expanded, immediate, desktopWidth, frameWidth, frameHeight, summaryHeight, detailsOpacity, detailsY]);

  useLayoutEffect(() => {
    const node = desktop.current;
    if (!node) return;
    const measure = () => {
      // A retained page reports zero when hidden; keep its last desktop frame.
      if (node.clientWidth > 0) setDesktopWidth(node.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setTime(localTime()), 10000);
    const visibility = () => { setDocumentVisible(document.visibilityState !== 'hidden'); setTime(localTime()); };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  return <aside className="settings-preview" aria-label="Prévia das preferências"><div className="panel"
    onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); } }}>
    <span className="eyebrow">Pedro, por perto</span><h2>Uma presença tranquila</h2>
    <div className="settings-preview-switch" role="group" aria-label="Conteúdo da prévia">{([
      { value: 'current', label: 'Agora' }, { value: 'focus', label: 'Foco' }, { value: 'music', label: 'Música' }, { value: 'idle', label: 'Repouso' },
    ] as const).map(option => <button type="button" key={option.value} aria-pressed={preview === option.value} onClick={() => setPreview(option.value)}>{option.label}</button>)}</div>
    <div ref={desktop} className="settings-preview-desktop settings-redesign-preview settings-interactive-preview" data-island-tone={p.islandTone}
      data-island-size={p.islandSize} data-top-controls={p.topControlsEnabled} data-expanded={expanded} data-reduced-motion={reduced}
      style={{ '--settings-preview-opacity': p.islandOpacity } as CSSProperties}>
      {p.topControlsEnabled && <div className="settings-preview-corners" aria-hidden="true"><span><Palette size={10} /><LayoutGrid size={10} /></span><span><Volume2 size={11} /></span></div>}
      <motion.div className="settings-preview-island settings-demo-island" aria-label="Prévia da ilha" style={{ width: frameWidth, height: frameHeight }}>
        <motion.div className="settings-demo-summary" style={{ height: summaryHeight }}>
          {mode !== 'music' && <PedroMascot className="settings-preview-monogram" />}
          <div className="settings-preview-context">{mode === 'music' ? <>
            <span className="settings-preview-artwork">{artwork ? <img src={artwork} alt="" onError={() => setFailedArtwork(artwork)} /> : <Music2 size={15} aria-hidden="true" />}</span>
            <span>{session?.title || (media.presentationPhase === 'loading' ? 'Buscando…' : media.presentationPhase === 'unavailable' ? 'Indisponível' : 'Sem reprodução')}</span>
            <span className={'presence-dot' + (media.presentationPhase === 'ready' && session?.playbackStatus === 'playing' ? ' is-active' : '')} />
          </> : mode === 'focus' ? <><span className={'presence-dot' + (active ? ' is-active' : '')} /><span>{focus.sessionSaveState === 'error' ? 'Registro pendente' : focus.sessionSaveState === 'saving' ? 'Registrando…' : focus.pomodoroState === 'completed' ? 'Concluído' : timer}</span></>
            : mode === 'balance' ? <><Wallet size={14} aria-hidden="true" /><span>{balance}</span></> : mode === 'minimal' ? null : <span>{time}</span>}</div>
          {mode !== 'music' && mode !== 'minimal' && <ChevronDown size={10} className="muted" aria-hidden="true" />}
        </motion.div>
        <motion.div id={detailsId} className="settings-demo-details" aria-hidden={!expanded || undefined} inert={!expanded || undefined}
          style={{ opacity: detailsOpacity, y: detailsY }}>
          <RetainedTransition value={mode} reduceMotion={immediate || !expanded} containerClassName="settings-demo-content"
            sectionClassName="settings-demo-page" slotAttribute="data-section" values={previewModes}>
            {context => <div className="settings-preview-activity">
              {context === 'focus' ? <><span className="settings-preview-caption">{focusStatus}</span><div className="settings-preview-focus"><strong>{timer}</strong><span className="settings-preview-play" aria-hidden="true">{active ? <Pause size={15} /> : <Play size={15} />}</span></div><p>{selectedTask?.title || (focus.currentMode === 'break' ? 'Respire. Você merece uma pausa.' : 'Escolha uma tarefa ou apenas comece.')}</p><div className="settings-preview-progress"><span style={{ transform: `scaleX(${progress})` }} /></div></>
                : context === 'music' ? <><span className="settings-preview-caption">{musicStatus}</span><div className="settings-preview-track"><span className="settings-preview-artwork is-large">{artwork ? <img src={artwork} alt="" onError={() => setFailedArtwork(artwork)} /> : <Music2 size={23} aria-hidden="true" />}</span><div><strong>{session?.title || emptyMusicTitle}</strong><p>{session?.artist || (session ? 'Artista não informado' : 'Dê play no navegador para ver sua faixa aqui.')}</p></div></div></>
                  : context === 'balance' ? <><span className="settings-preview-caption">Saldo consolidado</span><div className="settings-demo-balance"><Wallet size={21} aria-hidden="true" /><strong>{balance}</strong></div><p>Um olhar rápido para suas contas.</p></>
                    : <><span className="settings-preview-caption">Demonstração · em repouso</span><div className="settings-demo-idle"><PedroMascot /><div><strong>{context === 'clock' ? time : 'Seu dia, no seu ritmo'}</strong><p>Seus espaços ficam a um gesto de distância.</p></div></div><div className="settings-demo-spaces" aria-hidden="true"><span><CalendarDays size={12} />Hoje</span><span><Focus size={12} />Foco</span><span><Music2 size={12} />Música</span></div></>}
            </div>}
          </RetainedTransition>
        </motion.div>
      </motion.div>
      <span className="settings-demo-hint" aria-hidden="true"><ArrowDownUp size={12} />{expanded ? 'Expandida' : 'Compacta'}</span>
      {p.dockEnabled && <div className="settings-preview-dock" aria-label="Dock ativado" style={{ '--settings-preview-dock-opacity': p.dockOpacity } as CSSProperties}><Sparkles size={14} /><Focus size={14} /><Music2 size={14} /><Wallet size={14} /></div>}
    </div>
    <button className="button ghost settings-preview-test" type="button" aria-expanded={expanded} aria-controls={detailsId} aria-describedby={helpId}
      onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}{expanded ? 'Recolher prévia' : 'Testar abertura'}</button>
    <p id={helpId} className="settings-preview-test-help">Teste a transição aqui. Suas atividades continuam.</p>
    <div className="settings-preview-behavior"><span className="presence-dot" /><p>{hybrid ? `Híbrida · esconde após ${p.islandHideDelay} segundos sem interação` : 'Fixa · sempre visível no desktop'}</p></div>
    <p className="muted">Os dados vêm das suas atividades reais. A demonstração de repouso mostra como os espaços se organizam.</p>
    <button className="button ghost settings-reset" type="button" onClick={p.resetPreferences}><RotateCcw size={14} />Restaurar preferências</button>
  </div></aside>;
}
