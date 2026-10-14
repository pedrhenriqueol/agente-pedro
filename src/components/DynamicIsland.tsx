import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ArrowUpRight, CalendarDays, ChevronDown, Coffee, House, ListTodo, Music2, Palette, Pause, Play, RefreshCw, RotateCcw, Settings2, Timer, Wallet } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { requestPage, syncIslandSize, readIslandAvailableWidth, type DesktopPage } from '../lib/desktop';
import { MusicPlayer } from './MusicPlayer';
import { useMediaStore } from '../stores/useMediaStore';
import { useIslandVisibilityStore } from '../stores/useIslandVisibilityStore';
import { IslandToday } from './IslandToday';
import { IslandTaskSelection } from './IslandTaskSelection';
import { IslandAppearance } from './IslandAppearance';
import { completeIslandVisibilityTransition } from '../services/islandVisibility';
import { islandGeometry, ISLAND_HEADER_HEIGHT, ISLAND_MAX_HEIGHT } from '../lib/islandGeometry';
import '../styles/desktop.css';
import '../styles/island-surface.css';

type IslandView = 'activity' | 'menu' | 'settings' | 'today';
type IslandPhase = 'compact' | 'preparing' | 'expanding' | 'expanded' | 'switching' | 'collapsing';
type Activity = 'focus' | 'music';
const COMPACT_HEIGHT = 24;
const HEADER_HEIGHT = ISLAND_HEADER_HEIGHT;
const FRAME_PADDING = 24;
const MAX_HEIGHT = ISLAND_MAX_HEIGHT;

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
  const [surfaceWidth, setSurfaceWidth] = useState(96);
  const [viewportWidth, setViewportWidth] = useState(() => isTauri() ? 1920 : window.innerWidth);
  const shell = useRef<HTMLDivElement>(null);
  const visibilityAnimation = useRef<Animation | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInside = useRef(false);
  const keyboardOwned = useRef(false);
  const shouldFocusBody = useRef(false);
  const restoreCompactFocus = useRef(false);
  const nativeWidth = useRef(380);
  const width = useRef(96);
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
  const nativeHeight = useRef(48); // boot HWND72 minus transparent padding
  const resizeSequence = useRef(0);
  const confirmedResizeSequence = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const outgoing = useRef<HTMLDivElement>(null);
  const outgoingAnimation = useRef<Animation | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const expander = useRef<HTMLButtonElement>(null);

  const menuItems = useRef<(HTMLButtonElement | null)[]>([]);
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
  const progress = focus.totalDurationSeconds > 0 ? Math.max(0, Math.min(1, 1 - focus.remainingSeconds / focus.totalDurationSeconds)) : 0;
  const modeName = focus.currentMode === 'focus' ? 'Foco' : 'Pausa';
  const status = saveFailed ? 'Registro pendente' : saving ? 'Registrando sessão…' : finished ? 'Sessão concluída' : paused ? 'Sessão pausada' : active ? `${modeName} em andamento` : 'Um passo de cada vez';
  const defaultActivity: Activity = !active && !paused && !recordPending && media ? 'music' : 'focus';
  const identity = active || paused || recordPending ? 'focus' : media ? 'music' : finished ? 'focus' : preferences.islandIdle;
  const baseGeometry = islandGeometry(preferences.islandSize, identity === 'music' || identity === 'focus' || identity === 'balance', viewportWidth);
  const geometry = { ...baseGeometry, expandedWidth: Math.min(baseGeometry.expandedWidth, view === 'settings' ? 360 : view === 'menu' ? 320 : baseGeometry.expandedWidth) };
  const geometryRef = useRef(geometry); geometryRef.current = geometry;
  const expandedGeometry = surfaceHeight > geometry.compactHeight || surfaceWidth > geometry.compactWidth;
  const exiting = visibility.transition?.visible === false;
  const available = visibility.visible && !exiting;
  const requested = phase !== 'compact' && phase !== 'collapsing';
  const toolbarVisible = requested && (phase !== 'preparing' || expandedGeometry);
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
  const resizeSurface = useCallback((next: number, nextWidth = width.current) => { height.current = next; width.current = nextWidth; setSurfaceHeight(next); setSurfaceWidth(nextWidth); }, []);
  const resizeNative = useCallback(async (expanded: boolean, next = geometryRef.current.compactHeight, nextWidth = expanded ? geometryRef.current.expandedWidth : geometryRef.current.compactWidth) => {
    const sequence = ++resizeSequence.current;
    await syncIslandSize(expanded, next + FRAME_PADDING, nextWidth + FRAME_PADDING);
    // A delayed reply must not replace the bounds of a newer successful resize.
    if (sequence > confirmedResizeSequence.current) {
      confirmedResizeSequence.current = sequence;
      nativeHeight.current = next; nativeWidth.current = nextWidth;
    }
  }, []);
  const preserveNativeFrame = useCallback(() => {
    cancelWork();
    if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
    resizingBlocked.current = true;
    const expanded = nativeHeight.current > geometryRef.current.compactHeight || nativeWidth.current > geometryRef.current.compactWidth;
    requestedExpansion.current = expanded;
    resizeSurface(nativeHeight.current, nativeWidth.current);
    setBodyVisible(expanded);
    setPhase(expanded ? 'expanded' : 'compact');
    setError('Não foi possível ajustar a ilha. Tente recolher novamente.');
  }, [cancelWork, resizeSurface]);
  const measure = useCallback(() => Math.min(MAX_HEIGHT, Math.max(HEADER_HEIGHT, Math.ceil((content.current?.scrollHeight || 0) + HEADER_HEIGHT + 8))), []);

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
    const incomingOpacity = body.current ? getComputedStyle(body.current).opacity : '0';
    if (Number(incomingOpacity) < .25 && outgoing.current && !outgoing.current.hidden) {
      const style = getComputedStyle(outgoing.current);
      // Keep one presentation, not a nested history of every interrupted tab.
      const previous = outgoing.current.firstElementChild as HTMLElement | null;
      if (previous) {
        const layer = previous.cloneNode(true) as HTMLElement;
        const previousStyle = getComputedStyle(previous);
        layer.style.opacity = String(Number(style.opacity) * Number(previousStyle.opacity));
        layer.style.transform = new DOMMatrix(style.transform).multiply(new DOMMatrix(previousStyle.transform)).toString();
        fragment.append(layer);
      }
    } else if (body.current && content.current) {
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
    resizeSurface(geometryRef.current.compactHeight, geometryRef.current.compactWidth);
    setPhase('compact');
    // The native worker owns visibility; a late size reply must never reveal it.
    void resizeNative(false).catch(() => {});
  }, [visibility.visible, cancelWork, resizeSurface, resizeNative]);

  useEffect(() => {
    let disposed = false;
    const update = () => {
      if (isTauri()) void readIslandAvailableWidth().then(value => { if (!disposed) setViewportWidth(value); }).catch(() => {});
      else setViewportWidth(window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => { disposed = true; window.removeEventListener('resize', update); if (hoverTimer.current) clearTimeout(hoverTimer.current); if (leaveTimer.current) clearTimeout(leaveTimer.current); visibilityAnimation.current?.cancel(); };
  }, []);

  // Grow the OS frame first, but finish a compact identity shrink in CSS
  // before shrinking the HWND; music ending must not clip the departing strip.
  useEffect(() => {
    if (requestedExpansion.current || !visibility.visible || phase !== 'compact') return;
    const sequence = cancelWork();
    const g = geometryRef.current;
    const changing = width.current !== g.compactWidth || height.current !== g.compactHeight;
    const grows = g.compactWidth > width.current || g.compactHeight > height.current;
    void (async () => {
      try {
        if (grows) await resizeNative(false, Math.max(g.compactHeight, height.current), Math.max(g.compactWidth, width.current));
        if (sequence !== epoch.current || requestedExpansion.current) return;
        resizeSurface(g.compactHeight, g.compactWidth);
        if (changing && !grows && !reduceMotion) schedule(() => {
          void resizeNative(false, g.compactHeight, g.compactWidth).catch(() => { if (sequence === epoch.current) preserveNativeFrame(); });
        }, 280, sequence);
        else await resizeNative(false, g.compactHeight, g.compactWidth);
      } catch { if (sequence === epoch.current) preserveNativeFrame(); }
    })();
  }, [geometry.compactHeight, geometry.compactWidth, cancelWork, resizeNative, resizeSurface, preserveNativeFrame, visibility.visible, phase, reduceMotion, schedule]);

  useEffect(() => {
    if (!requested && available && restoreCompactFocus.current) {
      restoreCompactFocus.current = false;
      expander.current?.focus({ preventScroll: true });
    }
  }, [requested, available]);

  useEffect(() => {
    if (requestedExpansion.current && phase === 'expanded') switchView(view, activity);
  // A preference changes the measured width; the normal guarded transition owns it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry.expandedWidth]);

  useLayoutEffect(() => {
    const node = shell.current;
    const intent = visibility.transition;
    if (!node) return;
    const current = getComputedStyle(node);
    const from = { opacity: current.opacity, transform: current.transform === 'none' ? 'translateY(0px) scale(1)' : current.transform };
    visibilityAnimation.current?.cancel();
    visibilityAnimation.current = null;
    if (!intent) {
      // SW_SHOW precedes event delivery. Keep the hidden WebView transparent so
      // its first native paint cannot flash an opaque compact surface.
      node.style.opacity = visibility.visible ? '' : '0';
      node.style.transform = visibility.visible ? '' : 'translateY(-10px) scale(.98)';
      return;
    }
    if (!intent.visible) { if (hoverTimer.current) clearTimeout(hoverTimer.current); if (leaveTimer.current) clearTimeout(leaveTimer.current); }
    const hidden = { opacity: '0', transform: 'translateY(-10px) scale(.98)' };
    const shown = { opacity: '1', transform: 'translateY(0px) scale(1)' };
    const animation = node.animate([intent.visible && from.opacity === '1' ? hidden : from, intent.visible ? shown : hidden], {
      duration: reduceMotion ? 0 : Math.min(200, intent.durationMs), easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards',
    });
    visibilityAnimation.current = animation;
    void animation.finished.then(() => completeIslandVisibilityTransition(intent.generation)).catch(() => {});
    return () => animation.cancel();
  }, [visibility.visible, visibility.transition?.generation, visibility.transition?.visible, reduceMotion]);

  // The OS may reveal while the pointer is already inside: no pointerenter is
  // guaranteed after SW_SHOWNOACTIVATE, so reveal intent also schedules expansion.
  useEffect(() => {
    if (!available || !preferences.islandHoverExpand || visibility.reason !== 'reveal' || requestedExpansion.current) return;
    const timer = setTimeout(() => { shouldFocusBody.current = false; beginOpen(active || paused || recordPending || media ? 'activity' : 'today'); }, reduceMotion ? 0 : 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility.visible, visibility.reason, preferences.islandHoverExpand]);

  function enterIsland() {
    pointerInside.current = true;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (!available || !preferences.islandHoverExpand || requestedExpansion.current) return;
    hoverTimer.current = setTimeout(() => {
      if (!pointerInside.current || requestedExpansion.current) return;
      shouldFocusBody.current = false;
      beginOpen(active || paused || recordPending || media ? 'activity' : 'today');
    }, 120);
  }

  function leaveIsland() {
    pointerInside.current = false;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (pointerInside.current || keyboardOwned.current || !requestedExpansion.current) return;
      // A draft, focused select or slider remains available while typing.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('input, select, textarea') && shell.current?.contains(focused) && document.hasFocus()) return;
      closeIsland();
    }, 420);
  }

  function beginOpen(nextView: IslandView, nextActivity = defaultActivity) {
    if (!available) return;
    // A leave deadline from the previous silhouette must not cancel a fresh
    // hover/click while the native frame is still preparing its new bounds.
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    notifyActivity();
    const presentation = capturePresentation();
    const sequence = cancelWork();
    installPresentation(presentation);
    prepareBody();
    requestedExpansion.current = true;
    setError('');
    setMenuIndex(0);
    focusActivityControl.current = shouldFocusBody.current && nextView === 'activity';
    setBodyVisible(false);
    pendingTransition.current = { epoch: sequence, view: nextView, kind: 'open' };
    setActivity(nextActivity);
    setView(nextView);
    setPhase('preparing');
  }

  function switchView(nextView: IslandView, nextActivity = activity) {
    if (requestedExpansion.current && phase !== 'compact' && phase !== 'collapsing'
      && nextView === view && (nextView !== 'activity' || nextActivity === activity)
      && width.current === geometryRef.current.expandedWidth) return;
    if (!requestedExpansion.current || height.current === geometryRef.current.compactHeight) { beginOpen(nextView, nextActivity); return; }
    const presentation = capturePresentation();
    const sequence = cancelWork();
    installPresentation(presentation);
    prepareBody();
    notifyActivity();
    focusActivityControl.current = shouldFocusBody.current && nextView === 'activity';
    setBodyVisible(false);
    pendingTransition.current = { epoch: sequence, view: nextView, kind: 'switch' };
    setActivity(nextActivity);
    setView(nextView);
    setPhase('preparing');
  }

  function closeIsland(restore = false) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // The live body already has an exit transition. Fade it as the surface
    // shrinks, instead of emptying a full-size rectangle before motion starts.
    const sequence = cancelWork();
    requestedExpansion.current = false;
    setBodyVisible(false);
    setPhase('collapsing');
    restoreCompactFocus.current = restore && visibility.visible;
    resizeSurface(geometryRef.current.compactHeight, geometryRef.current.compactWidth);
    schedule(() => {
      void resizeNative(false).then(() => {
        if (sequence === epoch.current) setPhase('compact');
      }).catch(() => {
        if (sequence !== epoch.current || !visibility.visible) return;
        // Keep the still-large native frame occupied by a usable, retryable UI.
        requestedExpansion.current = true;
        resizingBlocked.current = true;
        if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
        resizeSurface(nativeHeight.current, nativeWidth.current);
        setBodyVisible(true);
        setPhase('expanded');
        setError('Não foi possível recolher a ilha. Tente novamente.');
      });
    }, reduceMotion ? 0 : 280, sequence);
  }

  function toggleExpansion() {
    if (requestedExpansion.current) closeIsland(); else beginOpen(active || paused || recordPending || media ? 'activity' : 'today');
  }

  function openMenu() {
    shouldFocusBody.current = true;
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
        // Always pass through the FIFO barrier: an older shrink may already be
        // in flight even if the last confirmed frame still appears large enough.
        await resizeNative(true, Math.max(nextHeight, nativeHeight.current), Math.max(geometryRef.current.expandedWidth, nativeWidth.current));
        preparedHeight = nativeHeight.current;
        if (sequence !== epoch.current || layout !== layoutRevision.current || !requestedExpansion.current) {
          return;
        }
        // Metadata/errors may change while IPC is pending. Use their current
        // geometry rather than clipping the new content into the first sample.
        const currentHeight = measure();
        if (currentHeight > nativeHeight.current || geometryRef.current.expandedWidth > nativeWidth.current) {
          await resizeNative(true, Math.max(currentHeight, nativeHeight.current), Math.max(geometryRef.current.expandedWidth, nativeWidth.current));
          preparedHeight = nativeHeight.current;
        }
        if (sequence !== epoch.current || layout !== layoutRevision.current || !requestedExpansion.current) {
          return;
        }
        nextHeight = currentHeight;
        resizeSurface(nextHeight, geometryRef.current.expandedWidth);
        setPhase(transition.kind === 'open' ? 'expanding' : 'switching');
        const enter = () => {
          if (body.current) {
            void body.current.offsetHeight;
            body.current.style.transition = '';
            body.current.style.opacity = '';
            body.current.style.transform = '';
          }
          setBodyVisible(true);
          fadeOutgoing(reduceMotion ? 0 : 160, sequence);
        };
        if (reduceMotion) enter();
        else schedule(enter, transition.kind === 'open' ? 25 : 0, sequence);
        schedule(() => {
          setPhase('expanded');
          if (layout === layoutRevision.current && requestedExpansion.current && height.current === nextHeight) {
            void resizeNative(true, nextHeight).catch(() => {
              if (sequence === epoch.current && layout === layoutRevision.current && requestedExpansion.current) preserveNativeFrame();
            });
          }
        }, reduceMotion ? 0 : 280, sequence);
      } catch {
        if (sequence !== epoch.current) return;
        requestedExpansion.current = false;
        setError('Não foi possível expandir. Abra o menu para tentar novamente.');
        clearOutgoing();
        if (body.current) { body.current.style.transition = ''; body.current.style.opacity = ''; body.current.style.transform = ''; }
        // A failed larger view may leave the previous native frame expanded.
        // Keep that frame occupied until a compact resize actually succeeds.
        if (preparedHeight > geometryRef.current.compactHeight || nativeWidth.current > geometryRef.current.compactWidth) {
          resizeSurface(nativeHeight.current, nativeWidth.current);
          setBodyVisible(true);
          setPhase('collapsing');
        }
        try {
          await resizeNative(false);
          if (sequence !== epoch.current) return;
          resizeSurface(geometryRef.current.compactHeight, geometryRef.current.compactWidth);
          setBodyVisible(false);
          setPhase('compact');
        } catch {
          if (sequence !== epoch.current) return;
          if (preparedHeight > geometryRef.current.compactHeight || nativeWidth.current > geometryRef.current.compactWidth) {
            requestedExpansion.current = true;
            resizingBlocked.current = true;
            resizeSurface(nativeHeight.current, nativeWidth.current);
            setBodyVisible(true);
            setPhase('expanded');
            setError('Não foi possível ajustar a ilha. Tente recolher novamente.');
          } else {
            resizeSurface(geometryRef.current.compactHeight, geometryRef.current.compactWidth);
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
          resizeSurface(next, geometryRef.current.expandedWidth);
          if (!growing) schedule(() => {
            if (layout !== layoutRevision.current || !requestedExpansion.current || height.current !== next) return;
            void resizeNative(true, next).catch(() => {
              if (sequence === epoch.current && layout === layoutRevision.current && requestedExpansion.current) preserveNativeFrame();
            });
          }, reduceMotion ? 0 : 280, sequence);
        } catch { if (!disposed && sequence === epoch.current && layout === layoutRevision.current) preserveNativeFrame(); }
      })();
    });
    observer.observe(content.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [phase, visibility.visible, reduceMotion, measure, resizeSurface, resizeNative, preserveNativeFrame, schedule]);

  useEffect(() => {
    if (!bodyVisible || !available || !shouldFocusBody.current) return;
    shouldFocusBody.current = false;
    if (view === 'menu') menuItems.current[menuIndex]?.focus();
    else if (view === 'settings') body.current?.querySelector<HTMLButtonElement>('.island-appearance button')?.focus({ preventScroll: true });
    else if (view === 'today') body.current?.querySelector<HTMLButtonElement>('.island-today [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    else if (focusActivityControl.current) {
      focusActivityControl.current = false;
      // Today stays mounted while hidden; focus must belong to the visible activity.
      (body.current?.querySelector<HTMLButtonElement>('.island-focus-block button:not(:disabled), .island-music-body button:not(:disabled)') || expander.current)?.focus({ preventScroll: true });
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
    { label: 'Hoje', icon: House, run: () => switchView('today') },
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
  const hasActivity = identity === 'music' || identity === 'focus' || identity === 'balance';
  const styles = { '--widget-opacity': preferences.islandOpacity, '--island-height': `${surfaceHeight}px`,
    '--island-width': `${surfaceWidth}px`, '--island-content-width': `${geometry.expandedWidth - 16}px` } as CSSProperties;
  const currentTab = view === 'today' ? 'today' : view === 'activity' ? activity : null;
  const tabs = [{ id: 'today', label: 'Hoje', Icon: CalendarDays }, { id: 'focus', label: 'Foco', Icon: Timer }, { id: 'music', label: 'Música', Icon: Music2 }] as const;

  return <div ref={shell} className="desktop-widget-shell island-shell" style={styles} data-reduce-motion={reduceMotion}
    data-island-tone={preferences.islandTone} data-island-visible={visibility.visible} data-visibility-intent={visibility.transition?.visible}
    aria-hidden={!available} inert={!available || undefined}
    onFocusCapture={event => { notifyActivity(); if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) keyboardOwned.current = true; }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { keyboardOwned.current = false; if (!pointerInside.current) leaveIsland(); } }}
    onKeyDownCapture={event => { keyboardOwned.current = true; notifyActivity(); if (event.key === 'Tab' && !requestedExpansion.current) { shouldFocusBody.current = true; beginOpen('today'); } }}
    onPointerDownCapture={() => { keyboardOwned.current = false; notifyActivity(); }} onPointerMoveCapture={notifyActivity}>
    <section className={`pedro-island${expandedGeometry ? ' is-expanded' : ''}`} data-phase={phase} data-view={view}
      data-has-activity={hasActivity} aria-label="Ilha do Pedro" onPointerEnter={enterIsland} onPointerLeave={leaveIsland}
      onContextMenu={event => { event.preventDefault(); openMenu(); }}
      onKeyDown={event => {
        if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); openMenu(); }
        if (event.key === 'Escape' && requestedExpansion.current) { event.preventDefault(); if (view === 'settings' || view === 'menu') switchView(active || paused || recordPending || media ? 'activity' : 'today'); else closeIsland(true); }
      }}>
      <button ref={expander} className="island-compact-trigger" type="button" aria-expanded={requested}
        aria-controls="island-details" aria-label={`Expandir ilha: ${title}`} title={title}
        tabIndex={toolbarVisible ? -1 : 0} aria-hidden={toolbarVisible} inert={toolbarVisible || undefined}
        onClick={event => { shouldFocusBody.current = event.detail === 0; toggleExpansion(); }}>
        <span className={`island-compact-mark${identity === 'music' ? ' is-music' : ''}`} aria-hidden="true">
          {identity === 'music' && media?.artwork && failedArtwork !== media.artwork ? <img src={media.artwork} alt="" onError={() => setFailedArtwork(media.artwork)} />
            : identity === 'music' ? <Music2 size={14} /> : identity === 'focus' ? <Timer size={14} /> : identity === 'balance' ? <Wallet size={14} /> : <span className="island-pedro-monogram">p<span /></span>}
        </span>
        {identity !== 'minimal' && <span className="island-compact-title">{title}</span>}
        {identity === 'focus' ? <span className="island-compact-time">{formatTimer(focus.remainingSeconds)}</span>
          : identity === 'music' ? <span className={`island-equalizer${media?.playbackStatus === 'playing' && presentation === 'ready' ? ' is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span>
          : <ChevronDown size={11} aria-hidden="true" />}
      </button>
      <header className="island-toolbar" aria-hidden={!toolbarVisible} inert={!toolbarVisible || undefined}>
        <button ref={menuTrigger} className={`island-toolbar-brand${failure ? ' has-error' : ''}`} type="button" onClick={openMenu}
          aria-label="Abrir menu do Pedro" title={failure || 'Menu do Pedro'} aria-haspopup="menu" aria-expanded={requested && view === 'menu'} aria-controls="island-menu"><span className="island-pedro-monogram">p<span /></span></button>
        <div className="island-context-tabs" role="tablist" aria-label="Contexto da ilha">
          {tabs.map(({ id, label, Icon }, index) => <button key={id} type="button" role="tab" aria-selected={currentTab === id}
            tabIndex={currentTab === id || currentTab === null && index === 0 ? 0 : -1} aria-label={label} title={label}
            aria-controls="island-details" onClick={event => { shouldFocusBody.current = event.detail === 0; switchView(id === 'today' ? 'today' : 'activity', id === 'music' ? 'music' : 'focus'); }}
            onKeyDown={event => { const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!move && event.key !== 'Home' && event.key !== 'End') return; event.preventDefault(); const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + move + tabs.length) % tabs.length; const item = tabs[target]; shouldFocusBody.current = false; switchView(item.id === 'today' ? 'today' : 'activity', item.id === 'music' ? 'music' : 'focus'); (event.currentTarget.parentElement?.children[target] as HTMLButtonElement)?.focus({ preventScroll: true }); }}>
            <Icon size={13} aria-hidden="true" /><span>{label}</span>
          </button>)}
        </div>
        <div className="island-toolbar-actions">
          <button className="widget-icon-button" type="button" onClick={() => { void openPage('home'); }} aria-label="Abrir painel" title="Abrir painel"><ArrowUpRight size={13} /></button>
          <button className="widget-icon-button island-appearance-trigger" type="button" onClick={event => { shouldFocusBody.current = event.detail === 0; switchView(view === 'settings' ? (media || active || paused ? 'activity' : 'today') : 'settings'); }} aria-label="Aparência da ilha" title="Aparência" aria-expanded={requested && view === 'settings'} aria-controls="island-details"><Palette size={13} /></button>
          <button className="widget-icon-button island-collapse" type="button" onClick={() => closeIsland(true)} aria-label="Recolher ilha" title="Recolher ilha"><ChevronDown size={13} /></button>
        </div>
      </header>
      <div id="island-details" ref={body} className={`island-details${bodyVisible ? ' is-visible' : ''}`} aria-hidden={!bodyVisible} inert={!bodyVisible || undefined}>
        <div className="island-details-content" ref={content}>
          <div hidden={view !== 'today'} inert={view !== 'today' || undefined} aria-hidden={view !== 'today' || undefined}>
            <IslandToday onOpenPanel={() => { void openPage('routine'); }} />
          </div>
          {view === 'menu' ? <div id="island-menu" role="menu" aria-label="Menu do Pedro" className="island-menu" onKeyDown={menuKeys}>
            {menu.map((item, index) => <button key={item.label} ref={element => { menuItems.current[index] = element; }} type="button" role="menuitem" tabIndex={menuIndex === index ? 0 : -1} onFocus={() => setMenuIndex(index)} onClick={item.run} className={`island-menu-item${index === 5 ? ' is-separated' : ''}`}><item.icon size={15} aria-hidden="true" /><span>{item.label}</span>{index > 0 && index < 5 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button>)}
          </div> : view === 'settings' ? <div className="island-appearance-popover"><IslandAppearance onOpenFull={() => { void openPage('appearance'); }} onClose={() => switchView(media || active || paused ? 'activity' : 'today')} /></div>
            : view === 'activity' ? activity === 'music' ? <div className="island-music-body"><MusicPlayer layout="island" /></div>
            : <div className="island-focus-block" aria-label={status}>
            <div className="island-focus-top"><div className="island-mode-picker" role="group" aria-label="Tipo de sessão"><button type="button" aria-pressed={focus.currentMode === 'focus'} onClick={() => focus.setPomodoroMode('focus')} disabled={active || paused || recordPending}>Foco</button><button type="button" aria-pressed={focus.currentMode === 'break'} onClick={() => focus.setPomodoroMode('break')} disabled={active || paused || recordPending}><Coffee size={12} />Pausa</button></div><span className="island-clock">{currentTime}</span></div>
            <div className="island-timer-line"><div><span className="island-timer" role="timer" aria-label={`Tempo restante: ${formatTimer(focus.remainingSeconds)}`}>{formatTimer(focus.remainingSeconds)}</span><p className="island-task-name" title={selectedTask?.title}>{saveFailed ? 'Tente registrar novamente pelo botão ao lado.' : selectedTask?.title || (focus.currentMode === 'break' ? 'Respire. Você merece uma pausa.' : 'Escolha uma tarefa ou apenas comece.')}</p></div><div className="island-timer-actions"><button className="island-play-button" type="button" onClick={controlTimer} disabled={saving || (saveFailed && focus.isLoading)} aria-label={saveFailed ? 'Tentar registrar sessão novamente' : active ? 'Pausar sessão' : paused ? 'Continuar sessão' : 'Iniciar sessão'} title={saveFailed ? 'Tentar registrar novamente' : active ? 'Pausar' : paused ? 'Continuar' : 'Iniciar'}>{saveFailed ? <RefreshCw size={17} /> : active ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><button className="widget-icon-button" type="button" onClick={focus.resetPomodoro} disabled={recordPending} aria-label="Reiniciar sessão" title="Reiniciar"><RotateCcw size={15} /></button></div></div>
            <div className="island-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>
            <IslandTaskSelection />
          </div> : null}
          {failure && <div className="island-error" role="alert"><span>{failure}</span><button type="button" onClick={() => { setError(''); closeIsland(); }} aria-label="Tentar recolher ilha novamente"><RefreshCw size={13} /></button></div>}
        </div>
      </div>
      <div ref={outgoing} className="island-outgoing-layer" hidden aria-hidden="true" inert />
      {!bodyVisible && failure && <span className="island-sr-status" role="status">{failure}</span>}
    </section>
  </div>;
}
