import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

// Bundle the real persisted store; replace only the Tauri event boundary.
const bundle = await build({
  entryPoints: ['src/stores/usePreferencesStore.ts'],
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{
    name: 'preferences-ipc-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/event$/ }, ({ path }) => ({ path, namespace: 'preferences-ipc' }));
      builder.onLoad({ filter: /./, namespace: 'preferences-ipc' }, () => ({
        contents: `export const emit = (event, payload) => globalThis.preferencesIpc.emit(event, payload);
          export const listen = (event, callback) => globalThis.preferencesIpc.listen(event, callback);`,
        loader: 'js',
      }));
    },
  }],
});
const compiled = bundle.outputFiles[0].text;
const STORAGE_KEY = 'pedro_preferences_v1';
const plain = (value) => JSON.parse(JSON.stringify(value));

function environment({ native = false, persisted } = {}) {
  const storage = new Map();
  if (persisted) storage.set(STORAGE_KEY, JSON.stringify({ state: persisted, version: 0 }));
  const browserListeners = new Map();
  const nativeListeners = new Set();
  const emitted = [];
  const window = {
    addEventListener(event, callback) {
      const entries = browserListeners.get(event) ?? new Set();
      entries.add(callback); browserListeners.set(event, entries);
    },
    removeEventListener(event, callback) { browserListeners.get(event)?.delete(callback); },
    ...(native ? { __TAURI_INTERNALS__: {} } : {}),
  };
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  window.localStorage = localStorage;
  const preferencesIpc = {
    async emit(event, payload) { emitted.push({ event, payload: plain(payload) }); },
    async listen(event, callback) {
      const listener = { event, callback }; nativeListeners.add(listener);
      return () => nativeListeners.delete(listener);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, window, localStorage, preferencesIpc, crypto: { randomUUID }, console,
  });
  return {
    ...module.exports, emitted, browserListeners, nativeListeners,
    saved() { return JSON.parse(storage.get(STORAGE_KEY)).state; },
    receiveStorage(preferences, key = STORAGE_KEY) {
      const newValue = JSON.stringify({ state: preferences, version: 0 });
      storage.set(key, newValue);
      for (const callback of browserListeners.get('storage') ?? []) callback({ key, newValue });
    },
    receiveNative(source, preferences) {
      for (const listener of nativeListeners) {
        if (listener.event === 'pedro:preferences') listener.callback({ payload: { source, preferences } });
      }
    },
  };
}

test('Preferências antigas recebem ilha fixa e 3 segundos sem perder o tema e as opacidades', () => {
  const env = environment({ persisted: {
    theme: 'light', accent: 'violet', reduceMotion: true, dockEnabled: false,
    islandIdle: 'balance', islandOpacity: .72, dockOpacity: .81,
  } });
  const state = env.usePreferencesStore.getState();
  assert.equal(state.islandVisibility, 'fixed');
  assert.equal(state.islandHideDelay, 3);
  assert.equal(state.theme, 'light');
  assert.equal(state.accent, 'violet');
  assert.equal(state.reduceMotion, true);
  assert.equal(state.dockEnabled, false);
  assert.equal(state.islandIdle, 'balance');
  assert.equal(state.islandOpacity, .72);
  assert.equal(state.dockOpacity, .81);
  state.updatePreferences({ accent: 'blue' });
  assert.equal(env.saved().islandVisibility, 'fixed');
  assert.equal(env.saved().islandHideDelay, 3);
  const reopened = environment({ persisted: env.saved() });
  assert.equal(reopened.usePreferencesStore.getState().theme, 'light');
  assert.equal(reopened.usePreferencesStore.getState().islandOpacity, .72);
});

test('Modo e atraso inválidos são normalizados para fixo e 3 segundos na hidratação e nas alterações', () => {
  const env = environment({ persisted: { islandVisibility: 'automatic', islandHideDelay: 7, theme: 'light' } });
  assert.equal(env.usePreferencesStore.getState().islandVisibility, 'fixed');
  assert.equal(env.usePreferencesStore.getState().islandHideDelay, 3);
  assert.equal(env.usePreferencesStore.getState().theme, 'light');
  for (const [visibility, delay] of [['hidden', 0], [null, '5'], [false, Infinity], [undefined, NaN]]) {
    env.usePreferencesStore.getState().updatePreferences({ islandVisibility: 'hybrid', islandHideDelay: 10 });
    env.usePreferencesStore.getState().updatePreferences({ islandVisibility: visibility, islandHideDelay: delay });
    assert.equal(env.usePreferencesStore.getState().islandVisibility, 'fixed');
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 3);
    assert.equal(env.saved().islandVisibility, 'fixed');
    assert.equal(env.saved().islandHideDelay, 3);
  }
});

test('Modo híbrido e atrasos suportados persistem e são enviados no evento nativo com os demais ajustes', () => {
  const env = environment({ native: true });
  for (const delay of [3, 5, 10]) {
    env.usePreferencesStore.getState().updatePreferences({
      islandVisibility: 'hybrid', islandHideDelay: delay, islandOpacity: .68, theme: 'light',
    });
    const saved = env.saved();
    assert.equal(saved.islandVisibility, 'hybrid');
    assert.equal(saved.islandHideDelay, delay);
    assert.equal(saved.islandOpacity, .68);
    const announced = env.emitted.at(-1);
    assert.equal(announced.event, 'pedro:preferences');
    assert.equal(typeof announced.payload.source, 'string');
    assert.deepEqual(announced.payload.preferences, saved);
    assert.equal(Object.hasOwn(saved, 'updatePreferences'), false);
    assert.equal(Object.hasOwn(saved, 'resetPreferences'), false);
    const reopened = environment({ persisted: saved });
    assert.equal(reopened.usePreferencesStore.getState().islandVisibility, 'hybrid');
    assert.equal(reopened.usePreferencesStore.getState().islandHideDelay, delay);
  }
  assert.equal(env.emitted.length, 3);
});

test('Evento storage sincroniza modo e atraso sem publicar preferências nativas de volta', async () => {
  const env = environment({ native: true });
  const close = await env.initializePreferencesSync();
  try {
    env.receiveStorage({ ...plain(env.DEFAULT_PREFERENCES), islandVisibility: 'hybrid', islandHideDelay: 5, theme: 'light' });
    assert.equal(env.usePreferencesStore.getState().islandVisibility, 'hybrid');
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 5);
    assert.equal(env.usePreferencesStore.getState().theme, 'light');
    assert.equal(env.saved().islandVisibility, 'hybrid');
    assert.equal(env.saved().islandHideDelay, 5);
    assert.equal(env.emitted.length, 0);
    env.receiveStorage({ ...plain(env.DEFAULT_PREFERENCES), islandHideDelay: 10 }, 'unrelated_preferences');
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 5);
  } finally { close(); }
  assert.equal(env.browserListeners.get('storage').size, 0);
  assert.equal(env.nativeListeners.size, 0);
});

test('Evento nativo de outra janela sincroniza os novos campos sem eco e ignora a própria origem', async () => {
  const env = environment({ native: true });
  const close = await env.initializePreferencesSync();
  try {
    env.usePreferencesStore.getState().updatePreferences({ islandVisibility: 'hybrid', islandHideDelay: 5 });
    const ownSource = env.emitted[0].payload.source;
    const received = { ...plain(env.DEFAULT_PREFERENCES), islandVisibility: 'hybrid', islandHideDelay: 10, accent: 'blue' };
    env.receiveNative(ownSource, received);
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 5);
    env.receiveNative('another-window', received);
    assert.equal(env.usePreferencesStore.getState().islandVisibility, 'hybrid');
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 10);
    assert.equal(env.usePreferencesStore.getState().accent, 'blue');
    assert.equal(env.saved().islandHideDelay, 10);
    assert.equal(env.emitted.length, 1, 'Receber uma alteração não deve retransmiti-la');
  } finally { close(); }
});

test('Restaurar preferências volta à ilha fixa e 3 segundos no estado, armazenamento e evento nativo', () => {
  const env = environment({ native: true, persisted: {
    islandVisibility: 'hybrid', islandHideDelay: 10, theme: 'light', islandOpacity: .6,
  } });
  env.usePreferencesStore.getState().resetPreferences();
  const state = env.usePreferencesStore.getState();
  assert.equal(state.islandVisibility, 'fixed');
  assert.equal(state.islandHideDelay, 3);
  assert.equal(state.theme, 'dark');
  assert.equal(state.islandOpacity, .96);
  assert.deepEqual(env.saved(), plain(env.DEFAULT_PREFERENCES));
  assert.deepEqual(env.emitted[0].payload.preferences, plain(env.DEFAULT_PREFERENCES));
});
