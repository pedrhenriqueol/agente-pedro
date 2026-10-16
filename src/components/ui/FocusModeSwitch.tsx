import { useRef } from 'react';
import { Coffee } from 'lucide-react';
import { SelectionIndicator } from './SelectionIndicator';
import '../../styles/focus-mode-switch.css';

interface FocusModeSwitchProps {
  mode: 'focus' | 'break';
  onChange: (mode: 'focus' | 'break') => void;
  disabled: boolean;
  compact?: boolean;
  durations?: { focus: number; break: number };
}

/** Selection moves within the existing controls; button geometry stays still. */
export function FocusModeSwitch({ mode, onChange, disabled, compact = false,
  durations = { focus: 25, break: 5 } }: FocusModeSwitchProps) {
  const strip = useRef<HTMLDivElement>(null);

  return <div ref={strip} className={`focus-mode-switch ${compact ? 'island-mode-picker is-compact' : 'focus-mode-picker'}`}
    role="group" aria-label={compact ? 'Tipo de sessão' : 'Duração da sessão'} data-disabled={disabled}>
    <button type="button" aria-pressed={mode === 'focus'} disabled={disabled} onClick={() => onChange('focus')}>
      {compact ? 'Foco' : <>Foco <span>{durations.focus} min</span></>}
    </button>
    <button type="button" aria-pressed={mode === 'break'} disabled={disabled} onClick={() => onChange('break')}>
      {compact ? <><Coffee size={12} aria-hidden="true" />Pausa</> : <>Pausa <span>{durations.break} min</span></>}
    </button>
    <SelectionIndicator owner={strip} selection={mode} selector="[aria-pressed='true']" className="focus-mode-selection" />
  </div>;
}
