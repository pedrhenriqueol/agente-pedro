import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { emit } from '@tauri-apps/api/event';
import { House, Focus, Wallet, Music2, SlidersHorizontal, ArrowRight, Command, HardDrive, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { CustomTitleBar } from './CustomTitleBar';
import { PedroMascot } from './PedroMascot';
import { RoutineModule } from './RoutineModule';
import { FinanceModule } from './FinanceModule';
import { HomePage } from './HomePage';
import { AppearancePage } from './AppearancePage';
import { MusicPage } from './MusicPage';
import { Dialog } from './ui/Dialog';
import { PageTransition } from './ui/PageTransition';
import { SelectionIndicator } from './ui/SelectionIndicator';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import type { Page } from '../lib/desktop';
import '../styles/navigation.css';
import '../styles/command-palette.css';

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
  const [activeCommand, setActiveCommand] = useState(0);
  const sidebarCollapsed = usePreferencesStore(state => state.sidebarCollapsed);
  const reduceMotion = usePreferencesStore(state => state.reduceMotion);
  const updatePreferences = usePreferencesStore(state => state.updatePreferences);
  const main = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const commandInput = useRef<HTMLInputElement>(null);
  const openSearch = useCallback(() => {
    setQuery(''); setActiveCommand(0); setSearchOpen(true);
  }, []);
  const navigate = useCallback((next: Page) => {
    // Native requests also dismiss the palette, including requests for the same
    // area, before a retained page can restore its own modal and focus trap.
    setSearchOpen(false);
    // A native destination may arrive while a form has focus. Move only focus
    // belonging to the outgoing page; sidebar and search interactions retain theirs.
    const focused = document.activeElement;
    const slot = focused instanceof HTMLElement ? focused.closest<HTMLElement>('[data-page]') : null;
    if (slot && main.current?.contains(slot) && slot.dataset.page !== next) {
      nav.current?.querySelector<HTMLButtonElement>(`[data-destination="${next}"]`)?.focus({ preventScroll: true });
    }
    setPage(next);
    const url = new URL(location.href); url.searchParams.set('page', next); history.replaceState(null, '', url);
    window.dispatchEvent(new CustomEvent('pedro:page', { detail: next }));
    if ('__TAURI_INTERNALS__' in window) void emit('pedro:page', next).catch(() => {});
  }, []);
  useEffect(() => { document.title = `${PAGES.find(area => area.id === page)!.name} · Agente Pedro`; }, [page]);
  useEffect(() => {
    // The generic dialog initially focuses its close control. Search is an
    // explicit local interaction: give its field focus after that lock is set.
    if (searchOpen && document.hasFocus()) commandInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  useEffect(() => {
    const receive = (event: Event) => { const target = (event as CustomEvent).detail; if (isPage(target)) navigate(target); };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault(); openSearch();
      }
    };
    window.addEventListener('pedro:navigate', receive); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pedro:navigate', receive); window.removeEventListener('keydown', key); };
  }, [navigate, openSearch]);
  const commands = PAGES.filter(p => (p.name + ' ' + p.detail).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const selectedCommand = Math.min(activeCommand, Math.max(0, commands.length - 1));
  function commandKeys(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!searchOpen || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !commands.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) navigate(commands[selectedCommand].id);
      return;
    }
    const next = event.key === 'ArrowDown' ? (selectedCommand + 1) % commands.length
      : event.key === 'ArrowUp' ? (selectedCommand - 1 + commands.length) % commands.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? commands.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActiveCommand(next);
  }
  return <div className={`app-shell${sidebarCollapsed ? ' has-collapsed-sidebar' : ''}`}>
    <CustomTitleBar onSearch={openSearch} />
    <div className="app-layout">
      <aside className="sidebar" aria-label="Navegação do Pedro">
        <div className="sidebar-brand"><PedroMascot className="brand-mark" /><div className="sidebar-brand-copy"><strong>Pedro</strong><span>Seu espaço pessoal</span></div></div>
        <span className="sidebar-label">Sua rotina</span>
        <nav ref={nav} id="area-navigation" aria-label="Áreas do aplicativo">{PAGES.map(({ id, name, Icon }) =>
          <button key={id} type="button" className={'nav-item ' + (page === id ? 'active' : '')} data-destination={id}
            aria-label={name} title={sidebarCollapsed ? name : undefined} aria-current={page === id ? 'page' : undefined}
            onClick={() => navigate(id)}><Icon size={19} aria-hidden="true" /><span className="nav-label">{name}</span></button>)}
          <SelectionIndicator owner={nav} selection={page} selector="[aria-current='page']" className="nav-selection-indicator" axis="vertical" />
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-note" title={sidebarCollapsed ? 'Dados salvos neste dispositivo' : undefined}><HardDrive size={17} aria-hidden="true" /><p>Tudo que você registra fica neste dispositivo.</p></div>
          <button type="button" className="sidebar-toggle" aria-controls="area-navigation" aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'} title={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
            onClick={() => updatePreferences({ sidebarCollapsed: !sidebarCollapsed })}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}<span>Recolher navegação</span>
          </button>
          <button type="button" className="sidebar-search" aria-label="Buscar uma ação" title={sidebarCollapsed ? 'Buscar uma ação · Ctrl K' : undefined}
            onClick={openSearch}><Command size={16} aria-hidden="true" /><span>Buscar uma ação</span><kbd>Ctrl K</kbd></button>
        </div>
      </aside>
      <main ref={main} className="app-main" id="main-content">
        <PageTransition page={page} reduceMotion={reduceMotion} label={id => PAGES.find(area => area.id === id)!.name}>
          {id => id === 'home' ? <HomePage onNavigate={navigate} /> : id === 'routine' ? <RoutineModule />
            : id === 'finance' ? <FinanceModule /> : id === 'music' ? <MusicPage /> : <AppearancePage />}
        </PageTransition>
      </main>
    </div>
    <Dialog open={searchOpen} className="command-palette" title="Por onde vamos começar?" description="Encontre uma área para cuidar da sua rotina." onClose={() => setSearchOpen(false)}>
      <label htmlFor="command-search" className="sr-only">Buscar área ou ação</label><input ref={commandInput} id="command-search" className="field" placeholder="Tarefas, foco, finanças, aparência…" value={query}
        aria-controls="command-results" aria-describedby="command-help command-selection" autoComplete="off"
        onChange={event => { setQuery(event.target.value); setActiveCommand(0); }} onKeyDown={commandKeys} />
      <div id="command-results" className="command-list" role="group" aria-label="Áreas encontradas">{commands.map(({ id, name, detail, Icon }, index) => <button key={id} type="button" className="command-item"
        data-active={index === selectedCommand || undefined}
        onPointerEnter={() => { if (document.activeElement === commandInput.current) setActiveCommand(index); }}
        onFocus={() => setActiveCommand(index)} onClick={() => navigate(id)}>
        <Icon size={21} aria-hidden="true" /><span><strong>{name}</strong><small>{detail}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
        {!commands.length && <p className="empty-state">Nenhuma área encontrada. Tente “foco” ou “finanças”.</p>}</div>
      <p id="command-help" className="command-help"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></p>
      <p id="command-selection" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{searchOpen && (commands.length
        ? `${commands[selectedCommand].name}, resultado ${selectedCommand + 1} de ${commands.length}. Enter para abrir.` : 'Nenhuma área encontrada.')}</p>
    </Dialog>
  </div>;
}
