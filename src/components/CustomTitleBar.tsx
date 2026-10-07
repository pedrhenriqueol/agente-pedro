import React from 'react';
import { Minus, Square, X, Terminal, Shield } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const CustomTitleBar: React.FC = () => {
  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch {
      console.log('[TitleBar] Minimizar acionado');
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
    } catch {
      console.log('[TitleBar] Maximizar acionado');
    }
  };

  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.hide(); // Mantém o app em execução em background acessível pelo atalho
    } catch {
      console.log('[TitleBar] Fechar/Ocultar acionado');
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="h-10 w-full bg-industrial-surface border-b border-industrial-border flex items-center justify-between px-3 select-none z-50 shrink-0"
    >
      {/* Lado Esquerdo: Identidade do Sistema */}
      <div className="flex items-center space-x-2 pointer-events-none" data-tauri-drag-region>
        <div className="w-5 h-5 rounded bg-industrial-accent/20 border border-industrial-accent/40 flex items-center justify-center text-industrial-accent">
          <Terminal size={12} />
        </div>
        <span className="text-xs font-mono font-bold tracking-wider text-slate-100">
          AGENTE PEDRO
        </span>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-industrial-card border border-industrial-border text-industrial-accent">
          LIFE OS
        </span>
        <span className="text-[10px] font-mono text-industrial-subtle ml-2 hidden sm:inline-block">
          [Alt + Espaço]
        </span>
      </div>

      {/* Lado Direito: Status e Controles da Janela */}
      <div className="flex items-center space-x-1">
        <div className="flex items-center space-x-1.5 mr-3 text-[11px] font-mono text-industrial-subtle hidden md:flex">
          <Shield size={12} className="text-industrial-accent" />
          <span>LOCAL-FIRST WAL</span>
        </div>

        <button
          type="button"
          onClick={handleMinimize}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-industrial-hover text-industrial-muted hover:text-slate-100 transition-colors"
          title="Minimizar"
        >
          <Minus size={13} />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-industrial-hover text-industrial-muted hover:text-slate-100 transition-colors"
          title="Maximizar"
        >
          <Square size={11} />
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-industrial-danger/20 hover:text-industrial-danger text-industrial-muted transition-colors"
          title="Ocultar (Atalho: Alt + Espaço)"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
