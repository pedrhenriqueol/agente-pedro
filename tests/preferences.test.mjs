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
    receiveNativePatch(patch) {
      for (const listener of nativeListeners) {
        if (listener.event === 'pedro:preferences-patch') listener.callback({ payload: patch });
      }
    },
  };
}

test('Novas preferências são discretas e a migração preserva um dock explicitamente escolhido', () => {
  for (const persisted of [undefined, {}, { theme: 'light' }]) {
    const env = environment({ persisted });
    assert.equal(env.usePreferencesStore.getState().dockEnabled, false);
    assert.equal(env.usePreferencesStore.getState().nativeMaterial, 'system');
    assert.equal(env.usePreferencesStore.getState().sidebarCollapsed, false);
  }
  for (const dockEnabled of [true, false]) {
    const env = environment({ persisted: { dockEnabled, islandVisibility: 'hybrid', islandHideDelay: 3, accent: 'violet' } });
    env.usePreferencesStore.getState().updatePreferences({ nativeMaterial: 'solid', sidebarCollapsed: true });
    const reopened = environment({ persisted: env.saved() }).usePreferencesStore.getState();
    assert.equal(reopened.dockEnabled, dockEnabled);
    assert.equal(reopened.nativeMaterial, 'solid');
    assert.equal(reopened.sidebarCollapsed, true);
    assert.equal(reopened.islandVisibility, 'hybrid');
    assert.equal(reopened.islandHideDelay, 3);
    assert.equal(reopened.accent, 'violet');
  }
});

test('Hidratação aceita apenas dados conhecidos e mantém limites de contraste e opacidade', () => {
  const env = environment({ persisted: {
    nativeMaterial: 'glass', sidebarCollapsed: 'true', dockEnabled: 'true', reduceMotion: 'false',
    islandOpacity: .01, dockOpacity: 2, unknownSetting: 'untrusted', updatePreferences: 'broken',
  } });
  const state = env.usePreferencesStore.getState();
  assert.equal(state.nativeMaterial, 'system');
  assert.equal(state.sidebarCollapsed, false);
  assert.equal(state.dockEnabled, false);
  assert.equal(state.reduceMotion, false);
  assert.equal(state.islandOpacity, .55);
  assert.equal(state.dockOpacity, 1);
  assert.equal(typeof state.updatePreferences, 'function');
  assert.equal(Object.hasOwn(state, 'unknownSetting'), false);
  state.updatePreferences({ nativeMaterial: 'solid' });
  assert.equal(Object.hasOwn(env.saved(), 'unknownSetting'), false);
  assert.equal(Object.hasOwn(env.saved(), 'updatePreferences'), false);
});

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
    for (const invalid of [null, undefined, [], 'hybrid']) env.receiveNative('malformed-window', invalid);
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 5);
    env.receiveNative('another-window', received);
    assert.equal(env.usePreferencesStore.getState().islandVisibility, 'hybrid');
    assert.equal(env.usePreferencesStore.getState().islandHideDelay, 10);
    assert.equal(env.usePreferencesStore.getState().accent, 'blue');
    assert.equal(env.saved().islandHideDelay, 10);
    assert.equal(env.emitted.length, 1, 'Receber uma alteração não deve retransmiti-la');
  } finally { close(); }
});

test('Menu nativo envia ajustes parciais validados sem apagar preferências ou publicar um eco', async () => {
  const env = environment({ native: true, persisted: {
    theme: 'light', accent: 'violet', dockEnabled: true, islandHideDelay: 10, nativeMaterial: 'solid', sidebarCollapsed: true,
  } });
  const close = await env.initializePreferencesSync();
  try {
    env.receiveNativePatch({ islandVisibility: 'hybrid' });
    assert.equal(env.usePreferencesStore.getState().islandVisibility, 'hybrid');
    assert.equal(env.saved().theme, 'light');
    assert.equal(env.saved().accent, 'violet');
    assert.equal(env.saved().dockEnabled, true);
    assert.equal(env.saved().islandHideDelay, 10);
    assert.equal(env.saved().nativeMaterial, 'solid');
    assert.equal(env.saved().sidebarCollapsed, true);
    env.receiveNativePatch({ nativeMaterial: 'system', sidebarCollapsed: false, dockEnabled: false, islandOpacity: .8 });
    assert.equal(env.saved().nativeMaterial, 'system');
    assert.equal(env.saved().sidebarCollapsed, false);
    assert.equal(env.saved().dockEnabled, false);
    assert.equal(env.saved().islandOpacity, .8);
    assert.equal(env.emitted.length, 0);
  } finally { close(); }
  assert.equal(env.nativeListeners.size, 0);
});

test('Mensagens inválidas do menu não alteram valores nem substituem ações da store', async () => {
  const env = environment({ native: true, persisted: { theme: 'light', islandVisibility: 'hybrid', islandHideDelay: 10 } });
  const close = await env.initializePreferencesSync();
  try {
    const before = plain({ ...env.DEFAULT_PREFERENCES, theme: 'light', islandVisibility: 'hybrid', islandHideDelay: 10 });
    const update = env.usePreferencesStore.getState().updatePreferences;
    for (const patch of [null, [], 'hybrid', 1, {
      theme: 'invalid', islandVisibility: 'hidden', islandHideDelay: 1, islandOpacity: NaN,
      dockEnabled: 'true', sidebarCollapsed: null, nativeMaterial: 'acrylic', updatePreferences: null,
      resetPreferences: 'broken', unexpected: true,
    }]) env.receiveNativePatch(patch);
    const state = env.usePreferencesStore.getState();
    assert.equal(state.updatePreferences, update);
    assert.equal(typeof state.resetPreferences, 'function');
    for (const [key, value] of Object.entries(before)) assert.equal(state[key], value);
    assert.equal(Object.hasOwn(state, 'unexpected'), false);
    assert.equal(env.emitted.length, 0);
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
  assert.equal(state.dockEnabled, false);
  assert.equal(state.nativeMaterial, 'system');
  assert.equal(state.sidebarCollapsed, false);
  assert.deepEqual(env.saved(), plain(env.DEFAULT_PREFERENCES));
  assert.deepEqual(env.emitted[0].payload.preferences, plain(env.DEFAULT_PREFERENCES));
});

test('Preferências anteriores recebem expansão por mouse e tamanho médio sem perder escolhas existentes', () => {
  const env = environment({ persisted: {
    theme: 'light', accent: 'violet', islandIdle: 'balance', islandVisibility: 'hybrid',
    islandHideDelay: 10, islandOpacity: .72, dockOpacity: .81, dockEnabled: true,
  } });
  const state = env.usePreferencesStore.getState();
  assert.equal(state.islandSize, 'medium');
  assert.equal(state.topControlsEnabled, true);
  assert.equal(state.islandHoverExpand, true);
  assert.equal(state.islandTone, 'graphite');
  assert.equal(state.customAccent, '#10b981');
  state.updatePreferences({ islandSize: 'large', islandHoverExpand: false, islandTone: 'midnight', topControlsEnabled: false, topControlsEnabled: false });
  const reopened = environment({ persisted: env.saved() }).usePreferencesStore.getState();
  for (const [key, value] of Object.entries({
    theme: 'light', accent: 'violet', islandIdle: 'balance', islandVisibility: 'hybrid',
    islandHideDelay: 10, islandOpacity: .72, dockOpacity: .81, dockEnabled: true,
    islandSize: 'large', islandHoverExpand: false, islandTone: 'midnight',
  })) assert.equal(reopened[key], value);
});

test('Controles nos cantos preservam uma escolha desligada e sincronizam sem eco', async () => {
  const env = environment({ native: true, persisted: { theme: 'light', topControlsEnabled: false } });
  assert.equal(env.usePreferencesStore.getState().topControlsEnabled, false);
  env.usePreferencesStore.getState().updatePreferences({ islandSize: 'large' });
  assert.equal(environment({ persisted: env.saved() }).usePreferencesStore.getState().topControlsEnabled, false);
  const close = await env.initializePreferencesSync();
  try {
    env.receiveNativePatch({ topControlsEnabled: true });
    assert.equal(env.saved().topControlsEnabled, true);
    env.receiveNativePatch({ topControlsEnabled: 'false' });
    assert.equal(env.saved().topControlsEnabled, true);
    assert.equal(env.saved().theme, 'light');
    assert.equal(env.emitted.length, 1);
    env.usePreferencesStore.getState().resetPreferences();
    assert.equal(env.saved().topControlsEnabled, true);
  } finally { close(); }
});

test('Cores personalizadas aceitam somente hexadecimal completo e não introduzem CSS ou chaves arbitrárias', () => {
  for (const customAccent of ['red', '#abc', '#12345678', '#xyzxyz', 'var(--text)', '#fff; background:url(x)', ' #123456', null, 10]) {
    const env = environment({ persisted: { accent: 'custom', customAccent, islandSize: 'huge', islandTone: 'glass', islandHoverExpand: 'true' } });
    const state = env.usePreferencesStore.getState();
    assert.equal(state.customAccent, '#10b981');
    assert.equal(state.islandSize, 'medium');
    assert.equal(state.islandTone, 'graphite');
    assert.equal(state.islandHoverExpand, true);
    assert.equal(typeof state.updatePreferences, 'function');
  }
  const env = environment({ persisted: { accent: 'custom', customAccent: '#A1B2C3' } });
  assert.equal(env.usePreferencesStore.getState().customAccent, '#a1b2c3');
  env.usePreferencesStore.getState().updatePreferences({ customAccent: '#ABCDEF', islandTone: 'emerald', islandSize: 'small' });
  assert.equal(env.saved().customAccent, '#abcdef');
  assert.equal(env.saved().islandTone, 'emerald');
  assert.equal(env.saved().islandSize, 'small');
});

test('Novos ajustes de aparência são publicados e recebidos completos sem substituir ações da store', async () => {
  const env = environment({ native: true });
  const close = await env.initializePreferencesSync();
  try {
    for (const accent of ['amber', 'rose', 'custom']) {
      env.usePreferencesStore.getState().updatePreferences({
        accent, customAccent: '#11AA88', islandTone: 'emerald', islandSize: 'small', islandHoverExpand: false,
      });
      const event = env.emitted.at(-1);
      assert.deepEqual(event.payload.preferences, env.saved());
      assert.equal(event.payload.preferences.customAccent, '#11aa88');
      assert.equal(event.payload.preferences.islandHoverExpand, false);
    }
    const update = env.usePreferencesStore.getState().updatePreferences;
    env.receiveNative('other-window', {
      ...plain(env.DEFAULT_PREFERENCES), accent: 'custom', customAccent: '#3412AB',
      islandTone: 'midnight', islandSize: 'large', islandHoverExpand: false,
      updatePreferences: 'hostile', arbitrary: 'ignored',
    });
    assert.equal(env.saved().customAccent, '#3412ab');
    assert.equal(env.saved().islandTone, 'midnight');
    assert.equal(env.saved().islandSize, 'large');
    assert.equal(env.saved().islandHoverExpand, false);
    assert.equal(env.usePreferencesStore.getState().updatePreferences, update);
    assert.equal(Object.hasOwn(env.saved(), 'arbitrary'), false);
    assert.equal(env.emitted.length, 3);
    env.receiveNativePatch({ customAccent: 'url(x)', islandTone: 'clear', islandSize: 500, islandHoverExpand: 'false' });
    assert.equal(env.saved().customAccent, '#3412ab');
    assert.equal(env.saved().islandTone, 'midnight');
    assert.equal(env.saved().islandSize, 'large');
    assert.equal(env.saved().islandHoverExpand, false);
  } finally { close(); }
});
