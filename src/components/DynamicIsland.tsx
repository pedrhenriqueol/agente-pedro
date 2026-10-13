import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, CircleCheck, Coffee, Ellipsis, House, ListTodo, Music2, Palette, Pause, Play, RefreshCw, RotateCcw, Settings2, Sparkles, Timer, Wallet } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { requestPage, syncIslandSize, type DesktopPage } from '../lib/desktop';
import { MusicPlayer, MusicVolume } from './MusicPlayer';
import { useMediaStore } from '../stores/useMediaStore';
import { useIslandVisibilityStore } from '../stores/useIslandVisibilityStore';
import '../styles/desktop.css';

type IslandView = 'activity' | 'menu' | 'settings';
type IslandPhase = 'compact' | 'preparing' | 'expanding' | 'expanded' | 'switching' | 'collapsing';
type Activity = 'focus' | 'music';
const COMPACT_HEIGHT = 48;
const HEADER_HEIGHT = 58;
const FRAME_PADDING = 24;
const MAX_HEIGHT = 400;

function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** One persistent header anchors every state; only the layer below it changes. */
export function DynamicIsland() {
  const [phase, setPhase] = useState<IslandPhase>('compact');
  const [view, setView] = useState<IslandView>('activity');
  const [activity, setActivity] = useState<Activity>('focus');
  const [surfaceHeight, setSurfaceHeight] = useState(COMPACT_HEIGHT);
  const [bodyVisible, setBodyVisible] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [systemReduceMotion, setSystemReduceMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  const [error, setError] = useState('');
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const epoch = useRef(0);
  const layoutRevision = useRef(0);
  const resizingBlocked = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const requestedExpansion = useRef(false);
  const height = useRef(COMPACT_HEIGHT);
  const nativeHeight = useRef(COMPACT_HEIGHT);
  const resizeSequence = useRef(0);
  const confirmedResizeSequence = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const outgoing = useRef<HTMLDivElement>(null);
  const outgoingAnimation = useRef<Animation | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const expander = useRef<HTMLButtonElement>(null);
  const settingsFirst = useRef<HTMLButtonElement>(null);
  const menuItems = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreTrigger = useRef<'menu' | 'expand'>('expand');
  const focusActivityControl = useRef(false);
  const pendingTransition = useRef<{ epoch: number; view: IslandView; kind: 'open' | 'switch' } | null>(null);
  const focus = useFocusStore();
  const media = useMediaStore(state => state.displaySession);
  const presentation = useMediaStore(state => state.presentationPhase);
  const visibility = useIslandVisibilityStore(state => state.snapshot);
  const visibilityError = useIslandVisibilityStore(state => state.error);
  const notifyActivity = useIslandVisibilityStore(state => state.notifyActivity);
  const finance = useFinanceStore();
  const preferences = usePreferencesStore();
  const reduceMotion = preferences.reduceMotion || systemReduceMotion;
  const active = focus.pomodoroState === 'focus' || focus.pomodoroState === 'break';
  const paused = focus.pomodoroState === 'paused';
  const saving = focus.sessionSaveState === 'saving';
  const saveFailed = focus.sessionSaveState === 'error';
  const recordPending = saving || saveFailed;
  const finished = focus.pomodoroState === 'completed';
  const selectedTask = focus.tasks.find(task => task.id === focus.selectedTaskId && task.completed === 0);
  const pendingTasks = focus.tasks.filter(task => task.completed === 0).length;
  const progress = focus.totalDurationSeconds > 0 ? Math.max(0, Math.min(1, 1 - focus.remainingSeconds / focus.totalDurationSeconds)) : 0;
  const modeName = focus.currentMode === 'focus' ? 'Foco' : 'Pausa';
  const status = saveFailed ? 'Registro pendente' : saving ? 'Registrando sessão…' : finished ? 'Sessão concluída' : paused ? 'Sessão pausada' : active ? `${modeName} em andamento` : 'Um passo de cada vez';
  const defaultActivity: Activity = !active && !paused && !recordPending && media ? 'music' : 'focus';
  const identity = active || paused || recordPending ? 'focus' : media ? 'music' : finished ? 'focus' : preferences.islandIdle;
  const expandedGeometry = surfaceHeight > COMPACT_HEIGHT;
  const requested = phase !== 'compact' && phase !== 'collapsing';
  const failure = error || visibilityError || visibility.error;

  const clearOutgoing = useCallback(() => {
    outgoingAnimation.current?.cancel();
    outgoingAnimation.current = null;
    outgoing.current?.replaceChildren();
    if (outgoing.current) outgoing.current.hidden = true;
  }, []);
  const cancelWork = useCallback(() => {
    epoch.current += 1;
    layoutRevision.current += 1;
    resizingBlocked.current = false;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pendingTransition.current = null;
    clearOutgoing();
    return epoch.current;
  }, [clearOutgoing]);
  const schedule = useCallback((callback: () => void, delay: number, sequence: number) => {
    timers.current.push(setTimeout(() => { if (sequence === epoch.current) callback(); }, delay));
  }, []);
  const resizeSurface = useCallback((next: number) => { height.current = next; setSurfaceHeight(next); }, []);
  const resizeNative = useCallback(async (expanded: boolean, next = COMPACT_HEIGHT) => {
    const sequence = ++resizeSequence.current;
    await syncIslandSize(expanded, next + FRAME_PADDING);
    // A delayed reply must not replace the bounds of a newer successful resize.
    if (sequence > confirmedResizeSequence.current) {
      confirmedResizeSequence.current = sequence;
      nativeHeight.current = expanded ? next : COMPACT_HEIGHT;
    }
  }, []);
  const preserveNativeFrame = useCallback(() => {
    cancelWork();
    if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
    resizingBlocked.current = true;
    const expanded = nativeHeight.current > COMPACT_HEIGHT;
    requestedExpansion.current = expanded;
    resizeSurface(nativeHeight.current);
    setBodyVisible(expanded);
    setPhase(expanded ? 'expanded' : 'compact');
    setError('Não foi possível ajustar a ilha. Tente recolher novamente.');
  }, [cancelWork, resizeSurface]);
  const measure = useCallback(() => Math.min(MAX_HEIGHT, Math.max(HEADER_HEIGHT, Math.ceil((content.current?.scrollHeight || 0) + HEADER_HEIGHT + 16))), []);

  // Freeze only pixels from the outgoing body. It has no React handlers, IDs or
  // accessible controls; stores and the persistent header remain single owners.
  function capturePresentation() {
    if (reduceMotion) return null;
    const fragment = document.createDocumentFragment();
    const copy = (source: HTMLElement, opacity: string, transform: string, top = 0) => {
      if (Number(opacity) < .01) return;
      const clone = source.cloneNode(true) as HTMLElement;
      const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
      const clones = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
      clones.forEach(node => { node.removeAttribute('id'); node.removeAttribute('for'); node.removeAttribute('aria-controls'); });
      for (const animation of source.getAnimations({ subtree: true })) {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        const index = originals.indexOf(target as HTMLElement);
        if (index < 0) continue;
        const style = getComputedStyle(originals[index]);
        clones[index].style.animation = 'none';
        clones[index].style.opacity = style.opacity;
        clones[index].style.transform = style.transform;
      }
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', left: '0', top: `${top}px`, width: `${source.offsetWidth}px`, opacity, transform });
      layer.append(clone); fragment.append(layer);
    };
    if (outgoing.current && !outgoing.current.hidden) {
      const style = getComputedStyle(outgoing.current);
      const previous = document.createElement('div');
      previous.style.position = 'relative';
      previous.style.width = `${content.current?.offsetWidth || 350}px`;
      previous.append(...[...outgoing.current.childNodes].map(node => node.cloneNode(true)));
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', inset: '0', opacity: style.opacity, transform: style.transform });
      layer.append(previous); fragment.append(layer);
    }
    if (body.current && content.current) {
      const style = getComputedStyle(body.current);
      copy(content.current, style.opacity, style.transform, -body.current.scrollTop);
    }
    return fragment.childNodes.length ? fragment : null;
  }

  function installPresentation(fragment: DocumentFragment | null) {
    if (!outgoing.current || !fragment) return;
    outgoing.current.replaceChildren(fragment);
    outgoing.current.hidden = false;
    outgoing.current.style.opacity = '1';
    outgoing.current.style.transform = 'none';
  }

  const fadeOutgoing = useCallback((duration: number, sequence: number) => {
    const node = outgoing.current;
    if (!node || node.hidden) return;
    const animation = node.animate([{ opacity: getComputedStyle(node).opacity, transform: 'translateY(0px)' },
      { opacity: '0', transform: 'translateY(-3px)' }], { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    outgoingAnimation.current = animation;
    void animation.finished.then(() => { if (sequence === epoch.current) clearOutgoing(); }).catch(() => {});
  }, [clearOutgoing]);

  function prepareBody() {
    if (!body.current) return;
    body.current.style.transition = 'none';
    body.current.style.opacity = '0';
    body.current.style.transform = 'translateY(4px) scale(.995)';
  }

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setSystemReduceMotion(motion.matches);
    motion.addEventListener('change', changed);
    const clock = setInterval(() => setCurrentTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })), 10000);
    return () => { motion.removeEventListener('change', changed); clearInterval(clock); cancelWork(); };
  }, [cancelWork]);

  useEffect(() => {
    if (visibility.visible) return;
    cancelWork();
    requestedExpansion.current = false;
    setBodyVisible(false);
    resizeSurface(COMPACT_HEIGHT);
    setPhase('compact');
    // The native worker owns visibility; a late size reply must never reveal it.
    void resizeNative(false).catch(() => {});
  }, [visibility.visible, cancelWork, resizeSurface, resizeNative]);

  function beginOpen(nextView: IslandView, nextActivity = defaultActivity) {
    if (!visibility.visible) return;
    notifyActivity();
    const presentation = capturePresentation();
    const sequence = cancelWork();
    installPresentation(presentation);
    prepareBody();
    requestedExpansion.current = true;
    setError('');
    setMenuIndex(0);
    focusActivityControl.current = false;
    setBodyVisible(false);
    pendingTransition.current = { epoch: sequence, view: nextView, kind: 'open' };
    setActivity(nextActivity);
    setView(nextView);
    setPhase('preparing');
  }

  function switchView(nextView: IslandView, nextActivity = activity) {
    if (!requestedExpansion.current || height.current === COMPACT_HEIGHT) { beginOpen(nextView, nextActivity); return; }
    const presentation = capturePresentation();
    const sequence = cancelWork();
    installPresentation(presentation);
    prepareBody();
    notifyActivity();
    focusActivityControl.current = nextView === 'activity';
    setBodyVisible(false);
    pendingTransition.current = { epoch: sequence, view: nextView, kind: 'switch' };
    setActivity(nextActivity);
    setView(nextView);
    setPhase('preparing');
  }

  function closeIsland(restore = false) {
    const presentation = capturePresentation();
    const sequence = cancelWork();
    installPresentation(presentation);
    fadeOutgoing(reduceMotion ? 0 : 80, sequence);
    const openHeight = height.current;
    requestedExpansion.current = false;
    setBodyVisible(false);
    setPhase('collapsing');
    if (restore && visibility.visible) (restoreTrigger.current === 'menu' ? menuTrigger : expander).current?.focus({ preventScroll: true });
    schedule(() => resizeSurface(COMPACT_HEIGHT), reduceMotion || openHeight === COMPACT_HEIGHT ? 0 : 90, sequence);
    schedule(() => {
      void resizeNative(false).then(() => {
        if (sequence === epoch.current) setPhase('compact');
      }).catch(() => {
        if (sequence !== epoch.current || !visibility.visible) return;
        // Keep the still-large native frame occupied by a usable, retryable UI.
        requestedExpansion.current = true;
        resizingBlocked.current = true;
        if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
        resizeSurface(nativeHeight.current);
        setBodyVisible(true);
        setPhase('expanded');
        setError('Não foi possível recolher a ilha. Tente novamente.');
      });
    }, reduceMotion || openHeight === COMPACT_HEIGHT ? 0 : 270, sequence);
  }

  function toggleExpansion() {
    restoreTrigger.current = 'expand';
    if (requestedExpansion.current) closeIsland(); else beginOpen('activity');
  }

  function openMenu() {
    restoreTrigger.current = 'menu';
    setMenuIndex(0);
    if (requestedExpansion.current && view === 'menu') closeIsland(true);
    else if (requestedExpansion.current) switchView('menu');
    else beginOpen('menu');
  }

  useLayoutEffect(() => {
    const transition = pendingTransition.current;
    if (phase !== 'preparing' || !transition || transition.view !== view) return;
    pendingTransition.current = null;
    const sequence = transition.epoch;
    const layout = ++layoutRevision.current;
    let nextHeight = measure();
    let preparedHeight = nativeHeight.current;
    void (async () => {
      try {
        // The body is already measurable but inert; enlarge the OS frame first.
        if (nextHeight > nativeHeight.current) {
          await resizeNative(true, nextHeight);
          preparedHeight = nextHeight;
        }
        if (sequence !== epoch.current || layout !== layoutRevision.current || !requestedExpansion.current) {
          if (!requestedExpansion.current) void resizeNative(false).catch(() => {});
          return;
        }
        // Metadata/errors may change while IPC is pending. Use their current
        // geometry rather than clipping the new content into the first sample.
        const currentHeight = measure();
        if (currentHeight > nativeHeight.current) {
          await resizeNative(true, currentHeight);
          preparedHeight = currentHeight;
        }
        if (sequence !== epoch.current || layout !== layoutRevision.current || !requestedExpansion.current) {
          if (!requestedExpansion.current) void resizeNative(false).catch(() => {});
          return;
        }
        nextHeight = currentHeight;
        resizeSurface(nextHeight);
        setPhase(transition.kind === 'open' ? 'expanding' : 'switching');
        const enter = () => {
          if (body.current) {
            void body.current.offsetHeight;
            body.current.style.transition = '';
            body.current.style.opacity = '';
            body.current.style.transform = '';
          }
          setBodyVisible(true);
          fadeOutgoing(reduceMotion ? 0 : 110, sequence);
        };
        if (reduceMotion) enter();
        else schedule(enter, transition.kind === 'open' ? 50 : 10, sequence);
        schedule(() => {
          setPhase('expanded');
          if (layout === layoutRevision.current && requestedExpansion.current && height.current === nextHeight) {
            void resizeNative(true, nextHeight).catch(() => {
              if (sequence === epoch.current && layout === layoutRevision.current && requestedExpansion.current) preserveNativeFrame();
            });
          }
        }, reduceMotion ? 0 : transition.kind === 'open' ? 250 : 220, sequence);
      } catch {
        if (sequence !== epoch.current) return;
        requestedExpansion.current = false;
        setError('Não foi possível expandir. Abra o menu para tentar novamente.');
        clearOutgoing();
        if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
        // A failed larger view may leave the previous native frame expanded.
        // Keep that frame occupied until a compact resize actually succeeds.
        if (preparedHeight > COMPACT_HEIGHT) {
          resizeSurface(preparedHeight);
          setBodyVisible(true);
          setPhase('collapsing');
        }
        try {
          await resizeNative(false);
          if (sequence !== epoch.current) return;
          resizeSurface(COMPACT_HEIGHT);
          setBodyVisible(false);
          setPhase('compact');
        } catch {
          if (sequence !== epoch.current) return;
          if (preparedHeight > COMPACT_HEIGHT) {
            requestedExpansion.current = true;
            resizingBlocked.current = true;
            resizeSurface(preparedHeight);
            setBodyVisible(true);
            setPhase('expanded');
            setError('Não foi possível ajustar a ilha. Tente recolher novamente.');
          } else {
            resizeSurface(COMPACT_HEIGHT);
            setBodyVisible(false);
            setPhase('compact');
          }
        }
      }
    })();
  }, [phase, view, activity, reduceMotion, measure, resizeSurface, resizeNative, preserveNativeFrame, schedule, fadeOutgoing, clearOutgoing]);

  useLayoutEffect(() => {
    if (phase !== 'expanded' || !content.current) return;
    let disposed = false;
    const observer = new ResizeObserver(() => {
      const next = measure();
      if (resizingBlocked.current || !requestedExpansion.current || !visibility.visible || Math.abs(next - height.current) < 2) return;
      const sequence = epoch.current;
      const layout = ++layoutRevision.current;
      const growing = next > nativeHeight.current;
      void (async () => {
        try {
          if (growing) await resizeNative(true, next);
          if (disposed || sequence !== epoch.current || layout !== layoutRevision.current || !requestedExpansion.current) return;
          resizeSurface(next);
          if (!growing) schedule(() => {
            if (layout !== layoutRevision.current || !requestedExpansion.current || height.current !== next) return;
            void resizeNative(true, next).catch(() => {
              if (sequence === epoch.current && layout === layoutRevision.current && requestedExpansion.current) preserveNativeFrame();
            });
          }, reduceMotion ? 0 : 240, sequence);
        } catch { if (!disposed && sequence === epoch.current && layout === layoutRevision.current) preserveNativeFrame(); }
      })();
    });
    observer.observe(content.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [phase, visibility.visible, reduceMotion, measure, resizeSurface, resizeNative, preserveNativeFrame, schedule]);

  useEffect(() => {
    if (!bodyVisible || !visibility.visible) return;
    if (view === 'menu') menuItems.current[menuIndex]?.focus();
    else if (view === 'settings') settingsFirst.current?.focus();
    else if (focusActivityControl.current) {
      focusActivityControl.current = false;
      (body.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') || expander.current)?.focus();
    }
  }, [bodyVisible, view, visibility.visible]);

  async function openPage(page: DesktopPage) {
    try { await requestPage(page); setError(''); closeIsland(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o painel.'); }
  }

  function controlTimer() {
    if (saveFailed) void focus.refreshData().catch(() => {});
    else if (active) focus.pausePomodoro();
    else if (paused) focus.resumePomodoro();
    else focus.startPomodoro(focus.currentMode);
  }

  const menu = [
    { label: 'Hoje', icon: House, run: () => { void openPage('home'); } },
    { label: 'Rotinas e foco', icon: ListTodo, run: () => { void openPage('routine'); } },
    { label: 'Música', icon: Music2, run: () => { void openPage('music'); } },
    { label: 'Finanças', icon: Wallet, run: () => { void openPage('finance'); } },
    { label: 'Aparência', icon: Palette, run: () => { void openPage('appearance'); } },
    { label: activity === 'music' ? 'Controles de música' : 'Controles de foco', icon: activity === 'music' ? Music2 : Timer, run: () => switchView('activity') },
    { label: 'Ajustes rápidos', icon: Settings2, run: () => switchView('settings') },
  ];

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    let next = menuIndex;
    if (event.key === 'ArrowDown') next = (menuIndex + 1) % menu.length;
    else if (event.key === 'ArrowUp') next = (menuIndex - 1 + menu.length) % menu.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = menu.length - 1;
    else return;
    event.preventDefault();
    setMenuIndex(next);
    menuItems.current[next]?.focus();
  }

  const title = identity === 'music' ? media?.title || 'Sua música'
    : identity === 'focus' ? selectedTask?.title || (finished || recordPending ? 'Sessão concluída' : modeName)
    : identity === 'balance' ? finance.accounts.length ? formatCentsToBRL(finance.consolidated.total_balance_cents) : 'Suas finanças'
    : identity === 'minimal' ? 'Pedro' : currentTime;
  const subtitle = identity === 'music' ? media?.artist || 'Sua trilha do dia'
    : identity === 'focus' ? `${formatTimer(focus.remainingSeconds)} · ${status}`
    : identity === 'balance' ? 'Seu dinheiro, com clareza' : identity === 'minimal' ? 'Seu dia, por perto' : 'Pedro · um passo de cada vez';
  const styles = { '--widget-opacity': preferences.islandOpacity, '--island-height': `${surfaceHeight}px` } as CSSProperties;

  return <div className="desktop-widget-shell island-shell" style={styles} data-reduce-motion={reduceMotion}
    data-island-visible={visibility.visible} aria-hidden={!visibility.visible} inert={!visibility.visible || undefined}
    onFocusCapture={notifyActivity} onKeyDownCapture={notifyActivity} onPointerDownCapture={notifyActivity} onPointerMoveCapture={notifyActivity}>
    <section className={`pedro-island${expandedGeometry ? ' is-expanded' : ''}`} data-phase={phase} data-view={view} aria-label="Ilha do Pedro"
      onContextMenu={event => { event.preventDefault(); openMenu(); }}
      onKeyDown={event => {
        if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); openMenu(); }
        if (event.key === 'Escape' && requestedExpansion.current) {
          event.preventDefault();
          if (view === 'settings') switchView('menu'); else closeIsland(true);
        }
      }}>
      <header className="island-header">
        <button className="island-context" type="button" onClick={toggleExpansion} aria-expanded={requested} aria-controls="island-details" aria-label={`${requested ? 'Recolher' : 'Expandir'} atividade: ${title}`} title={title}>
          <span className={`island-identity-mark${identity === 'music' ? ' is-music' : ''}`} aria-hidden="true">
            {identity === 'music' && media?.artwork && failedArtwork !== media.artwork ? <img src={media.artwork} alt="" onError={() => setFailedArtwork(media.artwork)} />
              : identity === 'music' ? <Music2 size={17} /> : identity === 'focus' ? <Timer size={17} /> : identity === 'balance' ? <Wallet size={17} /> : <Sparkles size={17} />}
          </span>
          <span className="island-identity-text"><strong title={title}>{title}</strong><span title={subtitle}>{subtitle}</span></span>
          {(active || identity === 'music') && <span className={`island-status-dot${active || presentation === 'ready' && media?.playbackStatus === 'playing' ? ' is-active' : ''}${presentation === 'updating' && identity === 'music' ? ' is-updating' : ''}`} aria-label={identity === 'music' ? presentation === 'updating' ? 'Atualizando faixa' : media?.playbackStatus === 'playing' ? 'Em reprodução' : 'Reprodução pausada' : status} />}
        </button>
        <div className="island-header-actions">
          <button ref={menuTrigger} className={`widget-icon-button island-menu-trigger${failure ? ' has-error' : ''}`} type="button" onClick={openMenu} aria-label="Abrir menu do Pedro" title={failure || 'Menu do Pedro'} aria-haspopup="menu" aria-expanded={requested && view === 'menu'} aria-controls="island-menu"><Ellipsis size={18} /></button>
          <button ref={expander} className="widget-icon-button island-expander" type="button" onClick={toggleExpansion} aria-expanded={requested} aria-controls="island-details" aria-label={requested ? 'Recolher ilha' : 'Expandir ilha'} title={requested ? 'Recolher ilha' : 'Expandir ilha'}><ChevronDown size={16} /></button>
        </div>
      </header>

      <div id="island-details" ref={body} className={`island-details${bodyVisible ? ' is-visible' : ''}`} aria-hidden={!bodyVisible} inert={!bodyVisible || undefined}>
        <div className="island-details-content" ref={content}>
        {view === 'menu' ? <div id="island-menu" role="menu" aria-label="Menu do Pedro" className="island-menu" onKeyDown={menuKeys}>
          {menu.map((item, index) => <button key={item.label} ref={element => { menuItems.current[index] = element; }} type="button" role="menuitem" tabIndex={menuIndex === index ? 0 : -1} onFocus={() => setMenuIndex(index)} onClick={item.run} className={`island-menu-item${index === 5 ? ' is-separated' : ''}`}><item.icon size={15} aria-hidden="true" /><span>{item.label}</span>{index < 5 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button>)}
        </div> : view === 'settings' ? <div className="island-quick-settings" role="group" aria-label="Ajustes rápidos">
          <div className="island-layer-heading"><button className="widget-icon-button" type="button" onClick={() => switchView('menu')} aria-label="Voltar ao menu"><ArrowLeft size={14} /></button><strong>Ajustes rápidos</strong></div>
          <fieldset className="island-preference"><legend>Tema</legend><div className="island-segments">{([{ value: 'system', label: 'Sistema' }, { value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }] as const).map((item, index) => <button ref={index === 0 ? settingsFirst : undefined} key={item.value} type="button" aria-pressed={preferences.theme === item.value} onClick={() => preferences.updatePreferences({ theme: item.value })}>{item.label}</button>)}</div></fieldset>
          <fieldset className="island-preference"><legend>Presença da ilha</legend><div className="island-segments">{([{ value: 'fixed', label: 'Fixa' }, { value: 'hybrid', label: 'Híbrida' }] as const).map(item => <button key={item.value} type="button" aria-pressed={preferences.islandVisibility === item.value} onClick={() => preferences.updatePreferences({ islandVisibility: item.value })}>{item.label}</button>)}</div><p>{preferences.islandVisibility === 'hybrid' ? `Oculta após ${preferences.islandHideDelay} segundos ou em tela cheia.` : 'Permanece disponível no topo da tela.'}</p></fieldset>
          <label className="island-preference-toggle"><span>Barra de atalhos no desktop</span><input type="checkbox" checked={preferences.dockEnabled} onChange={event => preferences.updatePreferences({ dockEnabled: event.target.checked })} /></label>
          <MusicVolume />
          <button className="island-settings-link" type="button" onClick={() => openPage('appearance')}>Todas as opções de aparência<ArrowUpRight size={12} /></button>
        </div> : <>
          {activity === 'music' ? <div className="island-music-body"><MusicPlayer compact showIdentity={false} showVolume={false} /></div> : <div className="island-focus-block">
            <div className="island-focus-top"><div className="island-mode-picker" role="group" aria-label="Tipo de sessão"><button type="button" aria-pressed={focus.currentMode === 'focus'} onClick={() => focus.setPomodoroMode('focus')} disabled={active || paused || recordPending}>Foco</button><button type="button" aria-pressed={focus.currentMode === 'break'} onClick={() => focus.setPomodoroMode('break')} disabled={active || paused || recordPending}><Coffee size={12} />Pausa</button></div><span className="island-clock">{currentTime}</span></div>
            <div className="island-timer-line"><div><span className="island-timer" role="timer" aria-label={`Tempo restante: ${formatTimer(focus.remainingSeconds)}`}>{formatTimer(focus.remainingSeconds)}</span><p className="island-task-name" title={selectedTask?.title}>{saveFailed ? 'Tente registrar novamente pelo botão ao lado.' : selectedTask?.title || (focus.currentMode === 'break' ? 'Respire. Você merece uma pausa.' : 'Escolha uma tarefa ou apenas comece.')}</p></div><div className="island-timer-actions"><button className="island-play-button" type="button" onClick={controlTimer} disabled={saving || (saveFailed && focus.isLoading)} aria-label={saveFailed ? 'Tentar registrar sessão novamente' : active ? 'Pausar sessão' : paused ? 'Continuar sessão' : 'Iniciar sessão'} title={saveFailed ? 'Tentar registrar novamente' : active ? 'Pausar' : paused ? 'Continuar' : 'Iniciar'}>{saveFailed ? <RefreshCw size={17} /> : active ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><button className="widget-icon-button" type="button" onClick={focus.resetPomodoro} disabled={recordPending} aria-label="Reiniciar sessão" title="Reiniciar"><RotateCcw size={15} /></button></div></div>
            <div className="island-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>
          </div>}
          <footer className="island-summary"><button type="button" onClick={() => switchView('activity', activity === 'music' ? 'focus' : 'music')}>{activity === 'music' ? <Timer size={12} /> : <Music2 size={12} />}<span>{activity === 'music' ? 'Ver foco' : 'Ver música'}</span></button><button type="button" onClick={() => openPage(activity === 'music' ? 'music' : 'routine')}><CircleCheck size={12} /><span>{activity === 'focus' && pendingTasks ? `${pendingTasks} ${pendingTasks === 1 ? 'tarefa' : 'tarefas'} no painel` : 'Abrir painel'}</span><ArrowUpRight size={12} /></button></footer>
        </>}
        {failure && <div className="island-error" role="alert"><span>{failure}</span><button type="button" onClick={() => { setError(''); closeIsland(); }} aria-label="Tentar recolher ilha novamente"><RefreshCw size={13} /></button></div>}
        </div>
      </div>
      <div ref={outgoing} className="island-outgoing-layer" hidden aria-hidden="true" inert />
      {!bodyVisible && failure && <span className="island-sr-status" role="status">{failure}</span>}
    </section>
  </div>;
}
