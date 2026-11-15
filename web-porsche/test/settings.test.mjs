// settings.ini (src/settings.ts): defaults, changes, a file edited by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const S = await load('settings.ts');

test('defaults', () => {
  assert.equal(S.get(null, 'resolution_scale'), 'auto');
  assert.equal(S.get('', 'fps_counter'), 'off');
});

test('put then get, comments and other lines kept', () => {
  const t = S.put('# mine\nfoo = 1\n', 'fps_counter', 'on');
  assert.equal(S.get(t, 'fps_counter'), 'on');
  assert.match(t, /# mine/);
  assert.match(t, /foo = 1/);
  assert.equal(S.get(S.put(t, 'fps_counter', null), 'fps_counter'), 'off');
});

test('put replaces, never duplicates', () => {
  const t = S.put(S.put(null, 'resolution_scale', '2'), 'Resolution_Scale', '3');
  assert.equal(t.match(/resolution_scale/gi).length, 1);
  assert.equal(S.get(t, 'resolution_scale'), '3');
});

test('a hand-edited file', () => {
  const text = '﻿fullscreen_on_play = 1\r\nresolution_scale = 9\r\nnonsense\r\nunknown_key = x\r\n';
  const r = S.resolve(text, {});
  assert.equal(r.page.fullscreen_on_play, '1');
  assert.equal(r.page.resolution_scale, 'auto');            // out of range: the default
  assert.equal(r.notes.length, 3);                           // the bad value, the line with no =, the unknown key
  assert.match(S.put(text, 'fps_counter', 'on'), /unknown_key = x/);   // unknown lines survive a change
});

test('a huge file does not hang', () => {
  S.resolve('x = 1\n'.repeat(200000), {});
});

test('?env= wins over the file', () => {
  assert.deepEqual(S.resolve(null, { PORSCHE_PROF: '1' }).env, { PORSCHE_PROF: '1' });
});

test('the template is a file of comments and defaults', () => {
  const r = S.resolve(S.TEMPLATE, {});
  assert.deepEqual(r.notes, []);
  for (const k of S.KEYS) assert.equal(r.page[k.key] ?? k.def, k.def);
});
