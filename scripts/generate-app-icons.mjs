import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'pedro-mascot-icons-'));
const names = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico'];
try {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'icon', join(root, 'src/assets/pedro-icon.svg'), '--output', work], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`A geração dos ícones falhou (saída ${result.status}).`);
  // Read every generated file before replacing the current Windows asset set.
  const icons = names.map(name => [name, readFileSync(join(work, name))]);
  for (const [name, bytes] of icons) writeFileSync(join(root, 'src-tauri/icons', name), bytes);
  console.log('Ícones do Windows e da bandeja atualizados a partir do SVG do mascote.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
