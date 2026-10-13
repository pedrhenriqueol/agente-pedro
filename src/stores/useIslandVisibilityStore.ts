import { create } from 'zustand';
import { configureIslandVisibility, DEFAULT_ISLAND_VISIBILITY, readIslandVisibility, reportIslandActivity,
  watchIslandVisibility, type IslandHideDelay, type IslandMode, type IslandVisibilitySnapshot } from '../services/islandVisibility';

interface VisibilityStore {
  snapshot: IslandVisibilitySnapshot;
  error: string | null;
  configure: (mode: IslandMode, delaySeconds: IslandHideDelay) => Promise<void>;
  notifyActivity: () => void;
}

function receive(snapshot: IslandVisibilitySnapshot): void {
  if (snapshot.revision < useIslandVisibilityStore.getState().snapshot.revision) return;
  useIslandVisibilityStore.setState({ snapshot });
}

const message = (error: unknown) => typeof error === 'string' ? error : error instanceof Error ? error.message
  : 'Não foi possível atualizar a visibilidade da ilha.';
let configureQueue = Promise.resolve();
let lastActivity = 0;

export const useIslandVisibilityStore = create<VisibilityStore>((set) => ({
  snapshot: { ...DEFAULT_ISLAND_VISIBILITY }, error: null,
  configure: async (mode, delaySeconds) => {
    const request = configureQueue.catch(() => {}).then(async () => {
      // A previous startup failure must not leave the visibility listener disconnected.
      if (consumers > 0) await connect();
      receive(await configureIslandVisibility(mode, delaySeconds));
      set({ error: null });
    });
    configureQueue = request;
    try { await request; }
    catch (error) { set({ error: message(error) }); throw error; }
  },
  notifyActivity: () => {
    if (Date.now() - lastActivity < 200) return;
    lastActivity = Date.now();
    void reportIslandActivity().catch(error => set({ error: message(error) }));
  },
}));

let consumers = 0;
let connection: Promise<void> | null = null;
let initialization: Promise<void> | null = null;
let unlisten: (() => void) | null = null;

async function connect(): Promise<void> {
  if (unlisten) return;
  connection ??= (async () => {
    const stop = await watchIslandVisibility(receive);
    if (consumers === 0) stop(); else unlisten = stop;
  })();
  try { await connection; } finally { connection = null; }
}

/** The island App owns this listener even while database startup is pending. */
export async function initializeIslandVisibility(): Promise<() => void> {
  consumers += 1;
  initialization ??= (async () => { await connect(); receive(await readIslandVisibility()); })()
    .finally(() => { initialization = null; });
  try { await initialization; }
  catch (error) { useIslandVisibilityStore.setState({ error: message(error) }); }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    consumers -= 1;
    if (consumers === 0) { unlisten?.(); unlisten = null; }
  };
}
