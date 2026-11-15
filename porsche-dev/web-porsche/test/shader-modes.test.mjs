// The modes a pipeline of the main shader is made for (src/glide-gpu.ts shaderModes): the draw state's words
// (glide_gpu.h) become the shader's constants, and draws with the same modes share a pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { shaderModes } = await load('glide-gpu.ts');

/** a draw state: 64 words, the ones given set */
const state = words => { const s = new Uint32Array(64); for (const [i, v] of Object.entries(words)) s[i] = v; return s; };
// the game's menu, as its trace shows a draw: cc 3,1,0,1,0  ac 3,1,0,1,0  tc 1,0,1,0,0,0  tex 3  atest 6/10  depth m1
const MENU = { 0: 3, 1: 1, 2: 0, 3: 1, 4: 0, 5: 3, 6: 1, 7: 0, 8: 1, 9: 0, 10: 1, 11: 0, 12: 1, 13: 0, 14: 0, 15: 0, 17: 3, 26: 6, 27: 10, 28: 1 };

test('the menu\'s textured draw', () => {
  const { constants } = shaderModes(state(MENU));
  assert.deepEqual(constants, { CF: 3, CK: 1, CLS: 0, COS: 1, CINV: 0, AF: 3, AK: 1, ALS: 0, AOS: 1, AINV: 0,
    TRF: 1, TRK: 0, TAF: 1, TAK: 0, TINVC: 0, TINVA: 0, TEX: 1, ATEST: 6, DMODE: 1, CHROMA: 0, FOG: 0 });
});

test('what is only a value shares the pipeline: the texture, the alpha reference, the colours', () => {
  const a = shaderModes(state(MENU)).key;
  assert.equal(shaderModes(state({ ...MENU, 17: 21, 27: 1, 16: 0xff00ff00, 33: 0x123456, 37: 0x808080, 31: 5 })).key, a);
});

test('what changes the shader does not', () => {
  const a = shaderModes(state(MENU)).key;
  for (const [word, v] of [[0, 1], [3, 2], [26, 4], [28, 2], [36, 1], [32, 1], [17, 0], [14, 1]])
    assert.notEqual(shaderModes(state({ ...MENU, [word]: v })).key, a, `word ${word}`);
});

test('a state inside a command stream, at its offset', () => {
  const s = new Uint32Array(100); s.set(state(MENU), 30);
  assert.deepEqual(shaderModes(s, 30), shaderModes(state(MENU)));
});
