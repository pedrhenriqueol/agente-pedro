import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/widgetViewport.ts'], bundle: true,
  write: false, format: 'cjs', platform: 'browser' });

function renderer(width = 120, height = 48) {
  const frames = new Map();
  const timers = new Map();
  let id = 0;
  let time = 0;
  const document = { hidden: false };
  const window = { innerWidth: width, innerHeight: height,
    setTimeout(callback, delay) { timers.set(++id, { callback, due: time + delay }); return id; },
    clearTimeout(timer) { timers.delete(timer); } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, window, document,
    Promise, Error, requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frame) { frames.delete(frame); } });
  return { wait: module.exports.waitForWidgetViewport, window, document,
    frame(width = window.innerWidth, height = window.innerHeight) {
      window.innerWidth = width; window.innerHeight = height;
      const callbacks = [...frames.values()]; frames.clear(); time += 16;
      callbacks.forEach(callback => callback(time));
    },
    advance(milliseconds) {
      time += milliseconds;
      for (const [key, timer] of timers) if (timer.due <= time) { timers.delete(key); timer.callback(); }
    },
    pending: () => frames.size + timers.size,
  };
}

for (const lag of [1, 2, 3]) test(`native resize acknowledgement with ${lag} stale renderer frames cannot reveal content`, async () => {
  const env = renderer();
  let settled = false;
  const ready = env.wait({ width: 584, height: 345 }, () => true).then(value => { settled = true; return value; });
  for (let i = 0; i < lag; i++) { env.frame(); await Promise.resolve(); assert.equal(settled, false); }
  env.frame(584, 345); await Promise.resolve();
  assert.equal(settled, false, 'First matching frame must paint the preparer before presentation');
  env.frame(); assert.equal(await ready, true); assert.equal(env.pending(), 0);
});

test('a second viewport change resets readiness instead of accepting a stale first match', async () => {
  const env = renderer(); let settled = false;
  const ready = env.wait({ width: 304, height: 188 }, () => true).then(value => { settled = true; return value; });
  env.frame(304, 188); env.frame(90, 46); env.frame(304, 188); await Promise.resolve();
  assert.equal(settled, false);
  env.frame(); assert.equal(await ready, true); assert.equal(env.pending(), 0);
});

test('a cancelled opening releases its frame and timeout without revealing an obsolete popup', async () => {
  const env = renderer(); let current = true;
  const ready = env.wait({ width: 584, height: 345 }, () => current);
  env.frame(); current = false; env.frame();
  assert.equal(await ready, false); assert.equal(env.pending(), 0);
});

test('hidden WebViews still cancel an obsolete request when animation frames are paused', async () => {
  const env = renderer();
  let current = true;
  const ready = env.wait({ width: 584, height: 345 }, () => current);
  env.document.hidden = true; current = false; env.advance(1200);
  assert.equal(await ready, false); assert.equal(env.pending(), 0);
});

test('a valid hidden preparation resumes on return instead of leaving an expanded empty frame', async () => {
  const env = renderer(); let settled = false;
  const ready = env.wait({ width: 584, height: 345 }, () => true).then(value => { settled = true; return value; });
  env.document.hidden = true; env.frame(584, 345); env.frame(); await Promise.resolve();
  assert.equal(settled, false);
  env.advance(240); env.document.hidden = false; env.frame(); await Promise.resolve();
  assert.equal(settled, false, 'Returning still requires a stable preparer paint');
  env.frame(); assert.equal(await ready, true); assert.equal(env.pending(), 0);
});

test('a still-valid hidden preparation rejects on timeout so its caller can recover the native frame', async () => {
  const env = renderer(); env.document.hidden = true;
  const failure = assert.rejects(env.wait({ width: 584, height: 345 }, () => true), /tamanho a tempo/);
  env.advance(1200); await failure; assert.equal(env.pending(), 0);
});

test('missing viewport confirmation fails within its deadline and a later retry succeeds', async () => {
  const env = renderer();
  const failure = assert.rejects(env.wait({ width: 584, height: 345 }, () => true), /tamanho a tempo/);
  env.advance(1200); await failure; assert.equal(env.pending(), 0);
  const retry = env.wait({ width: 584, height: 345 }, () => true);
  env.frame(584, 345); env.frame();
  assert.equal(await retry, true); assert.equal(env.pending(), 0);
});

test('monitor-clamped fractional DPI dimensions accept browser pixel rounding', async () => {
  const env = renderer(383, 237);
  const ready = env.wait({ width: 383.2, height: 237.6 }, () => true);
  env.frame(); env.frame(); assert.equal(await ready, true); assert.equal(env.pending(), 0);
});

test('invalid confirmed dimensions reject without scheduling renderer work', async () => {
  const env = renderer();
  for (const width of [0, -1, NaN, Infinity]) {
    await assert.rejects(env.wait({ width, height: 48 }, () => true), /dimensões inválidas/);
  }
  assert.equal(env.pending(), 0);
});

test('a reserved viewport is confirmed independently from its compact input region', async () => {
  const env = renderer(120, 48); let settled = false;
  const ready = env.wait({ width: 120, height: 48, viewport: { width: 664, height: 424 } }, () => true)
    .then(value => { settled = true; return value; });
  env.frame(); env.frame(); await Promise.resolve();
  assert.equal(settled, false, 'A matching footprint is not a matching WebView reservation');
  env.frame(664, 424); await Promise.resolve(); assert.equal(settled, false);
  env.frame(); assert.equal(await ready, true); assert.equal(env.pending(), 0);

  const expand = env.wait({ width: 584, height: 345, viewport: { width: 664, height: 424 } }, () => true);
  env.frame(); env.frame();
  assert.equal(await expand, true, 'Opening changes the native region without resizing the WebView');
  assert.equal(env.pending(), 0);
});

test('invalid native reservations and regions outside them cannot release a preparer', async () => {
  const env = renderer();
  for (const viewport of [{ width: 0, height: 424 }, { width: 664, height: Infinity },
    { width: 90, height: 46 }, { width: 664 }, '664x424']) {
    await assert.rejects(env.wait({ width: 120, height: 48, viewport }, () => true), /dimensões inválidas/);
  }
  assert.equal(env.pending(), 0);
});

test('fractional native reservation and nullable legacy responses retain rounding compatibility', async () => {
  const env = renderer(383, 237);
  const reserved = env.wait({ width: 383.2, height: 237.6, viewport: { width: 383.2, height: 237.6 } }, () => true);
  env.frame(); env.frame(); assert.equal(await reserved, true);
  const legacy = env.wait({ width: 383.2, height: 237.6, viewport: null }, () => true);
  env.frame(); env.frame(); assert.equal(await legacy, true); assert.equal(env.pending(), 0);
});
