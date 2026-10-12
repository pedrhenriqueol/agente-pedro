import { useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Search } from 'lucide-react';

export function CustomTitleBar({ onSearch }: { onSearch?: () => void }) {
  const [error, setError] = useState('');
  const native = '__TAURI_INTERNALS__' in window;
  const control = async (action: 'minimize' | 'maximize' | 'close') => {
    try {
      const current = getCurrentWindow();
      if (action === 'minimize') await current.minimize();
      else if (action === 'maximize') await current.toggleMaximize();
      else await current.hide();
      setError('');
    } catch { setError('Não foi possível controlar a janela. Tente novamente.'); }
  };
  return <header className="titlebar" data-tauri-drag-region>
    <div className="titlebar-name" data-tauri-drag-region><span className="presence-dot" />Agente Pedro
      {error && <span className="titlebar-error" role="alert">{error}</span>}
    </div>
    <div className="titlebar-actions">
      {onSearch && <button type="button" className="search-trigger" onClick={onSearch} aria-label="Buscar ações">
        <Search size={15} aria-hidden="true" /><span>Buscar ações</span><kbd>Ctrl K</kbd>
      </button>}
      {native && <div className="window-controls">
        <button type="button" aria-label="Minimizar" onClick={() => void control('minimize')}><Minus size={16} /></button>
        <button type="button" aria-label="Maximizar ou restaurar" onClick={() => void control('maximize')}><Square size={13} /></button>
        <button type="button" aria-label="Ocultar janela" onClick={() => void control('close')}><X size={16} /></button>
      </div>}
    </div>
  </header>;
}
