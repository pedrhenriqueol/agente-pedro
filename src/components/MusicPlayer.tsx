import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LoaderCircle, Music2, Pause, Play, RefreshCw, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useMediaStore } from '../stores/useMediaStore';
import type { MediaSession } from '../services/mediaClient';
import '../styles/music.css';

type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'volume';

function formatTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(time / 60);
  const remainder = String(time % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

function sourceLabel(source: string): string {
  const app = source.toLowerCase();
  if (app.includes('soundcloud')) return 'SoundCloud';
  if (app.includes('msedge') || app.includes('microsoftedge')) return 'Microsoft Edge';
  if (app.includes('chrome')) return 'Google Chrome';
  if (app.includes('firefox')) return 'Firefox';
  if (app.includes('brave')) return 'Brave';
  if (app.includes('spotify')) return 'Spotify';
  return source || 'Player do Windows';
}

function SystemVolume({ volume, muted, controlMedia }: {
  volume: number;
  muted: boolean | null;
  controlMedia: (action: MediaAction, value?: number) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const queued = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const shownVolume = draft ?? Math.max(0, Math.min(100, Math.round(volume)));

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    sequence.current += 1;
  }, []);

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = queued.current;
    if (value === null) return;
    queued.current = null;
    const request = ++sequence.current;
    void controlMedia('volume', value).catch(() => {
      // The shared store keeps the specific failure for the player to display.
    }).finally(() => {
      if (request === sequence.current && queued.current === null) setDraft(null);
    });
  };

  const changeVolume = (value: number) => {
    setDraft(value);
    queued.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 220);
  };

  return <div className="music-volume">
    <label htmlFor={id}>
      {muted || shownVolume === 0 ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
      <span>Volume do Windows</span>
    </label>
    <input id={id} className="music-volume-slider" type="range" min="0" max="100" step="1" value={shownVolume}
      aria-valuetext={`${shownVolume}%${muted ? ' · sem som' : ''}`}
      onChange={event => changeVolume(Number(event.target.value))}
      onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} />
    <output htmlFor={id}>{shownVolume}%</output>
  </div>;
}

/** Volume is a system action, so it stays usable when no music session exists. */
export function MusicVolume() {
  const { snapshot, initialized, controlMedia } = useMediaStore(useShallow(state => ({
    snapshot: state.snapshot, initialized: state.initialized, controlMedia: state.controlMedia,
  })));
  if (!initialized || !snapshot.supported || snapshot.volume === null || !Number.isFinite(snapshot.volume)) return null;
  return <SystemVolume volume={snapshot.volume} muted={snapshot.muted} controlMedia={controlMedia} />;
}

function sameTrack(left: MediaSession, right: MediaSession): boolean {
  return left.id === right.id && left.title === right.title && left.artist === right.artist
    && left.album === right.album && left.artwork === right.artwork && left.sourceApp === right.sourceApp;
}

/** Stable artwork/text containers keep their place while metadata crossfades. */
function TrackIdentity({ session, compact }: { session: MediaSession; compact: boolean }) {
  const previous = useRef(session);
  const [outgoing, setOutgoing] = useState<MediaSession | null>(null);
  const [transition, setTransition] = useState(0);
  const [failedArtwork, setFailedArtwork] = useState<string[]>([]);
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!sameTrack(previous.current, session)) {
      setOutgoing(previous.current);
      setTransition(value => value + 1);
      timer = setTimeout(() => setOutgoing(null), 180);
    }
    previous.current = session;
    return () => { if (timer !== undefined) clearTimeout(timer); };
    // Position/status updates must not restart an identity transition.
  }, [session.id, session.title, session.artist, session.album, session.artwork, session.sourceApp]);
  const artwork = (track: MediaSession) => {
    const image = track.artwork;
    return image && !failedArtwork.includes(image)
      ? <img src={image} alt="" onError={() => setFailedArtwork(values => values.includes(image) ? values : [...values.slice(-3), image])} />
      : <Music2 size={compact ? 22 : 38} strokeWidth={1.4} aria-hidden="true" />;
  };
  const text = (track: MediaSession) => <>
    <h2 title={track.title || 'Faixa em reprodução'}>{track.title || 'Faixa em reprodução'}</h2>
    <p title={track.artist || 'Artista não informado'}>{track.artist || 'Artista não informado'}</p>
    {!compact && <span className="music-source" title={track.sourceApp}>{sourceLabel(track.sourceApp)}</span>}
  </>;

  return <>
    <div className={`music-artwork${session.artwork && !failedArtwork.includes(session.artwork) ? ' has-image' : ''}`}>
      <span key={transition} className={`music-artwork-layer${outgoing ? ' is-arriving' : ''}`}>{artwork(session)}</span>
      {outgoing && <span className="music-artwork-layer is-outgoing" aria-hidden="true">{artwork(outgoing)}</span>}
    </div>
    <div className="music-track-info">
      <div key={transition} className={`music-track-current${outgoing ? ' is-arriving' : ''}`} aria-live="polite" aria-atomic="true">{text(session)}</div>
      {outgoing && <div className="music-track-outgoing is-outgoing" aria-hidden="true">{text(outgoing)}</div>}
    </div>
  </>;
}

/** The same real Windows session is shown in the dashboard and the island. */
export function MusicPlayer({ compact = false, showVolume = true, showIdentity = true }: {
  compact?: boolean; showVolume?: boolean; showIdentity?: boolean;
}) {
  const { snapshot, displaySession, presentationPhase, initialized, observedAt, pending, error, controlMedia, refreshMedia, clearError } = useMediaStore(useShallow(state => ({
    snapshot: state.snapshot, initialized: state.initialized, observedAt: state.observedAt, pending: state.pending, error: state.error,
    displaySession: state.displaySession, presentationPhase: state.presentationPhase,
    controlMedia: state.controlMedia, refreshMedia: state.refreshMedia, clearError: state.clearError,
  })));
  const [clock, setClock] = useState(() => Date.now());
  const session = displaySession;
  const updating = presentationPhase === 'updating';
  const ready = presentationPhase === 'ready' && snapshot.session?.id === session?.id;
  const failure = error || snapshot.error;
  const canUseVolume = initialized && snapshot.supported && snapshot.volume !== null && Number.isFinite(snapshot.volume);
  const retry = () => { void refreshMedia().catch(() => {}); };
  const run = (action: MediaAction) => { void controlMedia(action).catch(() => {}); };
  const playing = ready && session?.playbackStatus === 'playing';
  useEffect(() => {
    if (!playing) return;
    setClock(Date.now());
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [playing, session?.id, observedAt]);
  const pauseAction = Boolean(session && (playing || (!session.canPlay && session.canPause)));
  const primaryAllowed = Boolean(ready && session && (pauseAction ? session.canPause : session.canPlay));
  const status = updating ? 'Atualizando faixa…' : presentationPhase === 'unavailable' ? 'Reprodução indisponível'
    : playing ? 'Em reprodução' : session?.playbackStatus === 'paused' ? 'Pausado'
    : session?.playbackStatus === 'stopped' ? 'Parado' : 'Sua música';
  const hasTimeline = session !== null && session.durationSeconds !== null && session.positionSeconds !== null
    && Number.isFinite(session.durationSeconds) && Number.isFinite(session.positionSeconds) && session.durationSeconds > 0;
  const elapsed = playing ? Math.max(0, (clock - observedAt) / 1000) : 0;
  const position = hasTimeline ? Math.max(0, Math.min(session.positionSeconds! + elapsed, session.durationSeconds!)) : 0;
  const progress = hasTimeline ? position / session.durationSeconds! * 100 : 0;

  return <div className={`music-player${compact ? ' is-compact' : ''}${updating ? ' is-updating' : ''}`} role="group" aria-label="Player de música" aria-busy={pending || updating} data-presentation={presentationPhase}>
    {session ? <>
      {!compact && <div className="music-player-topline"><span className="eyebrow">Sua trilha do dia</span>
        <span className={`music-status${playing ? ' is-playing' : ''}`}><span />{status}</span></div>}
      {showIdentity && <div className="music-now-playing">
        <TrackIdentity session={session} compact={compact} />
        {compact && <span className={`music-compact-status${playing ? ' is-playing' : ''}${updating ? ' is-updating' : ''}`} role="status" title={status} aria-label={status} />}
      </div>}
      <div className="music-transport" role="group" aria-label="Controles da música">
        <button className="music-transport-button" type="button" disabled={pending || !ready || !session.canGoPrevious}
          onClick={() => run('previous')} aria-label="Música anterior" title={session.canGoPrevious ? 'Música anterior' : 'Música anterior indisponível neste player'}>
          <SkipBack size={compact ? 17 : 20} fill="currentColor" aria-hidden="true" />
        </button>
        <button className="music-transport-button is-primary" type="button" disabled={pending || !primaryAllowed}
          onClick={() => run(pauseAction ? 'pause' : 'play')} aria-label={pauseAction ? 'Pausar música' : 'Reproduzir música'}
          title={primaryAllowed ? pauseAction ? 'Pausar música' : 'Reproduzir música' : 'Reprodução indisponível neste player'}>
          {pending || updating ? <LoaderCircle className="music-loading-icon" size={compact ? 17 : 22} aria-hidden="true" />
            : pauseAction ? <Pause size={compact ? 17 : 22} fill="currentColor" aria-hidden="true" /> : <Play size={compact ? 17 : 22} fill="currentColor" aria-hidden="true" />}
        </button>
        <button className="music-transport-button" type="button" disabled={pending || !ready || !session.canGoNext}
          onClick={() => run('next')} aria-label="Próxima música" title={session.canGoNext ? 'Próxima música' : 'Próxima música indisponível neste player'}>
          <SkipForward size={compact ? 17 : 20} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
      {hasTimeline && <div className="music-timeline">
        <div className="music-progress" role="progressbar" aria-label="Progresso da música" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress)} aria-valuetext={`${formatTime(position)} de ${formatTime(session.durationSeconds!)}`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        {!compact && <div className="music-time"><span>{formatTime(position)}</span><span>{formatTime(session.durationSeconds!)}</span></div>}
      </div>}
    </> : <div className="music-player-empty" role="status">
      <div className="music-empty-mark">{!initialized ? <LoaderCircle size={compact ? 23 : 34} className="music-loading-icon" aria-hidden="true" /> : <Music2 size={compact ? 23 : 34} strokeWidth={1.4} aria-hidden="true" />}</div>
      <div><h2>{!initialized ? 'Buscando sua música…' : failure ? 'A música está indisponível' : !snapshot.supported ? 'Sua música, no Windows' : 'Sua próxima trilha começa aqui'}</h2>
        <p>{!initialized ? 'Preparando os controles de reprodução.' : failure ? 'Tente atualizar a reprodução para continuar.' : !snapshot.supported
          ? compact ? 'Abra o aplicativo para Windows.' : 'Use o aplicativo para Windows para acompanhar o SoundCloud e controlar a reprodução. Nesta prévia do navegador, os controles ficam indisponíveis.'
          : compact ? 'Abra o SoundCloud e dê play.' : 'Abra o SoundCloud no navegador e dê play. A música reconhecida pelo Windows aparece aqui e na ilha.'}</p>
        {!compact && initialized && snapshot.supported && <button className="button ghost small music-refresh" type="button" disabled={pending} onClick={retry}><RefreshCw size={14} aria-hidden="true" />Buscar reprodução</button>}
      </div>
    </div>}
    {showVolume && canUseVolume && <SystemVolume volume={snapshot.volume!} muted={snapshot.muted} controlMedia={controlMedia} />}
    {failure && <div className="music-player-error" role="alert">
      <p title={failure}>{failure}</p>
      <button type="button" className="music-error-action" disabled={pending} onClick={retry} aria-label="Tentar atualizar música novamente" title="Tentar novamente"><RefreshCw size={13} aria-hidden="true" />{!compact && <span>Tentar novamente</span>}</button>
      {error && !snapshot.error && <button type="button" className="music-error-action" onClick={clearError} aria-label="Fechar mensagem de erro" title="Fechar mensagem"><X size={13} aria-hidden="true" /></button>}
    </div>}
  </div>;
}
