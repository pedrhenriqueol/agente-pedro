import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { isTauri } from '@tauri-apps/api/core';
import { ChevronDown, ChevronUp, CircleAlert, LayoutGrid, ListTodo, Palette, RefreshCw, Volume2, VolumeX, X } from 'lucide-react';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useIslandVisibilityStore } from '../stores/useIslandVisibilityStore';
import { useFocusStore } from '../stores/useFocusStore';
import { useMediaStore } from '../stores/useMediaStore';
import { configureTopControl, type TopControlFrame, type TopControlLabel } from '../services/topControls';
import { requestPage, type DesktopPage } from '../lib/desktop';
import { POPOVER_ENTER, POPOVER_EXIT } from '../lib/motionProfiles';
import { waitForWidgetViewport } from '../lib/widgetViewport';
import { IslandAppearance } from './IslandAppearance';
import { MusicVolume } from './MusicPlayer';
import '../styles/desktop.css';
import '../styles/top-controls.css';

const CLOSE_DELAY = 420;
const OPEN_DELAY = 120;
const EXIT_DURATION = 180;
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === 'string' ? error : 'Não foi possível atualizar este controle.';
const compactFrame = (label: TopControlLabel, visible: boolean): TopControlFrame => ({ visible, expanded: false, width: label === 'top-left' ? 128 : 90, height: 46 });
function naturalFrameHeight(panel: HTMLElement, content: HTMLElement): number {
  const style = getComputedStyle(panel);
  const trim = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
    .reduce((height, value) => height + Number.parseFloat(value || '0'), 0);
  return Math.min(424, Math.ceil(content.offsetHeight + trim) + 52);
}

/** A notch and its popup share one small, bounded native frame per corner. */
export function DesktopTopControls({ side }: { side: 'left' | 'right' }) {
  const label: TopControlLabel = side === 'left' ? 'top-left' : 'top-right';
  const p = usePreferencesStore();
  const visibility = useIslandVisibilityStore(state => state.snapshot);
  const pendingTasks = useFocusStore(state => state.tasks.filter(task => task.completed === 0).length);
  const media = useMediaStore();
  const desiredVisible = p.topControlsEnabled && visibility.visible && visibility.transition?.visible !== false;
  const [frame, setFrame] = useState(() => compactFrame(label, false));
  const [popupMounted, setPopupMounted] = useState(false);
  const [popupVisible, setPopupVisible] = useState(false);
  const popupOpacity = useMotionValue(0);
  const popupY = useMotionValue(-7);
  const popupScale = useMotionValue(.985);
  const lastPopupGoal = useRef<boolean | null>(null);
  const [nativeVisible, setNativeVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const popupContent = useRef<HTMLDivElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const epoch = useRef(0);
  const intent = useRef(false);
  const allowed = useRef(desiredVisible);
  const pointerInside = useRef(false);
  const keyboard = useRef(false);
  const work = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRevision = useRef(0);
  const lastVolume = useRef(50);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reduced = p.reduceMotion || systemReduced;
  const volumeAvailable = media.initialized && media.snapshot.supported && media.snapshot.volume !== null && Number.isFinite(media.snapshot.volume);
  const silent = media.snapshot.muted || media.snapshot.volume === 0;
  allowed.current = desiredVisible;

  useLayoutEffect(() => {
    if (!popupMounted) {
      lastPopupGoal.current = null;
      popupOpacity.stop(); popupY.stop(); popupScale.stop();
      popupOpacity.set(0);
      return;
    }
    const changed = lastPopupGoal.current !== popupVisible;
    lastPopupGoal.current = popupVisible;
    const target = { opacity: popupVisible ? 1 : 0, y: popupVisible || reduced ? 0 : -7, scale: popupVisible || reduced ? 1 : .985 };
    if (reduced) {
      // Explicit values survive popup remounts and let reduced motion stop an
      // in-flight spring even when its destination has not changed.
      popupOpacity.stop(); popupY.stop(); popupScale.stop();
      popupOpacity.set(target.opacity); popupY.set(target.y); popupScale.set(target.scale);
    } else if (changed) {
      const transition = popupVisible ? POPOVER_ENTER : POPOVER_EXIT;
      animate(popupOpacity, target.opacity, transition);
      animate(popupY, target.y, transition);
      animate(popupScale, target.scale, transition);
    }
  }, [popupMounted, popupVisible, reduced, popupOpacity, popupY, popupScale]);

  useEffect(() => () => { popupOpacity.stop(); popupY.stop(); popupScale.stop(); }, [popupOpacity, popupY, popupScale]);

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const receive = () => setSystemReduced(query.matches);
    receive();
    query.addEventListener('change', receive);
    return () => query.removeEventListener('change', receive);
  }, []);
  useEffect(() => {
    if (media.snapshot.volume !== null && media.snapshot.volume > 0 && !media.snapshot.muted) lastVolume.current = media.snapshot.volume;
  }, [media.snapshot.volume, media.snapshot.muted]);

  const clearTimers = useCallback(() => {
    if (work.current) clearTimeout(work.current);
    if (openTimer.current) clearTimeout(openTimer.current);
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeRevision.current += 1;
    work.current = null; openTimer.current = null; resizeTimer.current = null;
  }, []);

  const closePopup = useCallback((returnFocus = false) => {
    clearTimers();
    intent.current = false;
    const current = ++epoch.current;
    setPopupVisible(false);
    work.current = setTimeout(() => {
      work.current = null;
      if (current !== epoch.current) return;
      void configureTopControl(label, compactFrame(label, allowed.current)).then(next => {
        if (current !== epoch.current) return;
        setFrame(next); setNativeVisible(next.visible); setPopupMounted(false); setError(null);
        if (returnFocus && next.visible && document.hasFocus()) openButton.current?.focus({ preventScroll: true });
      }).catch(failure => {
        if (current !== epoch.current) return;
        // Keep a visible, usable panel inside the still-expanded native frame.
        intent.current = true; setPopupVisible(true); setError(message(failure));
      });
    }, reduced ? 0 : EXIT_DURATION);
  }, [clearTimers, label, reduced]);

  const openPopup = useCallback(() => {
    if (!allowed.current) return;
    clearTimers();
    intent.current = true;
    epoch.current += 1;
    setPopupMounted(true);
    setRevision(value => value + 1);
    useIslandVisibilityStore.getState().notifyActivity();
  }, [clearTimers]);

  useEffect(() => {
    clearTimers();
    const current = ++epoch.current;
    intent.current = false;
    setPopupVisible(false);
    setNativeVisible(false); // Hidden pose survives the native ShowWindow prepaint.
    void configureTopControl(label, compactFrame(label, desiredVisible)).then(next => {
      if (current !== epoch.current) return;
      setFrame(next); setNativeVisible(next.visible); setPopupMounted(false); setError(null);
    }).catch(failure => { if (current === epoch.current) setError(message(failure)); });
    return () => { epoch.current += 1; clearTimers(); };
  }, [clearTimers, desiredVisible, label]);

  useLayoutEffect(() => {
    if (!popupMounted || !intent.current || !allowed.current || !popup.current || !popupContent.current) return;
    const current = epoch.current;
    const targetWidth = side === 'left' ? 384 : 304;
    const node = popup.current;
    const content = popupContent.current;
    let prepared: TopControlFrame | null = null;
    // Measure at its intended desktop width, independently of the compact HWND.
    // The shell clips this inert preparer until the native frame is confirmed.
    node.style.width = `${targetWidth - 16}px`;
    node.style.height = 'auto';
    const targetHeight = naturalFrameHeight(node, content);
    void configureTopControl(label, { visible: true, expanded: true, width: targetWidth, height: targetHeight }).then(async initial => {
      let next = initial;
      if (current !== epoch.current || !intent.current || !allowed.current) return;
      prepared = next;
      node.style.height = `${Math.max(1, next.height - 52)}px`;
      if (next.visible && next.width < targetWidth) {
        node.style.width = `${Math.max(1, next.width - 16)}px`;
        next = await configureTopControl(label, { ...next, height: naturalFrameHeight(node, content) });
      }
      if (current !== epoch.current || !intent.current || !allowed.current) return;
      node.style.height = `${Math.max(1, next.height - 52)}px`;
      prepared = next;
      setFrame(next); setNativeVisible(next.visible);
      if (next.visible && isTauri() && !await waitForWidgetViewport(next,
        () => current === epoch.current && intent.current && allowed.current)) return;
      if (current !== epoch.current || !intent.current || !allowed.current) return;
      setPopupVisible(next.visible); setError(null);
      if (!next.visible) { intent.current = false; setPopupMounted(false); }
    }).catch(async failure => {
      if (current !== epoch.current) return;
      if (prepared?.visible) {
        // If monitor clamping needs a second resize and that fails, the first
        // expanded frame already exists. Confirm compact recovery before
        // removing the panel; otherwise occupy that frame with usable controls.
        try {
          const compact = await configureTopControl(label, compactFrame(label, allowed.current));
          if (current !== epoch.current) return;
          setFrame(compact); setNativeVisible(compact.visible);
        } catch {
          if (current !== epoch.current) return;
          setFrame(prepared); setNativeVisible(true); setPopupVisible(true); setError(message(failure));
          return;
        }
      }
      intent.current = false; setPopupMounted(false); setPopupVisible(false); setError(message(failure));
    });
  }, [popupMounted, revision, side, label]);

  useEffect(() => {
    const node = popup.current;
    const content = popupContent.current;
    if (!node || !content || !popupVisible) return;
    const observer = new ResizeObserver(() => {
      if (!intent.current || !allowed.current) return;
      const height = naturalFrameHeight(node, content);
      if (height === frame.height) return;
      const current = epoch.current;
      const resizing = ++resizeRevision.current;
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      const apply = () => {
        resizeTimer.current = null;
        if (current !== epoch.current || resizing !== resizeRevision.current) return;
        void configureTopControl(label, { ...frame, visible: true, expanded: true, height }).then(next => {
          if (current !== epoch.current || resizing !== resizeRevision.current || !intent.current || !allowed.current) return;
          node.style.height = `${Math.max(1, next.height - 52)}px`;
          setFrame(next); setNativeVisible(next.visible);
        }).catch(failure => {
          if (current !== epoch.current || resizing !== resizeRevision.current) return;
          node.style.height = `${Math.max(1, frame.height - 52)}px`;
          setError(message(failure));
        });
      };
      if (height < frame.height) {
        // Shrink presentation first; the HWND remains available for its exit.
        node.style.height = `${Math.max(1, height - 52)}px`;
        resizeTimer.current = setTimeout(apply, reduced ? 0 : EXIT_DURATION);
      } else apply(); // Confirm native growth before the clipped panel can grow.
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [popupVisible, frame, label, reduced]);

  const focusLocked = () => {
    const active = document.activeElement;
    return active instanceof HTMLElement && shell.current?.contains(active)
      && (keyboard.current || active.matches('input,select,textarea'));
  };
  const scheduleClose = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (!intent.current || focusLocked()) return;
    if (work.current) clearTimeout(work.current);
    work.current = setTimeout(() => {
      work.current = null;
      if (!pointerInside.current && !focusLocked()) closePopup();
    }, CLOSE_DELAY);
  };
  const hoverOpen = () => {
    if (!p.islandHoverExpand || intent.current || !allowed.current) return;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => { openTimer.current = null; if (pointerInside.current) openPopup(); }, OPEN_DELAY);
  };

  useEffect(() => {
    if (!popupVisible) return;
    const timer = setInterval(() => {
      const active = document.activeElement;
      if (document.hasFocus() && active instanceof HTMLElement && shell.current?.contains(active)
        && (keyboard.current || active.matches('input,select,textarea'))) useIslandVisibilityStore.getState().notifyActivity();
    }, 600);
    return () => clearInterval(timer);
  }, [popupVisible]);

  async function navigate(page: DesktopPage) {
    try { await requestPage(page); closePopup(); }
    catch (failure) { setError(message(failure)); }
  }

  function toggleSound() {
    if (!volumeAvailable || media.pending) return;
    const current = media.snapshot.volume ?? 0;
    void media.controlMedia('volume', silent ? current > 0 ? current : lastVolume.current : 0).catch(() => {});
  }

  return <div ref={shell} className={`desktop-widget-shell desktop-top-controls is-${side}`}
    data-top-visible={desiredVisible && nativeVisible} data-popup-open={popupVisible} data-island-tone={p.islandTone} data-reduce-motion={reduced}
    aria-hidden={!desiredVisible || !nativeVisible} inert={!desiredVisible || !nativeVisible || undefined}
    style={{ '--top-frame-width': `${frame.width}px`, '--widget-opacity': p.islandOpacity } as CSSProperties}
    onPointerEnter={() => { pointerInside.current = true; if (work.current && intent.current) { clearTimeout(work.current); work.current = null; } useIslandVisibilityStore.getState().notifyActivity(); }}
    onPointerMove={() => useIslandVisibilityStore.getState().notifyActivity()}
    onPointerLeave={() => { pointerInside.current = false; scheduleClose(); }}
    onPointerDown={() => { keyboard.current = false; useIslandVisibilityStore.getState().notifyActivity(); }}
    onFocusCapture={() => { if (work.current && focusLocked()) { clearTimeout(work.current); work.current = null; } useIslandVisibilityStore.getState().notifyActivity(); }}
    onBlurCapture={event => { if (!shell.current?.contains(event.relatedTarget as Node | null)) scheduleClose(); }}
    onKeyDown={event => {
      keyboard.current = true; useIslandVisibilityStore.getState().notifyActivity();
      if (event.key === 'Escape' && popupMounted) { event.preventDefault(); event.stopPropagation(); closePopup(true); }
    }}>
    <div className="desktop-top-notch" aria-label={side === 'left' ? 'Atalhos do Pedro' : 'Som do Windows'}>
      {side === 'left' ? <>
        <button ref={openButton} type="button" aria-label="Aparência no desktop" aria-expanded={popupVisible} aria-controls="top-left-popup"
          onPointerEnter={hoverOpen} onClick={() => intent.current ? closePopup() : openPopup()} title={error || 'Aparência'}>
          {error ? <CircleAlert size={14} aria-hidden="true" /> : <Palette size={14} aria-hidden="true" />}
        </button>
        <button type="button" aria-label="Abrir painel do Pedro" title="Painel" onClick={() => { void navigate('home'); }}><LayoutGrid size={13} aria-hidden="true" /></button>
        <button type="button" className="desktop-top-tasks" aria-label={`${pendingTasks} ${pendingTasks === 1 ? 'tarefa pendente' : 'tarefas pendentes'}`}
          title="Tarefas" onClick={() => { void navigate('routine'); }}><ListTodo size={13} aria-hidden="true" /><span>{pendingTasks > 99 ? '99+' : pendingTasks}</span></button>
      </> : <>
        <button ref={openButton} type="button" aria-label={popupVisible ? 'Fechar controles de volume' : 'Abrir controles de volume'} aria-expanded={popupVisible}
          aria-controls="top-right-popup" onPointerEnter={hoverOpen} onClick={() => intent.current ? closePopup() : openPopup()} title={error || 'Volume'}>
          {error ? <CircleAlert size={13} aria-hidden="true" /> : popupVisible ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </button>
        <button type="button" aria-label={silent ? 'Restaurar volume' : 'Silenciar áudio'} title={volumeAvailable ? `${silent ? 'Sem som' : `${Math.round(media.snapshot.volume!)}%`} · ${silent ? 'restaurar' : 'silenciar'}` : 'Volume indisponível'}
          disabled={!volumeAvailable || media.pending} onPointerEnter={hoverOpen} onClick={toggleSound}>
          {silent ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
        </button>
      </>}
    </div>
    {popupMounted && <motion.div ref={popup} id={`${label}-popup`} className="desktop-top-panel" data-panel-visible={popupVisible}
      aria-hidden={!popupVisible} inert={!popupVisible || undefined}
      style={{ opacity: popupOpacity, y: popupY, scale: popupScale, transformOrigin: `top ${side}` }}>
      <div ref={popupContent} className="desktop-top-panel-content">
      {side === 'left' ? <IslandAppearance idPrefix="top-left-appearance" onClose={() => closePopup(true)} onOpenFull={() => { void navigate('appearance'); }} /> : <>
        <div className="desktop-top-volume-heading"><span><Volume2 size={14} aria-hidden="true" /><strong>Som do Windows</strong></span><button type="button" aria-label="Fechar volume" onClick={() => closePopup(true)}><X size={14} aria-hidden="true" /></button></div>
        {volumeAvailable ? <MusicVolume /> : <p className="desktop-top-help">{media.snapshot.supported ? 'Não foi possível ler o volume. Tente novamente.' : 'O volume do sistema está disponível no aplicativo para Windows.'}</p>}
        <button type="button" className="desktop-top-refresh" disabled={media.pending} onClick={() => { void media.refreshMedia().catch(() => {}); }}><RefreshCw size={12} aria-hidden="true" />Atualizar som</button>
        {(media.error || media.snapshot.error) && <p className="desktop-top-error" role="alert">{media.error || media.snapshot.error}</p>}
      </>}
      {error && <p className="desktop-top-error" role="alert">{error}<button type="button" onClick={() => closePopup()}>Tentar recolher</button></p>}
      </div>
    </motion.div>}
    {error && !popupMounted && <span className="desktop-top-sr-error" role="alert">{error}</span>}
  </div>;
}
