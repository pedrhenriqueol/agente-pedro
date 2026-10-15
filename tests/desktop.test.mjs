import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

// Exercise the real frontend queue; only replace the native command boundary.
const bundle = await build({
  entryPoints: ['src/lib/desktop.ts'], bundle: true, write: false,
  format: 'cjs', platform: 'browser',
  plugins: [{ name: 'desktop-native-boundary', setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'desktop' }));
    builder.onLoad({ filter: /.*/, namespace: 'desktop' }, () => ({
      contents: `export const isTauri = () => globalThis.runtime.native;
        export const invoke = (...args) => globalThis.runtime.invoke(...args);`, loader: 'js',
    }));
  } }],
});

function deferred() {
  let resolve; let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

function environment(native = true) {
  const requests = [];
  const module = { exports: {} };
  const runtime = { native, invoke(command, args) {
    const response = deferred();
    requests.push({ command, args, visible: args?.visivel, ...response });
    return response.promise;
  } };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, runtime, Promise, Error, window: { innerWidth: 120 } });
  return { ...module.exports, requests };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('dock preview never creates an invisible native hit target', async () => {
  const env = environment(false);
  await env.setDockVisible(true);
  await env.setDockVisible(false);
  assert.equal(env.requests.length, 0);
});

test('rapid dock reversals serialize native IPC and finish with the latest disabled preference', async () => {
  const env = environment();
  let pendingSettled = false;
  const first = env.setDockVisible(true);
  const off = env.setDockVisible(false).then(() => { pendingSettled = true; });
  const on = env.setDockVisible(true);
  const last = env.setDockVisible(false);
  assert.equal(env.requests.length, 1, 'There must be only one command in flight');
  assert.equal(env.requests[0].visible, true);
  env.requests[0].resolve();
  await first; await settle();
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].command, 'configurar_dock');
  assert.equal(env.requests[1].visible, false);
  assert.equal(pendingSettled, false, 'A queued preference awaits native confirmation');
  env.requests[1].resolve();
  await Promise.all([off, on, last]);
  assert.equal(env.requests.length, 2, 'Intermediate queued ON is superseded by the final OFF');
});

test('failed native show reaches its caller and does not prevent the queued hide', async () => {
  const env = environment();
  const failedShow = assert.rejects(env.setDockVisible(true), /HWND indisponível/);
  const hide = env.setDockVisible(false);
  env.requests[0].reject(new Error('HWND indisponível'));
  await failedShow; await settle();
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].visible, false);
  env.requests[1].resolve();
  await hide;
});

test('a failed coalesced batch rejects all waiters and a later retry can restore the dock', async () => {
  const env = environment();
  const first = env.setDockVisible(true);
  const offFailure = assert.rejects(env.setDockVisible(false), /Windows não confirmou/);
  const onFailure = assert.rejects(env.setDockVisible(true), /Windows não confirmou/);
  env.requests[0].resolve();
  await first; await settle();
  env.requests[1].reject(new Error('Windows não confirmou'));
  await Promise.all([offFailure, onFailure]);
  const retry = env.setDockVisible(false);
  assert.equal(env.requests.length, 3);
  assert.equal(env.requests[2].visible, false);
  env.requests[2].resolve();
  await retry;
});

test('an interrupted island grow waits for native confirmation before shrinking to its compact frame', async () => {
  const env = environment();
  const grow = env.syncIslandSize(true, 312, 584);
  const compact = env.syncIslandSize(false, 60, 304);
  await settle();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].command, 'expandir_ilha');
  assert.deepEqual(JSON.parse(JSON.stringify(env.requests[0].args)), { altura: 312, largura: 584 });
  env.requests[0].resolve();
  await grow; await settle();
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].command, 'recolher_ilha');
  assert.deepEqual(JSON.parse(JSON.stringify(env.requests[1].args)), { altura: 60, largura: 304 });
  env.requests[1].resolve();
  await compact;
});

test('island resize returns the monitor-clamped and DPI-rounded viewport confirmed by native', async () => {
  const env = environment();
  const pending = env.syncIslandSize(true, 424, 664);
  await settle();
  env.requests[0].resolve({ width: 383.2, height: 237.6 });
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { width: 383.2, height: 237.6 });
});

test('an invalid native viewport rejects without poisoning the next queued island resize', async () => {
  const env = environment();
  const failure = assert.rejects(env.syncIslandSize(true), /dimensões inválidas/);
  const retry = env.syncIslandSize(false);
  await settle(); env.requests[0].resolve({ width: 0, height: 48 });
  await failure; await settle();
  env.requests[1].resolve({ width: 120, height: 48 });
  assert.deepEqual(JSON.parse(JSON.stringify(await retry)), { width: 120, height: 48 });
});

test('an island with a compact viewport reads desktop space from its native monitor', async () => {
  const env = environment();
  const width = env.readIslandAvailableWidth();
  assert.equal(env.requests[0].command, 'island_available_width');
  env.requests[0].resolve(1920);
  assert.equal(await width, 1920, '120px WebView viewport must not prevent a 584px expanded frame');
  const preview = environment(false);
  assert.equal(await preview.readIslandAvailableWidth(), 120);
  assert.equal(preview.requests.length, 0);
});

test('failed island preparation cannot strand a queued compact recovery or the next grow', async () => {
  const env = environment();
  const failure = assert.rejects(env.syncIslandSize(true, 280, 664), /Ilha escondida/);
  const compact = env.syncIslandSize(false, 48, 120);
  const retry = env.syncIslandSize(true, 300, 504);
  await settle();
  env.requests[0].reject(new Error('Ilha escondida'));
  await failure; await settle();
  assert.equal(env.requests[1].command, 'recolher_ilha');
  env.requests[1].resolve();
  await compact; await settle();
  assert.equal(env.requests[2].command, 'expandir_ilha');
  env.requests[2].resolve();
  await retry;
});
