import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/topControls.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser',
  plugins: [{ name: 'top-controls-native-boundary', setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'top-controls' }));
    builder.onLoad({ filter: /.*/, namespace: 'top-controls' }, () => ({ contents: `
      export const isTauri = () => globalThis.runtime.native;
      export const invoke = (...args) => globalThis.runtime.invoke(...args);`, loader: 'js' }));
  } }],
});

function environment(native = true) {
  const requests = [];
  const module = { exports: {} };
  const runtime = { native, invoke(command, args) {
    let resolve; let reject;
    const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
    requests.push({ command, args, resolve, reject });
    return promise;
  } };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, runtime, Error, Promise });
  return { ...module.exports, requests };
}
const frame = (visible, expanded = false) => ({ visible, expanded, width: expanded ? 384 : 128, height: expanded ? 390 : 46 });
const settle = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

test('Top controls preview returns its frame without creating native windows and rejects invalid dimensions', async () => {
  const env = environment(false);
  assert.deepEqual(plain(await env.configureTopControl('top-left', frame(true))), frame(true));
  assert.deepEqual(plain(await env.configureTopControl('top-left', frame(false))), frame(false));
  await assert.rejects(env.configureTopControl('top-left', { ...frame(true), width: NaN }), /dimensões/);
  assert.equal(env.requests.length, 0);
});

test('A late popup preparation is followed by the latest hide, with all callers awaiting native confirmation', async () => {
  const env = environment();
  const opening = env.configureTopControl('top-left', frame(true, true));
  const close = env.configureTopControl('top-left', frame(true));
  const reopen = env.configureTopControl('top-left', frame(true, true));
  const hide = env.configureTopControl('top-left', frame(false));
  assert.equal(env.requests.length, 1);
  env.requests[0].resolve(frame(true, true));
  await opening; await settle();
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].command, 'configure_top_control');
  assert.deepEqual(plain(env.requests[1].args), { label: 'top-left', ...frame(false) });
  env.requests[1].resolve(frame(false));
  for (const returned of await Promise.all([close, reopen, hide])) assert.equal(returned.visible, false);
});

test('The left and right corner queues remain independent when one native response is delayed', async () => {
  const env = environment();
  const left = env.configureTopControl('top-left', frame(true, true));
  const rightFrame = { visible: true, expanded: false, width: 90, height: 46 };
  const right = env.configureTopControl('top-right', rightFrame);
  assert.equal(env.requests.length, 2);
  env.requests[1].resolve(rightFrame);
  assert.deepEqual(plain(await right), rightFrame);
  const rightOff = env.configureTopControl('top-right', { ...rightFrame, visible: false });
  assert.equal(env.requests[2].args.label, 'top-right');
  env.requests[2].resolve({ ...rightFrame, visible: false });
  await rightOff;
  env.requests[0].resolve(frame(true, true)); await left;
});

test('A rejected prepare reports its error, still applies queued hide and permits a later retry', async () => {
  const env = environment();
  const failed = assert.rejects(env.configureTopControl('top-left', frame(true, true)), /Windows não confirmou/);
  const hiding = env.configureTopControl('top-left', frame(false));
  env.requests[0].reject(new Error('Windows não confirmou'));
  await failed; await settle();
  assert.equal(env.requests[1].args.visible, false);
  env.requests[1].resolve(frame(false)); await hiding;
  const retry = env.configureTopControl('top-left', frame(true));
  env.requests[2].resolve(frame(true));
  assert.equal((await retry).visible, true);
});
