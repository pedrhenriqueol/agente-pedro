import { Moon, Sun, Monitor, Palette, RotateCcw, Clock3, Focus, Wallet, Minus, Eye, EyeOff, Sparkles } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useFocusStore } from '../stores/useFocusStore';
import { formatCentsToBRL, useFinanceStore } from '../stores/useFinanceStore';

export function AppearancePage() {
  const p = usePreferencesStore();
  const focus = useFocusStore();
  const finance = useFinanceStore();
  const hybrid = p.islandVisibility === 'hybrid';
  const visibilityOptions = [{ value: 'fixed', label: 'Fixa', detail: 'Sempre visível sobre o desktop.', Icon: Eye },
    { value: 'hybrid', label: 'Híbrida', detail: 'Esconde por inatividade ou quando outro app ocupa a tela.', Icon: EyeOff }] as const;
  const themeOptions = [{ value: 'dark', label: 'Escuro', Icon: Moon }, { value: 'light', label: 'Claro', Icon: Sun }, { value: 'system', label: 'Sistema', Icon: Monitor }] as const;
  const idleOptions = [{ value: 'clock', label: 'Relógio', detail: 'Hora local, sempre à mão.', Icon: Clock3 },
    { value: 'focus', label: 'Foco', detail: 'Sua sessão e o tempo restante.', Icon: Focus },
    { value: 'balance', label: 'Finanças', detail: 'Saldo das suas contas.', Icon: Wallet },
    { value: 'minimal', label: 'Discreto', detail: 'Somente a presença do Pedro.', Icon: Minus }] as const;
  const timer = String(Math.floor(focus.remainingSeconds / 60)).padStart(2, '0') + ':' + String(focus.remainingSeconds % 60).padStart(2, '0');
  return <div className="settings-page">
    <header className="page-heading"><span className="eyebrow">Seu espaço, do seu jeito</span><h1>Aparência</h1><p>Escolha como o Pedro acompanha sua rotina. As preferências valem para a janela, a ilha e o dock.</p></header>
    <div className="settings-grid">
      <div className="settings-sections">
        <section className="panel"><div className="panel-heading"><div><h2>Tema e cor</h2><p className="muted">Conforto para cada momento do dia.</p></div><Palette size={20} className="muted" /></div>
          <fieldset className="settings-fieldset"><legend className="label">Tema do aplicativo</legend><div className="choice-row">{themeOptions.map(({ value, label, Icon }) =>
            <label className={'choice ' + (p.theme === value ? 'selected' : '')} key={value}><input type="radio" name="theme" value={value} checked={p.theme === value}
              onChange={() => p.updatePreferences({ theme: value })} /><Icon size={17} aria-hidden="true" /><span>{label}</span></label>)}</div></fieldset>
          <fieldset className="settings-fieldset"><legend className="label">Cor de destaque</legend><div className="accent-choices">{([{ value: 'mint', label: 'Verde', color: '#3fc8a5' }, { value: 'violet', label: 'Violeta', color: '#a78bfa' }, { value: 'blue', label: 'Azul', color: '#66aaff' }] as const).map(o =>
            <label className={'accent-choice ' + (p.accent === o.value ? 'selected' : '')} key={o.value}><input type="radio" name="accent" value={o.value} checked={p.accent === o.value}
              onChange={() => p.updatePreferences({ accent: o.value })} /><span style={{ background: o.color }} /><span>{o.label}</span></label>)}</div></fieldset>
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Ilha no desktop</h2><p className="muted">O que você quer ver enquanto trabalha?</p></div><Eye size={20} className="muted" /></div>
          <fieldset className="settings-fieldset" aria-describedby={hybrid ? 'island-visibility-help' : undefined}><legend className="label">Visibilidade da ilha</legend><div className="idle-choices">{visibilityOptions.map(({ value, label, detail, Icon }) =>
            <label className={'idle-choice ' + (p.islandVisibility === value ? 'selected' : '')} key={value}><input type="radio" name="island-visibility" value={value} checked={p.islandVisibility === value}
              onChange={() => p.updatePreferences({ islandVisibility: value })} /><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
          <div className="island-delay-setting"><label htmlFor="island-hide-delay">Esconder após</label>
            <select id="island-hide-delay" className="field" value={p.islandHideDelay} disabled={!hybrid} onChange={event => p.updatePreferences({ islandHideDelay: Number(event.target.value) as 3 | 5 | 10 })}>
              <option value={3}>3 segundos</option><option value={5}>5 segundos</option><option value={10}>10 segundos</option>
            </select></div>
          {hybrid && <p className="settings-help" id="island-visibility-help">Para revelar, mantenha o mouse no centro da borda superior por um instante. Seu foco e sua música continuam quando a ilha está escondida.</p>}
          {!isTauri() && <p className="settings-help">O modo híbrido funciona no aplicativo para Windows. Esta prévia no navegador não controla as outras janelas.</p>}
          <fieldset className="settings-fieldset"><legend className="label">Conteúdo da ilha em repouso</legend><div className="idle-choices">{idleOptions.map(({ value, label, detail, Icon }) =>
            <label className={'idle-choice ' + (p.islandIdle === value ? 'selected' : '')} key={value}><input type="radio" name="island" value={value} checked={p.islandIdle === value}
              onChange={() => p.updatePreferences({ islandIdle: value })} /><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></fieldset>
          <label className="slider-label" htmlFor="island-opacity"><span>Opacidade da ilha</span><output>{Math.round(p.islandOpacity * 100)}%</output></label>
          <input id="island-opacity" className="range-input" type="range" min="55" max="100" value={Math.round(p.islandOpacity * 100)} onChange={e => p.updatePreferences({ islandOpacity: Number(e.target.value) / 100 })} />
        </section>
        <section className="panel"><div className="preference-row"><div><h2>Dock de atalhos</h2><p className="muted">Abra suas áreas sem interromper o que está fazendo.</p></div>
          <label className="switch"><input type="checkbox" aria-label="Mostrar dock no desktop" checked={p.dockEnabled} onChange={e => p.updatePreferences({ dockEnabled: e.target.checked })} /><span /></label></div>
          <label className="slider-label" htmlFor="dock-opacity"><span>Opacidade do dock</span><output>{Math.round(p.dockOpacity * 100)}%</output></label>
          <input id="dock-opacity" className="range-input" type="range" min="55" max="100" disabled={!p.dockEnabled} value={Math.round(p.dockOpacity * 100)} onChange={e => p.updatePreferences({ dockOpacity: Number(e.target.value) / 100 })} />
        </section>
        <section className="panel"><div className="preference-row"><div><h2>Movimento mais discreto</h2><p className="muted">Reduza as animações. A preferência do sistema também é respeitada.</p></div>
          <label className="switch"><input type="checkbox" aria-label="Reduzir animações" checked={p.reduceMotion} onChange={e => p.updatePreferences({ reduceMotion: e.target.checked })} /><span /></label></div></section>
      </div>
      <aside className="settings-preview"><div className="panel"><span className="eyebrow">Uma presença tranquila</span><h2>Pedro, por perto</h2>
        <div className="island-preview" style={{ opacity: p.islandOpacity }} aria-label="Prévia da ilha"><span className="presence-dot" />
          {p.islandIdle === 'clock' ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : p.islandIdle === 'focus' ? timer : p.islandIdle === 'balance' ? formatCentsToBRL(finance.consolidated.total_balance_cents) : <span className="preview-mark">p</span>}
          <span className="preview-handle" /></div><p className="muted">Expanda a ilha para controlar o foco e abrir suas áreas. Suas atividades continuam na janela principal.</p>
        <div className="settings-tip"><Sparkles size={17} /><p>Menos distração, mais espaço para a sua rotina.</p></div>
        <button className="button ghost" type="button" onClick={p.resetPreferences}><RotateCcw size={15} />Restaurar preferências</button>
      </div></aside>
    </div>
  </div>;
}
