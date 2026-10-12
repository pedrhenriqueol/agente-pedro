import { AudioLines, Headphones, Monitor, Radio, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useMediaStore } from '../stores/useMediaStore';
import { MusicPlayer } from './MusicPlayer';

export function MusicPage() {
  const { initialized, supported, hasSession, failure } = useMediaStore(useShallow(state => ({
    initialized: state.initialized, supported: state.snapshot.supported, hasSession: state.snapshot.session !== null,
    failure: state.error || state.snapshot.error,
  })));

  return <div className="music-page">
    <header className="page-heading"><span className="eyebrow">No seu ritmo</span><h1>Música</h1>
      <p>Abra o SoundCloud no navegador e dê play. O Pedro acompanha a reprodução reconhecida pelo Windows.</p></header>
    <div className="music-page-grid">
      <section className="panel music-main-panel" aria-label="Reprodução atual"><MusicPlayer /></section>
      <aside className="panel music-companion-panel">
        <span className="music-companion-icon"><Headphones size={23} strokeWidth={1.5} aria-hidden="true" /></span>
        <h2>Uma trilha para o seu dia</h2>
        <p>Continue ouvindo onde você gosta. A música fica por perto enquanto você cuida da sua rotina.</p>
        <ul className="music-companion-list">
          <li><Radio size={18} aria-hidden="true" /><div><strong>Play no SoundCloud</strong><span>Use seu navegador no Windows. Não é preciso conectar uma conta ao Pedro.</span></div></li>
          <li><AudioLines size={18} aria-hidden="true" /><div><strong>Controles sempre à mão</strong><span>Veja a capa, pause e mude de faixa na ilha ou neste painel, conforme o player permitir.</span></div></li>
          <li><Volume2 size={18} aria-hidden="true" /><div><strong>Volume do Windows</strong><span>O ajuste controla a saída de áudio do sistema e vale também para os outros aplicativos.</span></div></li>
        </ul>
        <div className={`music-connection${initialized && supported && !failure ? ' is-ready' : ''}`} role="status">
          <Monitor size={15} aria-hidden="true" /><span>{!initialized ? 'Preparando a conexão com o Windows…'
            : failure ? 'A conexão com a reprodução está indisponível.' : !supported ? 'Controles disponíveis no aplicativo para Windows.'
              : hasSession ? 'Reprodução reconhecida pelo Windows.' : 'Pronto para acompanhar sua música.'}</span>
        </div>
      </aside>
    </div>
  </div>;
}
