import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

// Run the real visibility store/service and replace only the native IPC boundary.
const bundle = await build({
  stdin: {
    contents: `export * from './src/stores/useIslandVisibilityStore';
      export * from './src/services/islandVisibility';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{
    name: 'visibility-ipc-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/(core|event)$/ }, ({ path }) => ({ path, namespace: 'visibility-ipc' }));
      builder.onLoad({ filter: /./, namespace: 'visibility-ipc' }, ({ path }) => ({
        contents: path.endsWith('/core')
          ? `export const isTauri = () => globalThis.visibilityIpc.native;
             export const invoke = (command, args) => globalThis.visibilityIpc.invoke(command, args);`
          : `export const listen = (event, callback) => globalThis.visibilityIpc.listen(event, callback);`,
        loader: 'js',
      }));
    },
  }],
});
const compiled = bundle.outputFiles[0].text;
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
function deferred() {
  let resolve; let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}
function snapshot(overrides = {}) {
  return { revision: 1, supported: true, mode: 'fixed', delaySeconds: 3, visible: true, reason: 'fixed', error: null, ...overrides };
}

function environment({ native = true, initial = snapshot() } = {}) {
  const calls = []; const trace = []; const listeners = new Map(); const removed = [];
  const clock = { now: 10_000 };
  let sequence = 0; let failListen = false;
  let invoke = async (command, args) => {
    if (command === 'island_visibility_snapshot') return initial;
    if (command === 'configure_island_visibility') return snapshot({ ...args, revision: initial.revision + 1 });
    if (command === 'island_activity' || command === 'complete_island_visibility_transition') return;
    throw new Error(`IPC inesperado: ${command}`);
  };
  class ClockDate extends Date {
    static now() { return clock.now; }
  }
  const visibilityIpc = {
    native,
    async invoke(command, args) {
      trace.push(`invoke:${command}`); calls.push({ command, args }); return invoke(command, args);
    },
    async listen(event, callback) {
      trace.push(`listen:${event}`);
      if (failListen) throw new Error('Listener de visibilidade indisponível');
      const id = ++sequence; listeners.set(id, { event, callback });
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true; removed.push(id); listeners.delete(id);
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, visibilityIpc, Date: ClockDate, Error, console, setTimeout, clearTimeout, queueMicrotask,
  });
  return {
    ...module.exports, calls, trace, listeners, removed, clock,
    handleInvoke(handler) { invoke = handler; },
    rejectListen(value) { failListen = value; },
    emit(payload) {
      for (const { event, callback } of listeners.values()) callback({ event, payload });
    },
  };
}

test('Navegador mantém a ilha visível e informa suporte indisponível sem acionar comandos nativos', async () => {
  const env = environment({ native: false });
  const close = await env.initializeIslandVisibility();
  try {
    assert.deepEqual(plain(env.useIslandVisibilityStore.getState().snapshot), plain(env.DEFAULT_ISLAND_VISIBILITY));
    await env.useIslandVisibilityStore.getState().configure('hybrid', 10);
    const current = env.useIslandVisibilityStore.getState().snapshot;
    assert.equal(current.supported, false);
    assert.equal(current.visible, true, 'O preview não pode fingir que uma janela nativa foi ocultada');
    assert.equal(current.mode, 'hybrid');
    assert.equal(current.delaySeconds, 10);
    env.useIslandVisibilityStore.getState().notifyActivity();
    await settle();
    assert.equal(env.calls.length, 0);
    assert.equal(env.listeners.size, 0);
  } finally { close(); close(); }
});

test('A saída animada mantém o HWND confirmado até o ack e ignora um evento antigo após a reversão', async () => {
  const env = environment();
  const close = await env.initializeIslandVisibility();
  try {
    env.emit(snapshot({ revision: 10, mode: 'hybrid', reason: 'idle', visible: true,
      transition: { generation: 7, visible: false, durationMs: 180 } }));
    const exit = env.useIslandVisibilityStore.getState().snapshot;
    assert.equal(exit.visible, true, 'O HWND existe enquanto a saída anima');
    assert.equal(exit.transition.visible, false);
    await env.completeIslandVisibilityTransition(7);
    assert.deepEqual(plain(env.calls.at(-1)), { command: 'complete_island_visibility_transition', args: { generation: 7 } });
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, true, 'O wrapper não inventa uma confirmação nativa');
    env.emit(snapshot({ revision: 12, mode: 'hybrid', reason: 'reveal', visible: true,
      transition: { generation: 8, visible: true, durationMs: 200 } }));
    env.emit(snapshot({ revision: 11, mode: 'hybrid', reason: 'idle', visible: false, transition: null }));
    const reversed = env.useIslandVisibilityStore.getState().snapshot;
    assert.equal(reversed.visible, true);
    assert.equal(reversed.transition.generation, 8);
  } finally { close(); }
});

test('Snapshot inicial atrasado não torna visível a ilha já ocultada por uma revisão mais recente', async () => {
  const env = environment(); const initialRead = deferred();
  env.handleInvoke(() => initialRead.promise);
  const initializing = env.initializeIslandVisibility();
  await settle();
  assert.deepEqual(env.trace, ['listen:pedro:island-visibility', 'invoke:island_visibility_snapshot']);
  assert.equal(env.listeners.size, 1, 'A assinatura precisa anteceder a leitura inicial');
  env.emit(snapshot({ revision: 8, mode: 'hybrid', visible: false, reason: 'fullscreen' }));
  initialRead.resolve(snapshot({ revision: 7 }));
  const close = await initializing;
  try {
    const current = env.useIslandVisibilityStore.getState().snapshot;
    assert.equal(current.revision, 8);
    assert.equal(current.visible, false);
    assert.equal(current.reason, 'fullscreen');
    env.emit(snapshot({ revision: 6, visible: true }));
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, false);
  } finally { close(); }
});

test('Montagens concorrentes e remonte StrictMode compartilham uma assinatura e limpam a última referência', async () => {
  const env = environment();
  const [closeFirst, closeSecond] = await Promise.all([env.initializeIslandVisibility(), env.initializeIslandVisibility()]);
  try {
    assert.equal(env.listeners.size, 1);
    assert.equal(env.calls.length, 1);
    closeFirst(); closeFirst();
    assert.equal(env.listeners.size, 1, 'Limpeza repetida não remove a assinatura da outra montagem');
    env.emit(snapshot({ revision: 2, mode: 'hybrid', visible: false, reason: 'idle' }));
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, false);
    closeSecond();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.removed.length, 1);
    const closeRestart = await env.initializeIslandVisibility();
    try {
      assert.equal(env.listeners.size, 1);
      assert.equal(env.calls.length, 2);
    } finally { closeRestart(); }
    assert.equal(env.listeners.size, 0);
    assert.equal(env.removed.length, 2);
  } finally { closeFirst(); closeSecond(); }
});

test('Alterações rápidas de preferência seguem a ordem da fila e usam delaySeconds no contrato IPC', async () => {
  const env = environment(); const close = await env.initializeIslandVisibility();
  const requests = [];
  env.handleInvoke((command, args) => {
    assert.equal(command, 'configure_island_visibility');
    const response = deferred(); requests.push({ args, ...response }); return response.promise;
  });
  try {
    const first = env.useIslandVisibilityStore.getState().configure('hybrid', 5);
    const second = env.useIslandVisibilityStore.getState().configure('fixed', 10);
    const last = env.useIslandVisibilityStore.getState().configure('hybrid', 3);
    await settle();
    assert.equal(requests.length, 1);
    assert.deepEqual(plain(requests[0].args), { mode: 'hybrid', delaySeconds: 5 });
    requests[0].resolve(snapshot({ revision: 2, mode: 'hybrid', delaySeconds: 5 }));
    await first; await settle();
    assert.equal(requests.length, 2);
    assert.deepEqual(plain(requests[1].args), { mode: 'fixed', delaySeconds: 10 });
    requests[1].resolve(snapshot({ revision: 3, mode: 'fixed', delaySeconds: 10 }));
    await second; await settle();
    assert.equal(requests.length, 3);
    assert.deepEqual(plain(requests[2].args), { mode: 'hybrid', delaySeconds: 3 });
    requests[2].resolve(snapshot({ revision: 4, mode: 'hybrid', delaySeconds: 3 }));
    await last;
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.mode, 'hybrid');
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.delaySeconds, 3);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.revision, 4);
  } finally { close(); }
});

test('Configurar após falha de inicialização restaura a assinatura e recebe novas decisões do worker', async () => {
  const env = environment();
  env.rejectListen(true);
  const close = await env.initializeIslandVisibility();
  try {
    assert.equal(env.listeners.size, 0);
    assert.equal(env.calls.length, 0);
    assert.match(env.useIslandVisibilityStore.getState().error, /Listener de visibilidade indisponível/);
    env.rejectListen(false);
    await env.useIslandVisibilityStore.getState().configure('hybrid', 5);
    assert.equal(env.listeners.size, 1);
    assert.equal(env.useIslandVisibilityStore.getState().error, null);
    assert.deepEqual(plain(env.calls[0]), { command: 'configure_island_visibility', args: { mode: 'hybrid', delaySeconds: 5 } });
    env.emit(snapshot({ revision: 3, mode: 'hybrid', delaySeconds: 5, visible: false, reason: 'idle' }));
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, false);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.reason, 'idle');
  } finally { close(); }
  assert.equal(env.listeners.size, 0);
  assert.equal(env.removed.length, 1);
});

test('Falha de configuração preserva o snapshot real e uma solicitação posterior recupera a fila', async () => {
  const hidden = snapshot({ revision: 9, mode: 'hybrid', delaySeconds: 5, visible: false, reason: 'fullscreen' });
  const env = environment({ initial: hidden }); const close = await env.initializeIslandVisibility();
  try {
    env.handleInvoke(async () => { throw new Error('Preferência não foi gravada'); });
    await assert.rejects(env.useIslandVisibilityStore.getState().configure('fixed', 10), /não foi gravada/);
    assert.deepEqual(plain(env.useIslandVisibilityStore.getState().snapshot), hidden);
    assert.match(env.useIslandVisibilityStore.getState().error, /não foi gravada/);
    env.handleInvoke(async () => snapshot({ revision: 10, mode: 'fixed', delaySeconds: 10 }));
    await env.useIslandVisibilityStore.getState().configure('fixed', 10);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, true);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.reason, 'fixed');
    assert.equal(env.useIslandVisibilityStore.getState().error, null);
  } finally { close(); }
});

test('Resposta de configuração atrasada não substitui decisão de ocultação mais recente do worker', async () => {
  const env = environment(); const close = await env.initializeIslandVisibility();
  const response = deferred(); env.handleInvoke(() => response.promise);
  try {
    const changing = env.useIslandVisibilityStore.getState().configure('hybrid', 5);
    await settle();
    env.emit(snapshot({ revision: 4, mode: 'hybrid', delaySeconds: 5, visible: false, reason: 'idle' }));
    response.resolve(snapshot({ revision: 3, mode: 'hybrid', delaySeconds: 5, visible: true, reason: 'reveal' }));
    await changing;
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.revision, 4);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, false);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.reason, 'idle');
  } finally { close(); }
});

test('Atividade é limitada a 200 ms e uma ilha oculta aguarda a decisão real do worker para aparecer', async () => {
  const hidden = snapshot({ revision: 5, mode: 'hybrid', visible: false, reason: 'idle' });
  const env = environment({ initial: hidden }); const close = await env.initializeIslandVisibility();
  try {
    const notify = env.useIslandVisibilityStore.getState().notifyActivity;
    notify(); notify();
    env.clock.now += 199; notify();
    await settle();
    assert.equal(env.calls.filter(({ command }) => command === 'island_activity').length, 1);
    assert.deepEqual(plain(env.useIslandVisibilityStore.getState().snapshot), hidden);
    env.clock.now += 1; notify();
    await settle();
    assert.equal(env.calls.filter(({ command }) => command === 'island_activity').length, 2);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, false, 'Activity IPC sozinho não confirma que a janela foi mostrada');
    env.emit(snapshot({ revision: 6, mode: 'hybrid', visible: true, reason: 'reveal' }));
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.visible, true);
    assert.equal(env.useIslandVisibilityStore.getState().snapshot.reason, 'reveal');
  } finally { close(); }
});
