import { create } from 'zustand';
import { EMPTY_MEDIA, readMedia, sendMediaControl, watchMedia, type MediaAction, type MediaPosition, type MediaSnapshot } from '../services/mediaClient';

interface MediaStore {
  snapshot: MediaSnapshot;
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

function receive(snapshot: MediaSnapshot): void {
  const current = useMediaStore.getState();
  if (current.initialized && (snapshot.revision < current.snapshot.revision
    || snapshot.revision === current.snapshot.revision && snapshot.sequence < current.snapshot.sequence)) return;
  useMediaStore.setState({ snapshot, initialized: true, observedAt: Date.now() });
}

function receivePosition(position: MediaPosition): void {
  const { snapshot } = useMediaStore.getState();
  if (snapshot.revision !== position.revision || position.sequence < snapshot.sequence || snapshot.session?.id !== position.sessionId) return;
  useMediaStore.setState({ snapshot: { ...snapshot, sequence: position.sequence, session: { ...snapshot.session,
    positionSeconds: position.positionSeconds, durationSeconds: position.durationSeconds } }, observedAt: Date.now() });
}

let controlQueue = Promise.resolve();
let queuedControls = 0;

export const useMediaStore = create<MediaStore>((set, get) => ({
  snapshot: { ...EMPTY_MEDIA }, initialized: false, observedAt: Date.now(), pending: false, error: null,
  clearError: () => set({ error: null }),
  refreshMedia: async () => {
    try {
      if (consumers > 0) await ensureConnection();
      receive(await readMedia()); set({ error: null });
    }
    catch (error) { set({ initialized: true, error: errorMessage(error) }); throw error; }
  },
  controlMedia: async (action, value) => {
    if (get().pending && action !== 'volume') return;
    const { snapshot } = get();
    const refuse = (message: string): never => { set({ error: message }); throw new Error(message); };
    if (!snapshot.supported) refuse('Os controles de música estão disponíveis no aplicativo para Windows.');
    const session = snapshot.session;
    if (action !== 'volume' && !session) refuse('Nenhuma reprodução foi encontrada. Dê play no seu navegador.');
    const capabilities = { play: session?.canPlay, pause: session?.canPause,
      next: session?.canGoNext, previous: session?.canGoPrevious };
    if (action !== 'volume' && !capabilities[action]) refuse('Esse controle não está disponível na reprodução atual.');
    if (action === 'volume' && (!Number.isFinite(value) || value! < 0 || value! > 100)) {
      refuse('Escolha um volume entre 0 e 100.');
    }
    queuedControls += 1;
    set({ pending: true, error: null });
    const command = controlQueue.catch(() => {}).then(async () => {
      receive(await sendMediaControl(action, session?.id ?? null, value));
    });
    controlQueue = command;
    try { await command; }
    catch (error) { set({ error: errorMessage(error) }); throw error; }
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
    if (consumers === 0) { unlisten?.(); unlisten = null; }
  };
}
