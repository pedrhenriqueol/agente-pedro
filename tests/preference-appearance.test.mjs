import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/lib/preferenceAppearance.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser',
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports });
const { resolveAccentColor, resolveAccentForeground, colorContrast } = module.exports;

test('Acentos antigos preservam a paleta aprovada em ambos os temas', () => {
  for (const [accent, dark, light] of [
    ['mint', '#10b981', '#157453'], ['violet', '#bca7ff', '#7250c1'], ['blue', '#92c2ff', '#296dc1'],
  ]) {
    assert.equal(resolveAccentColor({ accent, customAccent: '#ff0000' }, false), dark);
    assert.equal(resolveAccentColor({ accent, customAccent: '#ff0000' }, true), light);
  }
});

test('Cores personalizadas mantêm contraste para texto e para os botões em temas claro e escuro', () => {
  assert.equal(colorContrast('#ffffff', '#000000'), 21);
  for (const light of [false, true]) {
    for (const customAccent of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#101725', '#142621', '#eeeeee', '#777777']) {
      const color = resolveAccentColor({ accent: 'custom', customAccent }, light);
      assert.match(color, /^#[a-f\d]{6}$/i);
      for (const surface of light ? ['#e9eee8', '#e6ecf8', '#e1f0e7'] : ['#121620', '#172131', '#142621']) {
        assert.ok(colorContrast(color, surface) >= 4.5, `${customAccent} deve ser legível sobre ${surface}`);
      }
      assert.ok(colorContrast(color, resolveAccentForeground(color)) >= 4.5, 'A ação preenchida deve ter texto legível');
    }
  }
  assert.equal(resolveAccentColor({ accent: 'custom', customAccent: '#10b981' }, false), '#10b981');
  assert.equal(resolveAccentColor({ accent: 'custom', customAccent: '#157453' }, true), '#157453');
});
