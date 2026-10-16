import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { DynamicIsland } from './components/DynamicIsland';
import { DesktopDock } from './components/DesktopDock';
import { DesktopTopControls } from './components/DesktopTopControls';
import { MainDashboard } from './components/MainDashboard';
import { PedroMascot } from './components/PedroMascot';
import { useFocusStore } from './stores/useFocusStore';
import { useFinanceStore } from './stores/useFinanceStore';
import { initializeStateBridge } from './services/stateBridge';
import { initializePreferencesSync, usePreferencesStore } from './stores/usePreferencesStore';
import { requestPage, setDockVisible } from './lib/desktop';
import { initializeMedia } from './stores/useMediaStore';
import { initializeMainMediaReconciliation } from './services/mainMediaReconciliation';
import { initializeIslandVisibility, useIslandVisibilityStore } from './stores/useIslandVisibilityStore';
import { applyPanelMaterial, configureDesktopMenu, initialDesktopPage, updateFocusProgress } from './services/nativeDesktop';
import { useControlFeedback } from './hooks/useControlFeedback';
import { resolveAccentColor, resolveAccentForeground } from './lib/preferenceAppearance';
import { reportStartupStatus } from './services/startupDiagnostics';

export default function App() {
  useControlFeedback();
  const [label, setLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const preferences = usePreferencesStore();
  const focusState = useFocusStore(state => state.pomodoroState);
  const focusMode = useFocusStore(state => state.currentMode);
  const remaining = useFocusStore(state => state.remainingSeconds);
  const totalDuration = useFocusStore(state => state.totalDurationSeconds);
  const islandVisibility = useIslandVisibilityStore(state => state.snapshot);
  useEffect(() => {
    if (label !== 'island' && label !== 'top-left' && label !== 'top-right') return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void initializeIslandVisibility().then(cleanup => { if (cancelled) cleanup(); else dispose = cleanup; });
    return () => { cancelled = true; dispose?.(); };
  }, [label]);
  useEffect(() => {
    if (label === 'island') void useIslandVisibilityStore.getState()
      .configure(preferences.islandVisibility, preferences.islandHideDelay).catch(() => {});
  }, [label, preferences.islandVisibility, preferences.islandHideDelay]);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void initializeMedia().then(cleanup => { if (cancelled) cleanup(); else dispose = cleanup; }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      const value = '__TAURI_INTERNALS__' in window ? getCurrentWindow().label : new URLSearchParams(location.search).get('window') || 'main';
      if (!cancelled) { setLabel(value); void reportStartupStatus('frontend_loaded'); }
    };
    void detect().catch(() => { if (!cancelled) { setLabel('main'); setPhase('error'); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!label) return;
    return initializeMainMediaReconciliation(label);
  }, [label]);
  useEffect(() => {
    if (label !== 'main' || !('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false; let cleanup: (() => void) | undefined;
    let navigationGeneration = 0;
    // Listen while data is opening, so a dock click can choose the first screen.
    const navigate = (page: string) => {
      if (!['home', 'routine', 'finance', 'music', 'appearance'].includes(page)) return;
      const url = new URL(location.href); url.searchParams.set('page', page);
      history.replaceState(null, '', url);
      window.dispatchEvent(new CustomEvent('pedro:navigate', { detail: page }));
    };
    void listen<string>('pedro:navigate', event => { navigationGeneration++; navigate(event.payload); }).then(async unlisten => {
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
      const generation = navigationGeneration;
      const page = await initialDesktopPage();
      if (page && !cancelled && generation === 0 && navigationGeneration === 0) navigate(page);
    }).catch(() => {});
    return () => { cancelled = true; cleanup?.(); };
  }, [label]);
  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let cancelled = false;
    let sequence = 0;
    const apply = () => {
      const theme = preferences.theme === 'system' ? (scheme.matches ? 'dark' : 'light') : preferences.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.accent = preferences.accent;
      const accent = resolveAccentColor(preferences, theme === 'light');
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent-soft', `${accent}${theme === 'light' ? '13' : '18'}`);
      document.documentElement.style.setProperty('--accent-contrast', resolveAccentForeground(accent));
      document.documentElement.dataset.reducedMotion = String(preferences.reduceMotion || motion.matches);
      if (label === 'main') {
        const request = ++sequence;
        void applyPanelMaterial(preferences.nativeMaterial, theme).then(result => {
          if (!cancelled && request === sequence) document.documentElement.dataset.nativeMaterial = result.applied ? 'system' : 'solid';
        }).catch(() => { if (!cancelled && request === sequence) document.documentElement.dataset.nativeMaterial = 'solid'; });
      }
    };
    apply(); scheme.addEventListener('change', apply); motion.addEventListener('change', apply);
    return () => { cancelled = true; scheme.removeEventListener('change', apply); motion.removeEventListener('change', apply); };
  }, [label, preferences.theme, preferences.accent, preferences.customAccent, preferences.reduceMotion, preferences.nativeMaterial]);
  useEffect(() => {
    if (label === 'main') void configureDesktopMenu(preferences.islandVisibility, preferences.dockEnabled).catch(() => {});
  }, [label, preferences.islandVisibility, preferences.dockEnabled]);
  useEffect(() => {
    if (label !== 'main') return;
    const state = focusMode !== 'focus' ? 'none' : focusState === 'focus' ? 'running' : focusState === 'paused' ? 'paused' : 'none';
    void updateFocusProgress(state, totalDuration - remaining, totalDuration).catch(() => {});
  }, [label, focusMode, focusState, remaining, totalDuration]);
  useEffect(() => {
    if (!label) return;
    let cancelled = false; let disposeBridge: (() => void) | undefined; let disposePreferences: (() => void) | undefined;
    setPhase('loading');
    const boot = async () => {
      void reportStartupStatus('data_loading');
      disposeBridge = await initializeStateBridge();
      disposePreferences = await initializePreferencesSync();
      if (cancelled) { disposeBridge(); disposePreferences(); return; }
      await Promise.all([useFocusStore.getState().loadInitialData(), useFinanceStore.getState().loadFinancialData()]);
      if (!cancelled) { setPhase('ready'); void reportStartupStatus('frontend_ready'); }
    };
    void boot().catch((error: unknown) => {
      if (!cancelled) { setPhase('error'); void reportStartupStatus('frontend_error', error); }
    });
    return () => { cancelled = true; disposeBridge?.(); disposePreferences?.(); };
  }, [label, attempt]);
  useEffect(() => {
    // The dock owns its HWND state. Other WebViews only publish preferences;
    // late startup values from main/island must not reshow an empty dock.
    if (label === 'dock') void setDockVisible(preferences.dockEnabled).catch(error => {
      void reportStartupStatus('frontend_error', error);
    });
  }, [label, preferences.dockEnabled]);
  if (label === 'top-left' || label === 'top-right') {
    // Each corner component owns the native bounds and starts only after data is ready.
    // The HWND stays hidden during startup/error; no transparent boot overlay is shown.
    if (phase !== 'ready') return null;
    return <DesktopTopControls side={label === 'top-left' ? 'left' : 'right'} />;
  }
  if (label === 'island' || label === 'dock') {
    if (phase !== 'ready') return <div className={`desktop-widget-shell ${label}-shell`}
      aria-hidden={label === 'island' && !islandVisibility.visible} inert={label === 'island' && !islandVisibility.visible || undefined}>
      <div className="widget-boot" role={phase === 'error' ? 'alert' : 'status'}>
        <span><strong>{phase === 'error' ? 'Não foi possível abrir seus dados' : 'Preparando seu espaço…'}</strong>
          {phase === 'error' && <small>Seus registros não foram substituídos.</small>}</span>
        {phase === 'error' && <><button className="widget-icon-button" type="button" aria-label="Carregar novamente" onClick={() => setAttempt(a => a + 1)}><RefreshCw size={15} /></button>
          <button className="widget-icon-button" type="button" aria-label="Abrir painel" onClick={() => { void requestPage('home').catch(() => {}); }}><ArrowUpRight size={16} /></button></>}
      </div>
    </div>;
  }
  if (phase === 'error') return <div className="boot-screen"><div className="panel boot-card"><PedroMascot className="brand-mark" /><h1>Vamos tentar novamente</h1>
    <p>Não foi possível abrir seus dados. Eles não foram substituídos. Tente reabrir o aplicativo ou carregar novamente.</p>
    <button type="button" className="button primary" onClick={() => setAttempt(a => a + 1)}><RefreshCw size={16} />Carregar novamente</button></div></div>;
  if (phase !== 'ready' || !label) return <div className="boot-screen" role="status"><PedroMascot className="brand-mark" /><span>Preparando seu espaço…</span></div>;
  if (label === 'island') return <DynamicIsland />;
  if (label === 'dock') return <DesktopDock />;
  return <MainDashboard />;
}
