import { create } from 'zustand';
import { EMPTY_MEDIA, readMedia, sendMediaControl, watchMedia, type MediaAction, type MediaPosition, type MediaSession, type MediaSnapshot } from '../services/mediaClient';

export type MediaPresentationPhase = 'loading' | 'ready' | 'updating' | 'empty' | 'unavailable';
// The Windows worker samples sessions about every 900 ms. One missed sample may
// belong to a track change; this deadline also bounds a genuinely closed player.
export const MEDIA_PRESENTATION_GRACE_MS = 2500;

interface MediaStore {
  snapshot: MediaSnapshot;
  displaySession: MediaSession | null;
  presentationPhase: MediaPresentationPhase;
  initialized: boolean;
  observedAt: number;
  pending: boolean;
  error: string | null;
  controlMedia: (action: MediaAction, value?: number) => Promise<void>;
  refreshMedia: () => Promise<void>;
  reconcileMedia: () => Promise<void>;
  clearError: () => void;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message
  : typeof error === 'string' ? error : 'Não foi possível atualizar a reprodução. Tente novamente.';

let presentationTimer: ReturnType<typeof setTimeout> | null = null;
let readFailed = false;
let observation = 0;
let refreshSequence = 0;
let settledRefresh = 0;
type TransportContext = Pick<MediaSession, 'id' | 'title' | 'artist' | 'album' | 'playbackStatus'>;
let localFailure: { source: 'read' | 'volume' | 'availability' } | { source: 'transport'; context: TransportContext | null } | null = null;

const hasContent = (session: MediaSession | null): session is MediaSession =>
  Boolean(session && (session.title.trim() || session.artist.trim()));

function transportContext(session: MediaSession | null): TransportContext | null {
  if (!session) return null;
  const { id, title, artist, album, playbackStatus } = session;
  return { id, title, artist, album, playbackStatus };
}

function hasNewTransportContext(snapshot: MediaSnapshot, previous: TransportContext | null): boolean {
  const session = snapshot.session;
  return snapshot.supported && !snapshot.error && !snapshot.sessionUpdating && hasContent(session)
    && (!previous || previous.id !== session.id || previous.title !== session.title || previous.artist !== session.artist
      || previous.album !== session.album || previous.playbackStatus !== session.playbackStatus);
}

function cancelPresentationTimer(): void {
  if (presentationTimer !== null) clearTimeout(presentationTimer);
  presentationTimer = null;
}

function receive(snapshot: MediaSnapshot): boolean {
  const current = useMediaStore.getState();
  if (current.initialized && (snapshot.revision < current.snapshot.revision
    || snapshot.revision === current.snapshot.revision && snapshot.sequence < current.snapshot.sequence)) return false;
  observation += 1;
  const recovered = localFailure?.source === 'read'
    || localFailure?.source === 'availability' && snapshot.supported && !snapshot.error && !snapshot.sessionUpdating && hasContent(snapshot.session)
    || localFailure?.source === 'transport' && hasNewTransportContext(snapshot, localFailure.context);
  if (recovered) localFailure = null;
  const base = { snapshot, initialized: true, observedAt: Date.now(), ...(recovered ? { error: null } : {}) };
  readFailed = false;
  if (!snapshot.supported || snapshot.error) {
    cancelPresentationTimer();
    useMediaStore.setState({ ...base, displaySession: null, presentationPhase: 'unavailable' });
  } else if (snapshot.sessionUpdating) {
    // Native recovery owns a finite deadline and still knows a live session.
    // A WebView timer must not turn that pending work into an empty catalog.
    cancelPresentationTimer();
    const context = hasContent(snapshot.session) ? snapshot.session : current.displaySession;
    useMediaStore.setState({ ...base, displaySession: context,
      presentationPhase: context ? 'updating' : 'loading' });
  } else if (hasContent(snapshot.session)) {
    cancelPresentationTimer();
    useMediaStore.setState({ ...base, displaySession: snapshot.session, presentationPhase: 'ready' });
  } else if (current.displaySession && (current.presentationPhase === 'ready' || current.presentationPhase === 'updating')) {
    // Retain presentation only. A null or untitled Windows session cannot
    // receive transport or position updates until usable metadata returns.
    useMediaStore.setState({ ...base, presentationPhase: 'updating' });
    if (presentationTimer === null) presentationTimer = setTimeout(() => {
      presentationTimer = null;
      const latest = useMediaStore.getState();
      if (latest.presentationPhase === 'updating' && !hasContent(latest.snapshot.session)) {
        useMediaStore.setState({ displaySession: null, presentationPhase: 'empty' });
      }
    }, MEDIA_PRESENTATION_GRACE_MS);
  } else {
    cancelPresentationTimer();
    useMediaStore.setState({ ...base, displaySession: null, presentationPhase: 'empty' });
  }
  return true;
}

function receivePosition(position: MediaPosition): void {
  const { snapshot } = useMediaStore.getState();
  if (!snapshot.supported || snapshot.error || snapshot.sessionUpdating || !hasContent(snapshot.session)
    || snapshot.revision !== position.revision || position.sequence < snapshot.sequence || snapshot.session.id !== position.sessionId) return;
  observation += 1;
  const session = { ...snapshot.session, positionSeconds: position.positionSeconds, durationSeconds: position.durationSeconds };
  // The worker may emit only position ticks while a healthy track stays the
  // same. They recover an IPC read failure, never a native or transport error.
  const recoverRead = readFailed;
  const clearReadError = recoverRead && (localFailure?.source === 'read' || localFailure?.source === 'availability');
  if (clearReadError) localFailure = null;
  readFailed = false;
  useMediaStore.setState({ snapshot: { ...snapshot, sequence: position.sequence, session },
    displaySession: session, observedAt: Date.now(), ...(recoverRead ? { presentationPhase: 'ready' } : {}),
    ...(clearReadError ? { error: null } : {}) });
}

let controlQueue = Promise.resolve();
let queuedControls = 0;

async function refreshSnapshot(explicit: boolean): Promise<void> {
  const request = ++refreshSequence;
  const startedAt = observation;
  try {
    if (consumers > 0) await ensureConnection();
    const snapshot = await readMedia();
    if (request < settledRefresh) return;
    settledRefresh = request;
    if (receive(snapshot) && explicit) { localFailure = null; useMediaStore.setState({ error: null }); }
  }
  catch (error) {
    // Automatic wake reconciliation is a cache read, not an explicit retry.
    // Its failure must not supersede an explicit retry still in flight, hide a
    // healthy player or erase a volume failure: no new state was observed.
    if (!explicit) throw error;
    const superseded = request < settledRefresh || startedAt !== observation;
    settledRefresh = Math.max(settledRefresh, request);
    if (superseded) throw error;
    cancelPresentationTimer();
    readFailed = true;
    const snapshot = useMediaStore.getState().snapshot;
    localFailure = { source: 'read' };
    useMediaStore.setState({ initialized: true, displaySession: snapshot.supported && !snapshot.error && hasContent(snapshot.session) ? snapshot.session : null,
      presentationPhase: 'unavailable', error: errorMessage(error) });
    throw error;
  }
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  snapshot: { ...EMPTY_MEDIA }, displaySession: null, presentationPhase: 'loading',
  initialized: false, observedAt: Date.now(), pending: false, error: null,
  clearError: () => { localFailure = null; set({ error: null }); },
  refreshMedia: () => refreshSnapshot(true),
  reconcileMedia: () => refreshSnapshot(false),
  controlMedia: async (action, value) => {
    if (get().pending && action !== 'volume') return;
    const { snapshot } = get();
    let targetContext = transportContext(snapshot.session);
    const recordFailure = (message: string) => {
      localFailure = action === 'volume' ? { source: 'volume' } : { source: 'transport', context: targetContext };
      set({ error: message });
    };
    const refuse = (message: string, unavailable = false): never => {
      if (unavailable) { localFailure = { source: 'availability' }; set({ error: message }); }
      else recordFailure(message);
      throw new Error(message);
    };
    if (!snapshot.supported) refuse('Os controles de música estão disponíveis no aplicativo para Windows.', true);
    const session = snapshot.session;
    if (action !== 'volume' && !hasContent(session)) refuse('Nenhuma reprodução foi encontrada. Dê play no seu navegador.', true);
    if (action !== 'volume' && get().presentationPhase === 'unavailable') refuse('Atualize a reprodução antes de usar os controles.', true);
    if (action !== 'volume' && snapshot.sessionUpdating) refuse('A reprodução está atualizando. Aguarde um instante.', true);
    const capabilities = { play: session?.canPlay, pause: session?.canPause,
      next: session?.canGoNext, previous: session?.canGoPrevious };
    if (action !== 'volume' && !capabilities[action]) refuse('Esse controle não está disponível na reprodução atual.');
    if (action === 'volume' && (!Number.isFinite(value) || value! < 0 || value! > 100)) {
      refuse('Escolha um volume entre 0 e 100.');
    }
    queuedControls += 1;
    localFailure = null;
    set({ pending: true, error: null });
    const command = controlQueue.catch(() => {}).then(async () => {
      // A media event may arrive between a click and execution of this queue.
      // Never forward transport to metadata that is retained only for display.
      if (action !== 'volume' && (get().snapshot.session?.id !== session?.id
        || get().presentationPhase !== 'ready')) {
        throw new Error('A reprodução mudou. Tente o controle novamente.');
      }
      targetContext = transportContext(get().snapshot.session);
      receive(await sendMediaControl(action, action === 'volume' ? null : session?.id ?? null, value));
    });
    controlQueue = command;
    try { await command; }
    catch (error) {
      // Only a different confirmed track/playback context makes an old refusal
      // obsolete. Pending metadata, volume or artwork updates prove no success.
      if (action === 'volume' || !hasNewTransportContext(get().snapshot, targetContext)) recordFailure(errorMessage(error));
      throw error;
    }
    finally { queuedControls -= 1; set({ pending: queuedControls > 0 }); }
  },
}));

let consumers = 0;
let setupPromise: Promise<void> | null = null;
let hydrationPromise: Promise<void> | null = null;
let unlisten: (() => void) | null = null;

async function ensureConnection(): Promise<void> {
  if (unlisten) return;
  setupPromise ??= (async () => {
    const cleanup = await watchMedia(receive, receivePosition);
    if (consumers === 0) cleanup();
    else unlisten = cleanup;
  })();
  try { await setupPromise; }
  finally { setupPromise = null; }
}

/** One listener per WebView; the Windows worker owns polling for all windows. */
export async function initializeMedia(): Promise<() => void> {
  consumers += 1;
  // Retain ownership after a startup failure so the visible retry button can
  // reconnect the transport, and cleanup still belongs to the mounted App.
  hydrationPromise ??= useMediaStore.getState().refreshMedia().finally(() => { hydrationPromise = null; });
  try { await hydrationPromise; } catch { /* Failure is visible in the store. */ }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    consumers -= 1;
    if (consumers === 0) {
      unlisten?.(); unlisten = null;
      cancelPresentationTimer();
      const latest = useMediaStore.getState();
      if (latest.presentationPhase === 'updating') {
        useMediaStore.setState({ displaySession: null, presentationPhase: 'empty' });
      }
    }
  };
}
