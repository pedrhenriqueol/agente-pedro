import { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { House, Focus, Wallet, Music2, SlidersHorizontal, ArrowRight, Command, HardDrive } from 'lucide-react';
import { CustomTitleBar } from './CustomTitleBar';
import { RoutineModule } from './RoutineModule';
import { FinanceModule } from './FinanceModule';
import { HomePage } from './HomePage';
import { AppearancePage } from './AppearancePage';
import { MusicPage } from './MusicPage';
import { Dialog } from './ui/Dialog';
import type { Page } from '../lib/desktop';

const PAGES = [
  { id: 'home', name: 'Hoje', detail: 'Prioridades e visão do dia', Icon: House },
  { id: 'routine', name: 'Rotinas e foco', detail: 'Tarefas, hábitos e Pomodoro', Icon: Focus },
  { id: 'finance', name: 'Finanças', detail: 'Contas, gastos e limites', Icon: Wallet },
  { id: 'music', name: 'Música', detail: 'Sua reprodução e controles do Windows', Icon: Music2 },
  { id: 'appearance', name: 'Aparência', detail: 'Seu espaço do seu jeito', Icon: SlidersHorizontal },
] as const;
function isPage(value: unknown): value is Page { return PAGES.some(p => p.id === value); }

export function MainDashboard() {
  const initial = new URLSearchParams(location.search).get('page');
  const [page, setPage] = useState<Page>(isPage(initial) ? initial : 'home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = (next: Page) => {
    setPage(next);
    const url = new URL(location.href); url.searchParams.set('page', next); history.replaceState(null, '', url);
    window.dispatchEvent(new CustomEvent('pedro:page', { detail: next }));
    if ('__TAURI_INTERNALS__' in window) void emit('pedro:page', next).catch(() => {});
  };
  useEffect(() => {
    const receive = (event: Event) => { const target = (event as CustomEvent).detail; if (isPage(target)) navigate(target); };
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault(); setQuery(''); setSearchOpen(true);
      }
    };
    window.addEventListener('pedro:navigate', receive); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pedro:navigate', receive); window.removeEventListener('keydown', key); };
  }, []);
  const commands = PAGES.filter(p => (p.name + ' ' + p.detail).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  return <div className="app-shell">
    <CustomTitleBar onSearch={() => { setQuery(''); setSearchOpen(true); }} />
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-mark">p<span /></span><div><strong>Pedro</strong><span>Seu espaço pessoal</span></div></div>
        <span className="sidebar-label">Sua rotina</span>
        <nav aria-label="Áreas do aplicativo">{PAGES.map(({ id, name, Icon }) =>
          <button key={id} type="button" className={'nav-item ' + (page === id ? 'active' : '')} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19} aria-hidden="true" /><span>{name}</span>{page === id && <span className="nav-active-dot" />}</button>)}</nav>
        <div className="sidebar-note"><HardDrive size={17} /><p>Tudo que você registra fica neste dispositivo.</p></div>
        <button type="button" className="sidebar-search" onClick={() => { setQuery(''); setSearchOpen(true); }}><Command size={16} /><span>Buscar uma ação</span><kbd>Ctrl K</kbd></button>
      </aside>
      <main className="app-main" id="main-content"><div key={page} className="page-content">
        {page === 'home' && <HomePage onNavigate={navigate} />}
        {page === 'routine' && <RoutineModule />}
        {page === 'finance' && <FinanceModule />}
        {page === 'music' && <MusicPage />}
        {page === 'appearance' && <AppearancePage />}
      </div></main>
    </div>
    {searchOpen && <Dialog title="Por onde vamos começar?" description="Encontre uma área para cuidar da sua rotina." onClose={() => setSearchOpen(false)}>
      <label htmlFor="command-search" className="sr-only">Buscar área ou ação</label><input id="command-search" className="field" placeholder="Tarefas, foco, finanças, aparência…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="command-list">{commands.map(({ id, name, detail, Icon }) => <button key={id} type="button" className="command-item" onClick={() => { setSearchOpen(false); navigate(id); }}><Icon size={21} /><span><strong>{name}</strong><small>{detail}</small></span><ArrowRight size={17} /></button>)}
        {!commands.length && <p className="empty-state">Nenhuma área encontrada. Tente “foco” ou “finanças”.</p>}</div>
    </Dialog>}
  </div>;
}
