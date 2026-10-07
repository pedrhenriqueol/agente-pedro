import React, { useState } from 'react';
import { CustomTitleBar } from './CustomTitleBar';
import { RoutineModule } from './RoutineModule';
import { FinanceModule } from './FinanceModule';
import { Clock, Wallet, ShieldCheck, Database, HardDrive } from 'lucide-react';
import { useFocusStore } from '../stores/useFocusStore';
import { useFinanceStore, formatCentsToBRL } from '../stores/useFinanceStore';

type DashboardTab = 'routine' | 'finance';

export const MainDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('routine');

  const { tasks } = useFocusStore();
  const { consolidated } = useFinanceStore();

  const pendingTasks = tasks.filter((t) => t.completed === 0).length;

  return (
    <div className="flex flex-col h-screen w-screen bg-industrial-bg text-slate-100 overflow-hidden border border-industrial-border shadow-2xl select-none">
      {/* ── BARRA DE TÍTULO CUSTOMIZADA ── */}
      <CustomTitleBar />

      {/* ── BARRA SUPERIOR DE NAVEGAÇÃO ENTRE MÓDULOS ── */}
      <div className="bg-industrial-surface/80 border-b border-industrial-border px-6 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('routine')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
              activeTab === 'routine'
                ? 'bg-industrial-card border-industrial-accent text-industrial-accent shadow-sm'
                : 'border-transparent text-industrial-muted hover:text-slate-200 hover:bg-industrial-card/50'
            }`}
          >
            <Clock size={14} />
            <span>ROTINA & FOCO</span>
            {pendingTasks > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-industrial-accent/20 text-industrial-accent text-[10px]">
                {pendingTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('finance')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
              activeTab === 'finance'
                ? 'bg-industrial-card border-industrial-accent text-industrial-accent shadow-sm'
                : 'border-transparent text-industrial-muted hover:text-slate-200 hover:bg-industrial-card/50'
            }`}
          >
            <Wallet size={14} />
            <span>FINANÇAS & CONTROLE</span>
            <span className="ml-1 text-[11px] text-industrial-accent font-semibold hidden sm:inline">
              {formatCentsToBRL(consolidated.total_balance_cents)}
            </span>
          </button>
        </div>

        {/* Metadados Técnicos do Sistema */}
        <div className="flex items-center space-x-3 text-[11px] font-mono text-industrial-subtle">
          <div className="flex items-center space-x-1 hidden sm:flex">
            <Database size={12} className="text-industrial-accent" />
            <span>agente_pedro.db</span>
          </div>
          <div className="flex items-center space-x-1">
            <ShieldCheck size={12} className="text-industrial-accent" />
            <span>ZERO IA / OFFLINE</span>
          </div>
        </div>
      </div>

      {/* ── ÁREA DE CONTEÚDO PRINCIPAL (SCROLLÁVEL) ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'routine' ? <RoutineModule /> : <FinanceModule />}
      </div>

      {/* ── RODAPÉ INDUSTRIAL ── */}
      <div className="h-7 bg-industrial-surface border-t border-industrial-border/70 px-4 flex items-center justify-between text-[11px] font-mono text-industrial-subtle shrink-0">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-industrial-accent" />
            <span className="text-slate-300">Agente Pedro v0.1.0</span>
          </span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">Engine: Tauri 2 + React 19</span>
        </div>

        <div className="flex items-center space-x-2">
          <HardDrive size={11} className="text-industrial-accent" />
          <span>SQLite WAL Ativo</span>
        </div>
      </div>
    </div>
  );
};
