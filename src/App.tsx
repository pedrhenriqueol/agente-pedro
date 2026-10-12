import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { DynamicIsland } from './components/DynamicIsland';
import { DesktopDock } from './components/DesktopDock';
import { MainDashboard } from './components/MainDashboard';
import { useFocusStore } from './stores/useFocusStore';
import { useFinanceStore } from './stores/useFinanceStore';
import { initializeStateBridge } from './services/stateBridge';
import { initializePreferencesSync, usePreferencesStore } from './stores/usePreferencesStore';
import { requestPage, setDockVisible } from './lib/desktop';

export default function App() {
  const [label, setLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const preferences = usePreferencesStore();
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      const value = '__TAURI_INTERNALS__' in window ? getCurrentWindow().label : new URLSearchParams(location.search).get('window') || 'main';
      if (!cancelled) setLabel(value);
    };
    void detect().catch(() => { if (!cancelled) { setLabel('main'); setPhase('error'); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (label !== 'main' || !('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false; let cleanup: (() => void) | undefined;
    // Listen while data is opening, so a dock click can choose the first screen.
    void listen<string>('pedro:navigate', event => {
      if (!['home', 'routine', 'finance', 'appearance'].includes(event.payload)) return;
      const url = new URL(location.href); url.searchParams.set('page', event.payload);
      history.replaceState(null, '', url);
      window.dispatchEvent(new CustomEvent('pedro:navigate', { detail: event.payload }));
    }).then(unlisten => { if (cancelled) unlisten(); else cleanup = unlisten; }).catch(() => {});
    return () => { cancelled = true; cleanup?.(); };
  }, [label]);
  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      document.documentElement.dataset.theme = preferences.theme === 'system' ? (scheme.matches ? 'dark' : 'light') : preferences.theme;
      document.documentElement.dataset.accent = preferences.accent;
      document.documentElement.dataset.reducedMotion = String(preferences.reduceMotion || motion.matches);
    };
    apply(); scheme.addEventListener('change', apply); motion.addEventListener('change', apply);
    return () => { scheme.removeEventListener('change', apply); motion.removeEventListener('change', apply); };
  }, [preferences.theme, preferences.accent, preferences.reduceMotion]);
  useEffect(() => {
    if (!label) return;
    let cancelled = false; let disposeBridge: (() => void) | undefined; let disposePreferences: (() => void) | undefined;
    setPhase('loading');
    const boot = async () => {
      disposeBridge = await initializeStateBridge();
      disposePreferences = await initializePreferencesSync();
      if (cancelled) { disposeBridge(); disposePreferences(); return; }
      await Promise.all([useFocusStore.getState().loadInitialData(), useFinanceStore.getState().loadFinancialData()]);
      if (!cancelled) setPhase('ready');
    };
    void boot().catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; disposeBridge?.(); disposePreferences?.(); };
  }, [label, attempt]);
  useEffect(() => {
    if (label && label !== 'dock') void setDockVisible(preferences.dockEnabled).catch(() => {});
  }, [label, preferences.dockEnabled]);
  if (label === 'island' || label === 'dock') {
    if (phase !== 'ready') return <div className={`desktop-widget-shell ${label}-shell`}>
      <div className="widget-boot" role={phase === 'error' ? 'alert' : 'status'}>
        <span><strong>{phase === 'error' ? 'Não foi possível abrir seus dados' : 'Preparando seu espaço…'}</strong>
          {phase === 'error' && <small>Seus registros não foram substituídos.</small>}</span>
        {phase === 'error' && <><button className="widget-icon-button" type="button" aria-label="Carregar novamente" onClick={() => setAttempt(a => a + 1)}><RefreshCw size={15} /></button>
          <button className="widget-icon-button" type="button" aria-label="Abrir painel" onClick={() => { void requestPage('home').catch(() => {}); }}><ArrowUpRight size={16} /></button></>}
      </div>
    </div>;
  }
  if (phase === 'error') return <div className="boot-screen"><div className="panel boot-card"><span className="brand-mark">p<span /></span><h1>Vamos tentar novamente</h1>
    <p>Não foi possível abrir seus dados. Eles não foram substituídos. Tente reabrir o aplicativo ou carregar novamente.</p>
    <button type="button" className="button primary" onClick={() => setAttempt(a => a + 1)}><RefreshCw size={16} />Carregar novamente</button></div></div>;
  if (phase !== 'ready' || !label) return <div className="boot-screen" role="status"><span className="brand-mark">p<span /></span><span>Preparando seu espaço…</span></div>;
  if (label === 'island') return <DynamicIsland />;
  if (label === 'dock') return <DesktopDock />;
  return <MainDashboard />;
}
