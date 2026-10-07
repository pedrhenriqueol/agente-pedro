import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Pause, RotateCcw, ChevronDown, ChevronUp, Layers, CheckSquare } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';

export const DynamicIsland: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  const {
    pomodoroState,
    currentMode,
    remainingSeconds,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    resetPomodoro,
    tasks,
    loadInitialData,
  } = useFocusStore();

  const { consolidated, loadFinancialData } = useFinanceStore();

  // Relógio digital em tempo real
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Carrega dados iniciais das stores
  useEffect(() => {
    loadInitialData();
    loadFinancialData();
  }, [loadInitialData, loadFinancialData]);

  // Sincroniza redimensionamento dinâmico da janela nativa do Tauri
  const toggleExpansion = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextState = !isExpanded;
    setIsExpanded(nextState);

    try {
      if (nextState) {
        await invoke('expandir_ilha', { altura: 144.0 });
      } else {
        await invoke('recolher_ilha');
      }
    } catch {
      // Fallback em ambiente de preview web
    }
  };

  const handleOpenConsole = async () => {
    try {
      await invoke('alternar_console');
    } catch {
      console.log('[DynamicIsland] Alternar console invocado');
    }
  };

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const pendingTasksCount = tasks.filter((t) => t.completed === 0).length;

  return (
    <div
      data-tauri-drag-region
      className={`w-[380px] transition-all duration-200 select-none overflow-hidden rounded-full border border-industrial-border shadow-2xl bg-industrial-bg/95 backdrop-blur-md text-slate-100 ${
        isExpanded ? 'h-[144px] rounded-2xl p-3' : 'h-[48px] px-3.5 flex items-center justify-between'
      }`}
      style={{ boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)' }}
    >
      {!isExpanded ? (
        /* ── MODO COMPACTO (48px) ── */
        <div className="w-full flex items-center justify-between" onClick={handleOpenConsole}>
          {/* Relógio */}
          <div className="flex items-center space-x-1.5 cursor-pointer">
            <span className="font-mono text-xs font-semibold tracking-wider text-slate-300">
              {currentTime}
            </span>
          </div>

          {/* Pomodoro Status */}
          <div className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-industrial-surface border border-industrial-border/60">
            <span
              className={`w-2 h-2 rounded-full ${
                pomodoroState === 'focus'
                  ? 'bg-industrial-accent animate-pulse'
                  : pomodoroState === 'break'
                  ? 'bg-blue-400 animate-pulse'
                  : pomodoroState === 'paused'
                  ? 'bg-industrial-warning'
                  : 'bg-industrial-subtle'
              }`}
            />
            <span className="font-mono text-xs font-medium text-slate-200">
              {formatTimer(remainingSeconds)}
            </span>
          </div>

          {/* Resumo Financeiro & Expansor */}
          <div className="flex items-center space-x-2">
            <span className="font-mono text-[11px] font-semibold text-industrial-accent">
              {formatCentsToBRL(consolidated.total_balance_cents)}
            </span>

            <button
              type="button"
              onClick={toggleExpansion}
              className="p-1 rounded-full hover:bg-industrial-hover text-industrial-muted hover:text-slate-100 transition-colors"
              title="Expandir Ilha Dinâmica"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      ) : (
        /* ── MODO EXPANDIDO (144px) ── */
        <div className="flex flex-col h-full justify-between">
          {/* Cabeçalho da Ilha Expandida */}
          <div className="flex items-center justify-between border-b border-industrial-border/60 pb-2">
            <div className="flex items-center space-x-2 cursor-pointer" onClick={handleOpenConsole}>
              <Layers size={13} className="text-industrial-accent" />
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-200">
                ILHA DINÂMICA
              </span>
              <span className="text-[10px] font-mono px-1.5 rounded bg-industrial-surface text-industrial-muted">
                {currentTime}
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={handleOpenConsole}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-industrial-hover hover:bg-industrial-border text-slate-300 transition-colors mr-1"
              >
                Abrir Console
              </button>
              <button
                type="button"
                onClick={toggleExpansion}
                className="p-1 rounded-full hover:bg-industrial-hover text-industrial-muted hover:text-slate-100 transition-colors"
                title="Recolher Ilha Dinâmica"
              >
                <ChevronUp size={14} />
              </button>
            </div>
          </div>

          {/* Linha Central: Controles Rápidos Pomodoro */}
          <div className="flex items-center justify-between py-1 px-1">
            <div className="flex items-center space-x-2">
              <span
                className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
                  currentMode === 'focus'
                    ? 'bg-industrial-accent/20 text-industrial-accent'
                    : 'bg-blue-500/20 text-blue-400'
                }`}
              >
                {currentMode === 'focus' ? 'FOCO' : 'PAUSA'}
              </span>
              <span className="font-mono text-base font-bold tracking-wider text-slate-100">
                {formatTimer(remainingSeconds)}
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              {pomodoroState === 'idle' || pomodoroState === 'completed' ? (
                <button
                  type="button"
                  onClick={() => startPomodoro(currentMode)}
                  className="p-1.5 rounded bg-industrial-accent text-industrial-bg hover:bg-industrial-accentHover font-semibold transition-colors"
                  title="Iniciar"
                >
                  <Play size={13} fill="currentColor" />
                </button>
              ) : pomodoroState === 'paused' ? (
                <button
                  type="button"
                  onClick={resumePomodoro}
                  className="p-1.5 rounded bg-industrial-accent text-industrial-bg hover:bg-industrial-accentHover font-semibold transition-colors"
                  title="Continuar"
                >
                  <Play size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pausePomodoro}
                  className="p-1.5 rounded bg-industrial-warning text-industrial-bg hover:opacity-90 font-semibold transition-colors"
                  title="Pausar"
                >
                  <Pause size={13} fill="currentColor" />
                </button>
              )}

              <button
                type="button"
                onClick={resetPomodoro}
                className="p-1.5 rounded bg-industrial-surface border border-industrial-border text-industrial-muted hover:text-slate-100 transition-colors"
                title="Reiniciar"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          {/* Rodapé: Resumo de Tarefas e Saldo */}
          <div className="flex items-center justify-between pt-1 border-t border-industrial-border/60 text-[11px] font-mono text-industrial-muted">
            <div className="flex items-center space-x-1.5">
              <CheckSquare size={12} className="text-industrial-accent" />
              <span>{pendingTasksCount} pendentes hoje</span>
            </div>

            <div className="text-industrial-accent font-semibold">
              {formatCentsToBRL(consolidated.total_balance_cents)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
