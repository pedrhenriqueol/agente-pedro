import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class MemoryStorage {
  values = new Map();
  writes = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); this.writes++; }
}

export function sqliteAdapter(database) {
  return {
    async execute(query, bindings = []) {
      const result = database.prepare(query).run(...bindings);
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
    async select(query, bindings = []) { return database.prepare(query).all(...bindings); },
  };
}

/** Compila os adapters da aplicação; apenas a conexão Tauri é substituída por SQLite real de teste. */
export async function loadApplication(t, { storage = new MemoryStorage(), nativeDb, loadNative } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pedro-database-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const output = join(directory, 'application.mjs');
  const root = resolve(import.meta.dirname, '..');
  await build({
    stdin: {
      contents: "export * from './src/database/database.ts'; export * from './src/database/browser.ts'; export * from './src/database/date.ts'; export * from './src/database/schema.ts';",
      resolveDir: root,
    },
    bundle: true, platform: 'node', format: 'esm', outfile: output,
    plugins: [{
      name: 'native-driver-test',
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\/plugin-sql$/ }, () => ({ path: 'driver', namespace: 'test-driver' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-driver' }, () => ({
          contents: 'export default { load: () => globalThis.__pedroNativeLoader() };', loader: 'js',
        }));
      },
    }],
  });
  globalThis.localStorage = storage;
  if (nativeDb || loadNative) {
    globalThis.window = { __TAURI_INTERNALS__: {} };
    globalThis.__pedroNativeLoader = loadNative || (() => sqliteAdapter(nativeDb));
  } else delete globalThis.window;
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; delete globalThis.__pedroNativeLoader; });
  return { app: await import(pathToFileURL(output).href), storage, directory };
}

export async function createNativeApplication(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pedro-sqlite-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const harness = await loadApplication(t, { nativeDb: db });
  return { ...harness, db, path };
}
