import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DynamicIsland } from './components/DynamicIsland';
import { MainDashboard } from './components/MainDashboard';
import { useFocusStore } from './stores/useFocusStore';
import { useFinanceStore } from './stores/useFinanceStore';

export const App: React.FC = () => {
  const [windowLabel, setWindowLabel] = useState<string>('main');
  const [isReady, setIsReady] = useState(false);

  const { loadInitialData } = useFocusStore();
  const { loadFinancialData } = useFinanceStore();

  useEffect(() => {
    // 1. Identifica a janela atual através da API oficial do Tauri ou URL query param
    const detectWindow = async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          const current = getCurrentWindow();
          setWindowLabel(current.label);
        } else {
          // Fallback para ambiente de desenvolvimento no navegador
          const params = new URLSearchParams(window.location.search);
          const paramWindow = params.get('window');
          if (paramWindow) {
            setWindowLabel(paramWindow);
          }
        }
      } catch (err) {
        console.warn('[App] Não foi possível obter label nativo da janela:', err);
      } finally {
        setIsReady(true);
      }
    };

    detectWindow();
  }, []);

  // Inicializa dados do SQLite nas stores globais
  useEffect(() => {
    loadInitialData();
    loadFinancialData();
  }, [loadInitialData, loadFinancialData]);

  if (!isReady) {
    return null;
  }

  // Roteamento determinístico por janela nativa
  if (windowLabel === 'island') {
    return (
      <div className="w-full h-full flex items-start justify-center pt-1 bg-transparent overflow-hidden">
        <DynamicIsland />
      </div>
    );
  }

  return <MainDashboard />;
};

export default App;
