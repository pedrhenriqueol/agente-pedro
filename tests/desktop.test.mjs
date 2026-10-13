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
    requests.push({ command, visible: args.visivel, ...response });
    return response.promise;
  } };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, runtime, Promise, Error });
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
