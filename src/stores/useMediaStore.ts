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
  clearError: () => void;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message
  : typeof error === 'string' ? error : 'Não foi possível atualizar a reprodução. Tente novamente.';

let presentationTimer: ReturnType<typeof setTimeout> | null = null;
let readFailed = false;
let observation = 0;
let refreshSequence = 0;
let settledRefresh = 0;
let localFailure: { source: 'read' | 'transport' | 'volume'; revision: number } | null = null;

const hasContent = (session: MediaSession | null): session is MediaSession =>
  Boolean(session && (session.title.trim() || session.artist.trim()));

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
    || localFailure?.source === 'transport' && snapshot.revision > localFailure.revision;
  if (recovered) localFailure = null;
  const base = { snapshot, initialized: true, observedAt: Date.now(), ...(recovered ? { error: null } : {}) };
  readFailed = false;
  if (!snapshot.supported || snapshot.error) {
    cancelPresentationTimer();
    useMediaStore.setState({ ...base, displaySession: null, presentationPhase: 'unavailable' });
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
  if (!snapshot.supported || snapshot.error || !hasContent(snapshot.session)
    || snapshot.revision !== position.revision || position.sequence < snapshot.sequence || snapshot.session.id !== position.sessionId) return;
  observation += 1;
  const session = { ...snapshot.session, positionSeconds: position.positionSeconds, durationSeconds: position.durationSeconds };
  // The worker may emit only position ticks while a healthy track stays the
  // same. They recover an IPC read failure, never a native or transport error.
  const recoverRead = readFailed;
  const clearReadError = recoverRead && localFailure?.source === 'read';
  if (clearReadError) localFailure = null;
  readFailed = false;
  useMediaStore.setState({ snapshot: { ...snapshot, sequence: position.sequence, session },
    displaySession: session, observedAt: Date.now(), ...(recoverRead ? { presentationPhase: 'ready' } : {}),
    ...(clearReadError ? { error: null } : {}) });
}

let controlQueue = Promise.resolve();
let queuedControls = 0;

export const useMediaStore = create<MediaStore>((set, get) => ({
  snapshot: { ...EMPTY_MEDIA }, displaySession: null, presentationPhase: 'loading',
  initialized: false, observedAt: Date.now(), pending: false, error: null,
  clearError: () => { localFailure = null; set({ error: null }); },
  refreshMedia: async () => {
    const request = ++refreshSequence;
    const startedAt = observation;
    try {
      if (consumers > 0) await ensureConnection();
      const snapshot = await readMedia();
      if (request < settledRefresh) return;
      settledRefresh = request;
      if (receive(snapshot)) { localFailure = null; set({ error: null }); }
    }
    catch (error) {
      const superseded = request < settledRefresh || startedAt !== observation;
      settledRefresh = Math.max(settledRefresh, request);
      if (superseded) throw error;
      cancelPresentationTimer();
      readFailed = true;
      const snapshot = get().snapshot;
      localFailure = { source: 'read', revision: snapshot.revision };
      set({ initialized: true, displaySession: snapshot.supported && !snapshot.error && hasContent(snapshot.session) ? snapshot.session : null,
        presentationPhase: 'unavailable', error: errorMessage(error) });
      throw error;
    }
  },
  controlMedia: async (action, value) => {
    if (get().pending && action !== 'volume') return;
    const { snapshot } = get();
    let targetRevision = snapshot.revision;
    const recordFailure = (message: string) => {
      localFailure = { source: action === 'volume' ? 'volume' : 'transport', revision: targetRevision };
      set({ error: message });
    };
    const refuse = (message: string): never => { recordFailure(message); throw new Error(message); };
    if (!snapshot.supported) refuse('Os controles de música estão disponíveis no aplicativo para Windows.');
    const session = snapshot.session;
    if (action !== 'volume' && !hasContent(session)) refuse('Nenhuma reprodução foi encontrada. Dê play no seu navegador.');
    if (action !== 'volume' && get().presentationPhase === 'unavailable') refuse('Atualize a reprodução antes de usar os controles.');
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
      targetRevision = get().snapshot.revision;
      receive(await sendMediaControl(action, action === 'volume' ? null : session?.id ?? null, value));
    });
    controlQueue = command;
    try { await command; }
    catch (error) {
      // A late rejection belongs to the old transport context. A new semantic
      // snapshot already reconciled discovery; never retry a skip implicitly.
      if (action === 'volume' || get().snapshot.revision <= targetRevision) recordFailure(errorMessage(error));
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
