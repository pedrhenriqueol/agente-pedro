import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/startupDiagnostics.ts'], bundle: true, write: false,
  format: 'cjs', platform: 'browser',
  plugins: [{ name: 'native-diagnostics-boundary', setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'diagnostics' }));
    builder.onLoad({ filter: /.*/, namespace: 'diagnostics' }, () => ({
      contents: `export const isTauri = () => globalThis.runtime.native;
        export const invoke = (...args) => globalThis.runtime.invoke(...args);`, loader: 'js',
    }));
  } }],
});

function environment({ native = true, invoke = async () => {} } = {}) {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, Error, Set, runtime: { native, invoke } };
  vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
  return module.exports;
}

test('unavailable diagnostics never reject or block startup/retry', async () => {
  const api = environment({ invoke: async () => { throw new Error('Diagnóstico indisponível'); } });
  await assert.doesNotReject(api.reportStartupStatus('data_loading'));
  await assert.doesNotReject(api.reportStartupStatus('frontend_error', new Error('Banco indisponível')));
});

test('browser preview does not invoke native logging', async () => {
  let calls = 0;
  const api = environment({ native: false, invoke: async () => { calls++; } });
  await api.reportStartupStatus('frontend_ready');
  assert.equal(calls, 0);
});

test('native stages preserve the actionable nested failure cause', async () => {
  const calls = [];
  const api = environment({ invoke: async (command, args) => calls.push({ command, ...args }) });
  await api.reportStartupStatus('frontend_loaded');
  await api.reportStartupStatus('frontend_error', new Error('Dados indisponíveis', { cause: new Error('Permissão negada') }));
  assert.equal(calls[0].command, 'startup_status');
  assert.equal(calls[0].message, null);
  assert.equal(calls[1].stage, 'frontend_error');
  assert.equal(calls[1].message, 'Dados indisponíveis | Permissão negada');
});

test('diagnostics bound cyclic/long errors and do not serialize arbitrary data', () => {
  const api = environment();
  const error = new Error('Falha de inicialização');
  error.cause = error;
  assert.equal(api.startupErrorMessage(error), error.message);
  assert.equal(api.startupErrorMessage('x'.repeat(3000)).length, 2000);
  assert.equal(api.startupErrorMessage({ account: 'dado privado', toString() { throw new Error('Não serializar'); } }), 'Falha sem mensagem disponível');
});
