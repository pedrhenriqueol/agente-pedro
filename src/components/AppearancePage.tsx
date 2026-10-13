import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Moon, Sun, Monitor, Palette, RotateCcw, Clock3, Focus, Wallet, Minus, Eye, EyeOff, Sparkles, Navigation, Accessibility, ChevronDown, Music2, Pause, Play, PanelLeftClose, Layers } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { RetainedTransition } from './ui/PageTransition';
import { SelectionIndicator } from './ui/SelectionIndicator';
import { AnimatedDisclosure } from './ui/AnimatedDisclosure';
import '../styles/appearance-motion.css';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useFocusStore } from '../stores/useFocusStore';
import { formatCentsToBRL, useFinanceStore } from '../stores/useFinanceStore';
import { useMediaStore } from '../stores/useMediaStore';

const sections = [
  { id: 'island', label: 'Ilha', Icon: Sparkles },
  { id: 'navigation', label: 'Navegação', Icon: Navigation },
  { id: 'appearance', label: 'Aparência', Icon: Palette },
  { id: 'accessibility', label: 'Acessibilidade', Icon: Accessibility },
] as const;
type Section = typeof sections[number]['id'];
type Preview = 'current' | 'focus' | 'music' | 'idle';
const visibilityOptions = [
  { value: 'fixed', label: 'Fixa', detail: 'Sempre por perto no desktop.', Icon: Eye },
  { value: 'hybrid', label: 'Híbrida', detail: 'Sai de cena quando você usa outros apps.', Icon: EyeOff },
] as const;
const idleOptions = [
  { value: 'clock', label: 'Relógio', detail: 'Hora local, sempre à mão.', Icon: Clock3 },
  { value: 'focus', label: 'Foco', detail: 'Sua sessão e o tempo restante.', Icon: Focus },
  { value: 'balance', label: 'Finanças', detail: 'Saldo das suas contas.', Icon: Wallet },
  { value: 'minimal', label: 'Discreto', detail: 'Somente a presença do Pedro.', Icon: Minus },
] as const;
const themeOptions = [
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'system', label: 'Sistema', Icon: Monitor },
] as const;

export function AppearancePage() {
  const p = usePreferencesStore();
  const focus = useFocusStore();
  const finance = useFinanceStore();
  const media = useMediaStore();
  const [section, setSection] = useState<Section>('island');
  const [preview, setPreview] = useState<Preview>('current');
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabStrip = useRef<HTMLDivElement>(null);
  const hybrid = p.islandVisibility === 'hybrid';
  const active = focus.pomodoroState === 'focus' || focus.pomodoroState === 'break';
  const focusPresent = active || focus.pomodoroState === 'paused' || focus.sessionSaveState === 'saving' || focus.sessionSaveState === 'error';
  const session = media.displaySession;
  const currentMode = focusPresent ? 'focus' : session ? 'music' : focus.pomodoroState === 'completed' ? 'focus' : p.islandIdle;
  const previewMode = preview === 'current' ? currentMode : preview === 'idle' ? p.islandIdle : preview;
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

  useEffect(() => {
    const interval = window.setInterval(() => setTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })), 10000);
    return () => window.clearInterval(interval);
  }, []);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === 'ArrowRight') target = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = sections.length - 1;
    else return;
    event.preventDefault();
    setSection(sections[target].id);
    tabRefs.current[target]?.focus();
  }

  return <div className="settings-page">
    <header className="page-heading"><span className="eyebrow">Seu espaço, do seu jeito</span><h1>Aparência</h1><p>Uma presença discreta, no ritmo da sua rotina.</p></header>
    <div ref={tabStrip} className="settings-tabs" role="tablist" aria-label="Preferências do Pedro">
      {sections.map(({ id, label, Icon }, index) => <button key={id} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab"
        id={`settings-tab-${id}`} aria-selected={section === id} aria-controls={`settings-section-${id}`} tabIndex={section === id ? 0 : -1}
        onClick={() => setSection(id)} onKeyDown={event => moveTab(event, index)}><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}
      <SelectionIndicator owner={tabStrip} selection={section} selector="[aria-selected='true']" className="settings-selection-indicator" />
    </div>
    <div className="settings-grid">
      <div className="settings-sections">
        <RetainedTransition value={section} reduceMotion={p.reduceMotion} containerClassName="settings-category-presence"
          sectionClassName="settings-section-content" slotAttribute="data-section" measureHeight
          values={sections.map(item => item.id)} tabId={id => `settings-tab-${id}`} panelId={id => `settings-section-${id}`}>
          {category => <>
          {category === 'island' && <section className="panel">
            <div className="panel-heading"><div><h2>Seu espaço no desktop</h2><p className="muted">A ilha acompanha sua atividade sem ocupar mais do que precisa.</p></div><Sparkles size={20} className="muted" aria-hidden="true" /></div>
            <fieldset className="settings-fieldset" aria-describedby={hybrid ? 'island-visibility-help' : undefined}><legend className="label">Visibilidade</legend><div className="idle-choices">{visibilityOptions.map(({ value, label, detail, Icon }) =>
              <label className={'idle-choice ' + (p.islandVisibility === value ? 'selected' : '')} key={value}><input type="radio" name="island-visibility" value={value} checked={p.islandVisibility === value}
                onChange={() => p.updatePreferences({ islandVisibility: value })} /><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
            {hybrid && <>
              <div className="island-delay-setting"><label htmlFor="island-hide-delay">Esconder após</label><select id="island-hide-delay" className="field" value={p.islandHideDelay}
                onChange={event => p.updatePreferences({ islandHideDelay: Number(event.target.value) as 3 | 5 | 10 })}><option value={3}>3 segundos</option><option value={5}>5 segundos</option><option value={10}>10 segundos</option></select></div>
              <p className="settings-help" id="island-visibility-help">Sem interação, ou quando outro app ocupa a tela, a ilha se esconde. Aproxime o mouse do lugar da ilha, no topo, para ela voltar. Foco e música continuam.</p>
            </>}
            {!isTauri() && <p className="settings-help">A visibilidade híbrida funciona no aplicativo para Windows.</p>}
            <fieldset className="settings-fieldset"><legend className="label">Quando não há atividade</legend><div className="idle-choices">{idleOptions.map(({ value, label, detail, Icon }) =>
              <label className={'idle-choice ' + (p.islandIdle === value ? 'selected' : '')} key={value}><input type="radio" name="island" value={value} checked={p.islandIdle === value}
                onChange={() => p.updatePreferences({ islandIdle: value })} /><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
            <p className="settings-help">Durante uma sessão, o foco tem prioridade. A música aparece quando não há foco em andamento.</p>
            <AnimatedDisclosure title="Acabamento da ilha" reduceMotion={p.reduceMotion}>
              <label className="slider-label" htmlFor="island-opacity"><span>Opacidade da superfície</span><output>{Math.round(p.islandOpacity * 100)}%</output></label>
              <input id="island-opacity" className="range-input" type="range" min="55" max="100" value={Math.round(p.islandOpacity * 100)} onChange={event => p.updatePreferences({ islandOpacity: Number(event.target.value) / 100 })} />
              <p className="settings-help">Textos e controles mantêm seu contraste enquanto a superfície muda.</p>
            </AnimatedDisclosure>
          </section>}

          {category === 'navigation' && <section className="panel">
            <div className="panel-heading"><div><h2>Menos atalhos, mais espaço</h2><p className="muted">As áreas ficam reunidas no menu da ilha e no painel.</p></div><Navigation size={20} className="muted" aria-hidden="true" /></div>
            <div className="settings-shortcut"><span>Encontre uma área no painel</span><kbd>Ctrl + K</kbd></div>
            <div className="preference-row settings-preference"><div><h2>Recolher navegação do painel</h2><p className="muted">Mantenha os ícones à mão e dê mais espaço ao conteúdo.</p></div>
              <label className="switch"><input type="checkbox" aria-label="Recolher navegação do painel" checked={p.sidebarCollapsed} onChange={event => p.updatePreferences({ sidebarCollapsed: event.target.checked })} /><span /></label></div>
            <div className="preference-row settings-preference"><div><h2>Dock de atalhos</h2><p className="muted">Acesso permanente às áreas no desktop, quando você preferir.</p></div>
              <label className="switch"><input type="checkbox" aria-label="Mostrar dock no desktop" checked={p.dockEnabled} onChange={event => p.updatePreferences({ dockEnabled: event.target.checked })} /><span /></label></div>
            {p.dockEnabled && <AnimatedDisclosure title="Acabamento do dock" reduceMotion={p.reduceMotion}>
              <label className="slider-label" htmlFor="dock-opacity"><span>Opacidade do dock</span><output>{Math.round(p.dockOpacity * 100)}%</output></label>
              <input id="dock-opacity" className="range-input" type="range" min="55" max="100" value={Math.round(p.dockOpacity * 100)} onChange={event => p.updatePreferences({ dockOpacity: Number(event.target.value) / 100 })} />
            </AnimatedDisclosure>}
          </section>}

          {category === 'appearance' && <section className="panel">
            <div className="panel-heading"><div><h2>Cor e superfície</h2><p className="muted">Conforto visual para cada momento do dia.</p></div><Palette size={20} className="muted" aria-hidden="true" /></div>
            <fieldset className="settings-fieldset"><legend className="label">Tema do aplicativo</legend><div className="choice-row">{themeOptions.map(({ value, label, Icon }) =>
              <label className={'choice ' + (p.theme === value ? 'selected' : '')} key={value}><input type="radio" name="theme" value={value} checked={p.theme === value}
                onChange={() => p.updatePreferences({ theme: value })} /><Icon size={17} aria-hidden="true" /><span>{label}</span></label>)}</div></fieldset>
            <fieldset className="settings-fieldset"><legend className="label">Cor de destaque</legend><div className="accent-choices">{([{ value: 'mint', label: 'Verde', color: '#3fc8a5' }, { value: 'violet', label: 'Violeta', color: '#a78bfa' }, { value: 'blue', label: 'Azul', color: '#66aaff' }] as const).map(option =>
              <label className={'accent-choice ' + (p.accent === option.value ? 'selected' : '')} key={option.value}><input type="radio" name="accent" value={option.value} checked={p.accent === option.value}
                onChange={() => p.updatePreferences({ accent: option.value })} /><span style={{ background: option.color }} /><span>{option.label}</span></label>)}</div></fieldset>
            <AnimatedDisclosure title="Material do painel" reduceMotion={p.reduceMotion}>
              <fieldset className="settings-fieldset"><legend className="label">Superfície do painel</legend><div className="idle-choices">{([
                { value: 'system', label: 'Sistema', detail: 'Integração suave com o desktop.', Icon: Layers },
                { value: 'solid', label: 'Sólida', detail: 'Leitura consistente e menos efeitos.', Icon: Monitor },
              ] as const).map(({ value, label, detail, Icon }) => <label className={'idle-choice ' + (p.nativeMaterial === value ? 'selected' : '')} key={value}>
                <input type="radio" name="native-material" value={value} checked={p.nativeMaterial === value} onChange={() => p.updatePreferences({ nativeMaterial: value })} />
                <Icon size={18} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
              <p className="settings-help">O material do sistema se aplica ao painel no Windows 11 compatível. Em outros sistemas, o painel mantém uma superfície sólida.</p>
            </AnimatedDisclosure>
          </section>}

          {category === 'accessibility' && <section className="panel">
            <div className="panel-heading"><div><h2>No seu ritmo</h2><p className="muted">As mesmas ações, com menos movimento.</p></div><Accessibility size={20} className="muted" aria-hidden="true" /></div>
            <div className="preference-row"><div><h2>Reduzir animações</h2><p className="muted">Trocas diretas, sem deslocamentos ou efeitos prolongados.</p></div>
              <label className="switch"><input type="checkbox" aria-label="Reduzir animações" checked={p.reduceMotion} onChange={event => p.updatePreferences({ reduceMotion: event.target.checked })} /><span /></label></div>
            <p className="settings-help">A preferência de movimento reduzido do Windows também é respeitada.</p>
            <div className="settings-keyboard-help"><PanelLeftClose size={18} aria-hidden="true" /><p>Use Tab para navegar, Enter para ativar e Escape para fechar menus. Nas categorias acima, use as setas para alternar.</p></div>
          </section>}
          </>}
        </RetainedTransition>
      </div>

      <aside className="settings-preview" aria-label="Prévia das preferências"><div className="panel">
        <span className="eyebrow">Pedro, por perto</span><h2>Uma presença tranquila</h2>
        <div className="settings-preview-switch" role="group" aria-label="Conteúdo da prévia">{([
          { value: 'current', label: 'Agora' }, { value: 'focus', label: 'Foco' }, { value: 'music', label: 'Música' }, { value: 'idle', label: 'Repouso' },
        ] as const).map(option => <button type="button" key={option.value} aria-pressed={preview === option.value} onClick={() => setPreview(option.value)}>{option.label}</button>)}</div>
        <div className="settings-preview-desktop" style={{ '--settings-preview-opacity': p.islandOpacity } as CSSProperties}>
          <div className="settings-preview-island" aria-label="Prévia da ilha">
            <div className="settings-preview-identity"><span className="settings-preview-mark"><Sparkles size={14} aria-hidden="true" /></span><span>{time}</span></div>
            <div className="settings-preview-context">{previewMode === 'music' ? <>
              <span className="settings-preview-artwork">{artwork ? <img src={artwork} alt="" onError={() => setFailedArtwork(artwork)} /> : <Music2 size={15} aria-hidden="true" />}</span>
              <span>{session?.title || (media.presentationPhase === 'loading' ? 'Buscando…' : media.presentationPhase === 'unavailable' ? 'Indisponível' : 'Sem reprodução')}</span><span className={'presence-dot' + (media.presentationPhase === 'ready' && session?.playbackStatus === 'playing' ? ' is-active' : '')} />
            </> : previewMode === 'focus' ? <><span className={'presence-dot' + (active ? ' is-active' : '')} /><span>{focus.sessionSaveState === 'error' ? 'Registro pendente' : focus.sessionSaveState === 'saving' ? 'Registrando…' : focus.pomodoroState === 'completed' ? 'Concluído' : timer}</span></>
              : previewMode === 'balance' ? <><Wallet size={14} aria-hidden="true" /><span>{finance.accounts.length ? formatCentsToBRL(finance.consolidated.total_balance_cents) : 'Suas finanças'}</span></>
                : previewMode === 'minimal' ? <span>Pedro</span> : <span>Seu dia, com calma</span>}</div>
            <ChevronDown size={14} className="muted" aria-hidden="true" />
          </div>
          {previewMode === 'focus' && <div className="settings-preview-activity"><span className="settings-preview-caption">{focusStatus}</span><div className="settings-preview-focus"><strong>{timer}</strong><span className="settings-preview-play" aria-hidden="true">{active ? <Pause size={15} /> : <Play size={15} />}</span></div><p>{selectedTask?.title || (focus.currentMode === 'break' ? 'Respire. Você merece uma pausa.' : 'Escolha uma tarefa ou apenas comece.')}</p><div className="settings-preview-progress"><span style={{ transform: `scaleX(${progress})` }} /></div></div>}
          {previewMode === 'music' && <div className="settings-preview-activity"><span className="settings-preview-caption">{musicStatus}</span><div className="settings-preview-track"><span className="settings-preview-artwork is-large">{artwork ? <img src={artwork} alt="" onError={() => setFailedArtwork(artwork)} /> : <Music2 size={23} aria-hidden="true" />}</span><div><strong>{session?.title || emptyMusicTitle}</strong><p>{session?.artist || (session ? 'Artista não informado' : 'Dê play no navegador para ver sua faixa aqui.')}</p></div></div></div>}
          {p.dockEnabled && <div className="settings-preview-dock" aria-label="Dock ativado" style={{ '--settings-preview-dock-opacity': p.dockOpacity } as CSSProperties}><Sparkles size={14} /><Focus size={14} /><Music2 size={14} /><Wallet size={14} /></div>}
        </div>
        <div className="settings-preview-behavior"><span className="presence-dot" /><p>{hybrid ? `Híbrida · esconde após ${p.islandHideDelay} segundos sem interação` : 'Fixa · sempre visível no desktop'}</p></div>
        <p className="muted">A prévia usa suas atividades reais. Foco e música continuam enquanto você ajusta o visual.</p>
        <button className="button ghost settings-reset" type="button" onClick={p.resetPreferences}><RotateCcw size={14} />Restaurar preferências</button>
      </div></aside>
    </div>
  </div>;
}
