import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Accessibility, Check, ChevronRight, Layers, Palette, Sparkles, X } from 'lucide-react';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { ACCENT_COLORS, resolveAccentForeground } from '../lib/preferenceAppearance';
import { SelectionIndicator } from './ui/SelectionIndicator';
import '../styles/island-appearance.css';

interface IslandAppearanceProps {
  onOpenFull?: () => void;
  onClose?: () => void;
  idPrefix?: string;
}

function Segments<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  return <fieldset className="island-appearance-field">
    <legend>{label}</legend>
    <div ref={strip} className="island-appearance-segments">
      {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}>{option.label}</button>)}
      <SelectionIndicator owner={strip} selection={value} selector="[aria-pressed='true']" className="island-appearance-selection" />
    </div>
  </fieldset>;
}

const accents = [
  { value: 'mint', label: 'Esmeralda' }, { value: 'violet', label: 'Violeta' },
  { value: 'blue', label: 'Azul' }, { value: 'amber', label: 'Âmbar' },
  { value: 'rose', label: 'Rosa' },
] as const;
const tones = [
  { value: 'graphite', label: 'Grafite', color: '#151923' },
  { value: 'midnight', label: 'Meia-noite', color: '#1d2b46' },
  { value: 'emerald', label: 'Verde profundo', color: '#163a30' },
] as const;

/** Settings stay inside the island's native bounds; no overlay is placed over the desktop. */
export function IslandAppearance({ onOpenFull, onClose, idPrefix = 'island-appearance' }: IslandAppearanceProps) {
  const p = usePreferencesStore();
  const [draft, setDraft] = useState(p.customAccent);
  const [colorError, setColorError] = useState(false);
  useEffect(() => { setDraft(p.customAccent); setColorError(false); }, [p.customAccent]);

  function commitColor() {
    const color = draft.trim();
    if (!/^#[a-f\d]{6}$/i.test(color)) { setColorError(true); return; }
    setColorError(false);
    p.updatePreferences({ accent: 'custom', customAccent: color });
  }

  return <section className="island-appearance" aria-label="Personalizar ilha">
    <div className="island-appearance-heading">
      <span><Palette size={15} aria-hidden="true" /><strong>Aparência</strong></span>
      {onClose && <button type="button" className="island-appearance-close" aria-label="Fechar aparência" onClick={onClose}><X size={15} aria-hidden="true" /></button>}
    </div>
    <div className="island-appearance-scroll">
      <section className="island-appearance-card" aria-label="Tema e cor de destaque">
        <Segments label="Tema" value={p.theme} options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }, { value: 'system', label: 'Sistema' }]}
          onChange={theme => p.updatePreferences({ theme })} />
        <fieldset className="island-appearance-field">
          <legend>Cor de destaque</legend>
          <div className="island-appearance-swatches">
            {accents.map(({ value, label }) => <button key={value} type="button" aria-label={label} aria-pressed={p.accent === value}
              className="island-appearance-swatch" style={{ '--swatch-color': ACCENT_COLORS[value].dark,
                '--swatch-ink': resolveAccentForeground(ACCENT_COLORS[value].dark) } as CSSProperties}
              onClick={() => p.updatePreferences({ accent: value })}>{p.accent === value && <Check size={13} aria-hidden="true" />}</button>)}
            <button type="button" aria-label="Cor personalizada" aria-pressed={p.accent === 'custom'}
              className="island-appearance-swatch is-custom" onClick={() => p.updatePreferences({ accent: 'custom' })}>
              {p.accent === 'custom' && <Check size={13} aria-hidden="true" />}
            </button>
          </div>
        </fieldset>
        {p.accent === 'custom' && <div className="island-appearance-custom">
          <label className="island-appearance-color-picker" htmlFor={`${idPrefix}-color`} title="Escolher cor">
            <input type="color" id={`${idPrefix}-color`} aria-label="Escolher cor personalizada" value={p.customAccent}
              onChange={event => p.updatePreferences({ customAccent: event.target.value })} />
          </label>
          <input type="text" className="island-appearance-hex" value={draft} maxLength={7} spellCheck={false}
            aria-label="Código hexadecimal da cor" aria-invalid={colorError || undefined}
            aria-describedby={colorError ? `${idPrefix}-color-error` : undefined}
            onChange={event => { setDraft(event.target.value); setColorError(false); }} onBlur={commitColor}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitColor(); } }} />
          <span className="island-appearance-color-help">Contraste adaptativo</span>
          {colorError && <small role="alert" id={`${idPrefix}-color-error`}>Use uma cor como #10b981.</small>}
        </div>}
      </section>

      <section className="island-appearance-card" aria-label="Superfície da ilha">
        <div className="island-appearance-card-title"><Layers size={13} aria-hidden="true" /><span>Superfície da ilha</span></div>
        <div className="island-appearance-swatches">
          {tones.map(({ value, label, color }) => <button type="button" key={value} aria-label={label} aria-pressed={p.islandTone === value}
            className="island-appearance-swatch" style={{ '--swatch-color': color, '--swatch-ink': '#f8fafc' } as CSSProperties}
            onClick={() => p.updatePreferences({ islandTone: value })}>{p.islandTone === value && <Check size={13} aria-hidden="true" />}</button>)}
          <span className="island-appearance-tone-name">{tones.find(tone => tone.value === p.islandTone)?.label}</span>
        </div>
        <label htmlFor={`${idPrefix}-opacity`} className="island-appearance-slider">
          <span>Opacidade</span><input type="range" id={`${idPrefix}-opacity`} min={55} max={100} step={1}
            value={Math.round(p.islandOpacity * 100)} onChange={event => p.updatePreferences({ islandOpacity: Number(event.target.value) / 100 })} />
          <output>{Math.round(p.islandOpacity * 100)}%</output>
        </label>
      </section>

      <section className="island-appearance-card" aria-label="Comportamento da ilha">
        <div className="island-appearance-card-title"><Sparkles size={13} aria-hidden="true" /><span>Ilha</span></div>
        <Segments label="Tamanho ao expandir" value={p.islandSize} options={[{ value: 'small', label: 'Pequena' }, { value: 'medium', label: 'Média' }, { value: 'large', label: 'Grande' }]}
          onChange={islandSize => p.updatePreferences({ islandSize })} />
        <Segments label="Em repouso" value={p.islandIdle} options={[{ value: 'minimal', label: 'Forma' }, { value: 'clock', label: 'Relógio' }, { value: 'focus', label: 'Foco' }, { value: 'balance', label: 'Saldo' }]}
          onChange={islandIdle => p.updatePreferences({ islandIdle })} />
        <Segments label="Visibilidade" value={p.islandVisibility} options={[{ value: 'fixed', label: 'Fixa' }, { value: 'hybrid', label: 'Híbrida' }]}
          onChange={islandVisibility => p.updatePreferences({ islandVisibility })} />
        {p.islandVisibility === 'hybrid' && <div className="island-appearance-delay">
          <label htmlFor={`${idPrefix}-delay`}>Esconder após</label>
          <select id={`${idPrefix}-delay`} value={p.islandHideDelay} onChange={event => p.updatePreferences({ islandHideDelay: Number(event.target.value) as 3 | 5 | 10 })}>
            <option value={3}>3 segundos</option><option value={5}>5 segundos</option><option value={10}>10 segundos</option>
          </select>
        </div>}
        <label className="island-appearance-toggle"><span>Expandir ao aproximar o mouse</span><input type="checkbox" checked={p.islandHoverExpand}
          onChange={event => p.updatePreferences({ islandHoverExpand: event.target.checked })} /><span className="island-appearance-switch" aria-hidden="true" /></label>
        {p.islandVisibility === 'hybrid' && <p className="island-appearance-help">Aproxime o mouse do topo para a ilha voltar. Música e foco continuam.</p>}
      </section>

      <section className="island-appearance-card" aria-label="Atalhos e movimento">
        <div className="island-appearance-card-title"><Accessibility size={13} aria-hidden="true" /><span>Seu ritmo</span></div>
        <label className="island-appearance-toggle"><span>Controles nos cantos</span><input type="checkbox" checked={p.topControlsEnabled}
          onChange={event => p.updatePreferences({ topControlsEnabled: event.target.checked })} /><span className="island-appearance-switch" aria-hidden="true" /></label>
        <label className="island-appearance-toggle"><span>Dock de atalhos</span><input type="checkbox" checked={p.dockEnabled}
          onChange={event => p.updatePreferences({ dockEnabled: event.target.checked })} /><span className="island-appearance-switch" aria-hidden="true" /></label>
        <label className="island-appearance-toggle"><span>Reduzir movimento</span><input type="checkbox" checked={p.reduceMotion}
          onChange={event => p.updatePreferences({ reduceMotion: event.target.checked })} /><span className="island-appearance-switch" aria-hidden="true" /></label>
      </section>
    </div>
    {onOpenFull && <button type="button" className="island-appearance-full" onClick={onOpenFull}>Todas as preferências<ChevronRight size={13} aria-hidden="true" /></button>}
  </section>;
}
