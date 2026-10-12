import { useEffect, useState, type CSSProperties } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { House, ListTodo, Palette, Wallet, type LucideIcon } from 'lucide-react';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { requestPage, type DesktopPage } from '../lib/desktop';
import '../styles/desktop.css';

const sections: { page: DesktopPage; label: string; description: string; icon: LucideIcon }[] = [
  { page: 'home', label: 'Hoje', description: 'Visão do seu dia', icon: House },
  { page: 'routine', label: 'Rotinas', description: 'Tarefas, hábitos e foco', icon: ListTodo },
  { page: 'finance', label: 'Finanças', description: 'Contas e movimentações', icon: Wallet },
  { page: 'appearance', label: 'Aparência', description: 'Deixe o Pedro do seu jeito', icon: Palette },
];

export function DesktopDock() {
  const [selected, setSelected] = useState<DesktopPage>('home');
  const [error, setError] = useState('');
  const { dockEnabled, dockOpacity, reduceMotion } = usePreferencesStore();

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(''), 4500);
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    listen<DesktopPage>('pedro:page', ({ payload }) => {
      if (sections.some(({ page }) => page === payload)) setSelected(payload);
    }).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten; }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, []);

  async function navigate(page: DesktopPage) {
    try { await requestPage(page); setSelected(page); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o painel.'); }
  }

  if (!dockEnabled) return null;

  return (
    <div className="desktop-widget-shell dock-shell" data-reduce-motion={reduceMotion} style={{ '--widget-opacity': dockOpacity } as CSSProperties}>
      <nav className="pedro-dock" aria-label="Atalhos do Pedro">
        {sections.map(({ page, label, description, icon: Icon }) => (
          <button type="button" key={page} className={`dock-item ${selected === page ? 'is-selected' : ''}`} onClick={() => navigate(page)} aria-current={selected === page ? 'page' : undefined} title={description}><span className="dock-icon"><Icon size={19} strokeWidth={1.7} /></span><span>{label}</span><i className="dock-active-dot" aria-hidden="true" /></button>
        ))}
      </nav>
      {error && <p className="widget-error" role="alert">{error}</p>}
    </div>
  );
}
