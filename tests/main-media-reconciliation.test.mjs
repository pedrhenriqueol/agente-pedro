import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

// Exercise the wake listener together with the real store and media client.
// Only the native IPC/window boundary and document visibility are controlled.
const bundle = await build({
  stdin: {
    contents: `export * from './src/services/mainMediaReconciliation';
      export * from './src/stores/useMediaStore';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{
    name: 'main-wake-native-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/(core|event|window)$/ }, ({ path }) => ({ path, namespace: 'wake-native' }));
      builder.onLoad({ filter: /./, namespace: 'wake-native' }, ({ path }) => ({
        contents: path.endsWith('/core')
          ? `export const isTauri = () => globalThis.nativeBoundary.native;
             export const invoke = (command, args) => globalThis.nativeBoundary.invoke(command, args);`
          : path.endsWith('/event')
            ? `export const listen = (event, callback) => globalThis.nativeBoundary.listen(event, callback);`
            : `export const getCurrentWindow = () => ({ onFocusChanged: callback => globalThis.nativeBoundary.onFocusChanged(callback) });`,
        loader: 'js',
      }));
    },
  }],
});
const compiled = bundle.outputFiles[0].text;
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve; let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}
function snapshot(revision = 1, title = 'Faixa atual') {
  return {
    revision, sequence: revision, supported: true, sessionUpdating: false,
    volume: 50, muted: false, error: null,
    session: {
      id: 'retained-native-session', sourceApp: 'opera.exe', title, artist: 'Artista', album: '',
      artwork: null, playbackStatus: 'playing', canPlay: true, canPause: true,
      canGoNext: true, canGoPrevious: true, positionSeconds: 10, durationSeconds: 180,
    },
  };
}
function environment({ native = true, registration = null, registrationFails = false } = {}) {
  const calls = []; const focusListeners = new Map(); const mediaListeners = new Map();
  const documentListeners = new Map(); const timers = new Map();
  let sequence = 0; let focusRegistrations = 0; let focusRemovals = 0; let now = 0;
  let invoke = async command => {
    if (command === 'media_snapshot') return snapshot();
    throw new Error(`Comando inesperado: ${command}`);
  };
  const document = {
    visibilityState: 'visible',
    addEventListener(event, callback) {
      if (!documentListeners.has(event)) documentListeners.set(event, new Set());
      documentListeners.get(event).add(callback);
    },
    removeEventListener(event, callback) { documentListeners.get(event)?.delete(callback); },
  };
  const nativeBoundary = {
    native,
    async invoke(command, args) { calls.push({ command, args }); return invoke(command, args); },
    async listen(event, callback) {
      const id = ++sequence; mediaListeners.set(id, { event, callback });
      return () => mediaListeners.delete(id);
    },
    async onFocusChanged(callback) {
      focusRegistrations += 1;
      if (registrationFails) throw new Error('Registro nativo indisponível');
      if (registration) await registration.promise;
      const id = ++sequence; focusListeners.set(id, callback);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true; focusRemovals += 1; focusListeners.delete(id);
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, nativeBoundary, document, console, Error, queueMicrotask,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    ...module.exports, calls, focusListeners, mediaListeners, documentListeners, timers,
    get focusRegistrations() { return focusRegistrations; },
    get focusRemovals() { return focusRemovals; },
    setInvoke(handler) { invoke = handler; },
    focus(value = true) { for (const callback of [...focusListeners.values()]) callback({ payload: value }); },
    visibility(value) {
      document.visibilityState = value;
      for (const callback of [...documentListeners.get('visibilitychange') ?? []]) callback();
    },
    emit(event, payload) {
      for (const listener of [...mediaListeners.values()]) if (listener.event === event) listener.callback({ payload });
    },
    async advance(milliseconds = 50) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await settle();
      }
      now = target; await settle();
    },
  };
}

test('Reconciliação registra somente main nativo e não faz leitura extra ao montar', async () => {
  for (const label of ['island', 'dock', 'top-left', 'top-right']) {
    const env = environment(); const close = env.initializeMainMediaReconciliation(label);
    await settle(); env.focus(); env.visibility('visible'); await env.advance(); close();
    assert.equal(env.calls.length, 0); assert.equal(env.focusRegistrations, 0);
    assert.equal(env.documentListeners.size, 0);
  }
  const browser = environment({ native: false });
  const closeBrowser = browser.initializeMainMediaReconciliation('main');
  await settle(); browser.visibility('visible'); await browser.advance(); closeBrowser();
  assert.equal(browser.calls.length, 0); assert.equal(browser.focusRegistrations, 0);
  const env = environment(); const close = env.initializeMainMediaReconciliation('main');
  await settle();
  assert.equal(env.calls.length, 0, 'initializeMedia conserva a responsabilidade da leitura inicial');
  assert.equal(env.focusRegistrations, 1);
  close();
});

test('Foco e visibilidade coincidentes fazem uma consulta de cache, sem transporte', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia();
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  try {
    env.focus(false); env.visibility('hidden'); await env.advance();
    assert.equal(env.calls.length, 1);
    env.focus(); env.visibility('visible'); env.focus();
    await env.advance(49); assert.equal(env.calls.length, 1);
    await env.advance(1); assert.equal(env.calls.length, 2);
    await env.advance(30_000); assert.equal(env.calls.length, 2, 'Não existe polling por WebView');
    assert.ok(env.calls.every(({ command }) => command === 'media_snapshot'));
    assert.equal(env.mediaListeners.size, 2, 'O wake não duplica os listeners do initializeMedia');
  } finally { close(); closeMedia(); }
});

test('Wakes durante uma leitura fazem no máximo uma leitura final e liberam novo ciclo', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia();
  const first = deferred(); const trailing = deferred(); let reads = 0;
  env.setInvoke(() => (++reads === 1 ? first.promise : reads === 2 ? trailing.promise : snapshot(4)));
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  try {
    env.focus(); await env.advance(); assert.equal(reads, 1);
    env.focus(); env.visibility('visible'); env.focus();
    first.resolve(snapshot(2)); await settle(); assert.equal(reads, 2);
    env.focus(); env.visibility('visible');
    trailing.resolve(snapshot(3)); await settle(); await env.advance(1_000);
    assert.equal(reads, 2, 'Sinais enquanto a leitura final está pendente não geram loop de IPC');
    env.focus(); await env.advance(); assert.equal(reads, 3);
    assert.equal(env.useMediaStore.getState().snapshot.revision, 4);
  } finally { close(); closeMedia(); }
});

test('Limpeza cancela wake agendado e remove os dois listeners de forma idempotente', async () => {
  const env = environment(); const close = env.initializeMainMediaReconciliation('main'); await settle();
  env.focus(); assert.equal(env.timers.size, 1);
  const lateCallback = [...env.focusListeners.values()][0];
  close(); close(); lateCallback({ payload: true }); env.visibility('visible'); await env.advance();
  assert.equal(env.calls.length, 0); assert.equal(env.timers.size, 0);
  assert.equal(env.focusRemovals, 1); assert.equal(env.focusListeners.size, 0);
  assert.equal(env.documentListeners.get('visibilitychange').size, 0);
});

test('StrictMode remove registro assíncrono tardio sem remover o listener da remontagem', async () => {
  const registration = deferred(); const env = environment({ registration });
  const closeFirst = env.initializeMainMediaReconciliation('main'); await settle(); closeFirst();
  const closeSecond = env.initializeMainMediaReconciliation('main'); await settle();
  registration.resolve(); await settle();
  assert.equal(env.focusRegistrations, 2); assert.equal(env.focusRemovals, 1);
  assert.equal(env.focusListeners.size, 1); assert.equal(env.documentListeners.get('visibilitychange').size, 1);
  env.focus(); env.visibility('visible'); await env.advance();
  assert.equal(env.calls.length, 1);
  closeSecond(); assert.equal(env.focusRemovals, 2); assert.equal(env.focusListeners.size, 0);
});

test('Falha no registro nativo preserva fallback de visibilidade e limpeza', async () => {
  const env = environment({ registrationFails: true });
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  env.visibility('visible'); await env.advance(); assert.equal(env.calls.length, 1);
  close(); env.visibility('visible'); await env.advance(); assert.equal(env.calls.length, 1);
});

test('Falha de leitura não cria retry automático e o próximo wake pode reconciliar', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia();
  env.setInvoke(async () => { throw new Error('Cache temporariamente inacessível'); });
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  try {
    env.focus(); await env.advance(); await env.advance(30_000);
    assert.equal(env.calls.length, 2);
    env.setInvoke(async () => snapshot(2, 'Recuperada'));
    env.focus(); await env.advance();
    assert.equal(env.calls.length, 3);
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Recuperada');
    assert.ok(env.calls.every(({ command }) => command === 'media_snapshot'));
  } finally { close(); closeMedia(); }
});

test('Cache atrasado no wake não substitui evento saudável recebido depois', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia(); const cache = deferred();
  env.setInvoke(() => cache.promise);
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  try {
    env.focus(); await env.advance();
    assert.equal(env.calls.length, 2, 'O segundo IPC é a reconciliação do wake');
    env.emit('pedro:media', snapshot(8, 'Faixa nova por evento'));
    cache.resolve(snapshot(7, 'Faixa antiga do cache')); await settle();
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa nova por evento');
    assert.equal(env.useMediaStore.getState().snapshot.revision, 8);
  } finally { close(); closeMedia(); }
});

test('Reexibir o painel preserva recusa de volume legítima até ação explícita', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia();
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  try {
    await assert.rejects(env.useMediaStore.getState().controlMedia('volume', 150), /entre 0 e 100/);
    const error = env.useMediaStore.getState().error;
    env.focus(); await env.advance();
    assert.equal(env.calls.length, 2);
    assert.equal(env.useMediaStore.getState().error, error);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.ok(env.calls.every(({ command }) => command === 'media_snapshot'));
  } finally { close(); closeMedia(); }
});

test('Limpeza durante leitura impede a reconciliação final pendente', async () => {
  const env = environment(); const closeMedia = await env.initializeMedia(); const cache = deferred();
  env.setInvoke(() => cache.promise);
  const close = env.initializeMainMediaReconciliation('main'); await settle();
  env.focus(); await env.advance(); env.focus(); close();
  cache.resolve(snapshot(2)); await settle(); await env.advance(1_000);
  assert.equal(env.calls.length, 2);
  assert.equal(env.focusListeners.size, 0); closeMedia();
});
