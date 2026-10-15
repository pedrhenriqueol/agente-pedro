import { useRef, useState, type KeyboardEvent } from 'react';
import { Moon, Sun, Monitor, Palette, Clock3, Focus, Wallet, Minus, Eye, EyeOff, Sparkles, Navigation, Accessibility, PanelLeftClose, Layers } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { RetainedTransition } from './ui/PageTransition';
import { SelectionIndicator } from './ui/SelectionIndicator';
import { AnimatedDisclosure } from './ui/AnimatedDisclosure';
import { AppearancePreview } from './AppearancePreview';
import '../styles/appearance-motion.css';
import '../styles/appearance-redesign.css';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { ACCENT_COLORS } from '../lib/preferenceAppearance';

const sections = [
  { id: 'island', label: 'Ilha', Icon: Sparkles },
  { id: 'navigation', label: 'Navegação', Icon: Navigation },
  { id: 'appearance', label: 'Aparência', Icon: Palette },
  { id: 'accessibility', label: 'Acessibilidade', Icon: Accessibility },
] as const;
type Section = typeof sections[number]['id'];
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
const sizeOptions = [
  { value: 'small', label: 'Pequena' }, { value: 'medium', label: 'Média' }, { value: 'large', label: 'Grande' },
] as const;
const toneOptions = [
  { value: 'graphite', label: 'Grafite', color: '#151923' },
  { value: 'midnight', label: 'Meia-noite', color: '#1d2b46' },
  { value: 'emerald', label: 'Verde profundo', color: '#163a30' },
] as const;
const accentOptions = [
  { value: 'mint', label: 'Verde' }, { value: 'violet', label: 'Violeta' },
  { value: 'blue', label: 'Azul' }, { value: 'amber', label: 'Âmbar' }, { value: 'rose', label: 'Rosa' },
] as const;

export function AppearancePage() {
  const p = usePreferencesStore();
  const [section, setSection] = useState<Section>('island');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabStrip = useRef<HTMLDivElement>(null);
  const hybrid = p.islandVisibility === 'hybrid';

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
            <fieldset className="settings-fieldset"><legend className="label">Tamanho ao expandir</legend><div className="choice-row settings-island-sizes">{sizeOptions.map(({ value, label }) =>
              <label className={'choice ' + (p.islandSize === value ? 'selected' : '')} key={value}><input type="radio" name="island-size" value={value} checked={p.islandSize === value}
                onChange={() => p.updatePreferences({ islandSize: value })} /><span>{label}</span></label>)}</div></fieldset>
            <div className="preference-row settings-preference"><div><h2>Expandir ao aproximar o mouse</h2><p className="muted">Os controles aparecem quando você chega à ilha e recolhem ao sair.</p></div>
              <label className="switch"><input type="checkbox" aria-label="Expandir ao aproximar o mouse" checked={p.islandHoverExpand} onChange={event => p.updatePreferences({ islandHoverExpand: event.target.checked })} /><span /></label></div>
            <fieldset className="settings-fieldset"><legend className="label">Quando não há atividade</legend><div className="idle-choices">{idleOptions.map(({ value, label, detail, Icon }) =>
              <label className={'idle-choice ' + (p.islandIdle === value ? 'selected' : '')} key={value}><input type="radio" name="island" value={value} checked={p.islandIdle === value}
                onChange={() => p.updatePreferences({ islandIdle: value })} /><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
            <p className="settings-help">Durante uma sessão, o foco tem prioridade. A música aparece quando não há foco em andamento.</p>
            <AnimatedDisclosure title="Acabamento da ilha" reduceMotion={p.reduceMotion}>
              <fieldset className="settings-fieldset"><legend className="label">Cor da superfície</legend><div className="accent-choices settings-surface-tones">{toneOptions.map(({ value, label, color }) =>
                <label className={'accent-choice ' + (p.islandTone === value ? 'selected' : '')} key={value}><input type="radio" name="island-tone" value={value} checked={p.islandTone === value}
                  onChange={() => p.updatePreferences({ islandTone: value })} /><span style={{ background: color }} /><span>{label}</span></label>)}</div></fieldset>
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
            <div className="preference-row settings-preference"><div><h2>Controles nos cantos superiores</h2><p className="muted">Aparência e atalhos à esquerda, volume à direita.</p></div>
              <label className="switch"><input type="checkbox" aria-label="Mostrar controles nos cantos superiores" checked={p.topControlsEnabled} onChange={event => p.updatePreferences({ topControlsEnabled: event.target.checked })} /><span /></label></div>
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
            <fieldset className="settings-fieldset"><legend className="label">Cor de destaque</legend><div className="accent-choices settings-redesign-accents">{accentOptions.map(option =>
              <label className={'accent-choice ' + (p.accent === option.value ? 'selected' : '')} key={option.value}><input type="radio" name="accent" value={option.value} checked={p.accent === option.value}
                onChange={() => p.updatePreferences({ accent: option.value })} /><span style={{ background: ACCENT_COLORS[option.value].dark }} /><span>{option.label}</span></label>)}
              <label className={'accent-choice ' + (p.accent === 'custom' ? 'selected' : '')}><input type="radio" name="accent" value="custom" checked={p.accent === 'custom'}
                onChange={() => p.updatePreferences({ accent: 'custom' })} /><span className="settings-custom-color-mark" /><span>Personalizada</span></label>
            </div></fieldset>
            {p.accent === 'custom' && <div className="settings-custom-color"><label htmlFor="settings-custom-accent">Sua cor de destaque</label>
              <input id="settings-custom-accent" type="color" value={p.customAccent} onChange={event => p.updatePreferences({ customAccent: event.target.value })} />
              <output htmlFor="settings-custom-accent">{p.customAccent.toUpperCase()}</output>
              <p className="settings-help">A intensidade se ajusta para manter textos e controles legíveis.</p>
            </div>}
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

      <AppearancePreview />
    </div>
  </div>;
}
