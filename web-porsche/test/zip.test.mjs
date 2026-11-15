// The backup's zip (src/zip.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, enc, dec } from './load.mjs';

const Z = await load('zip.ts');

test('round trip', async () => {
  const z = Z.zip([{ name: 'a/b.txt', data: enc('hi') }, { name: 'c.bin', data: new Uint8Array([0, 255, 7]) }]);
  const e = await Z.unzip(z);
  assert.deepEqual(e.map(x => x.name), ['a/b.txt', 'c.bin']);
  assert.equal(dec(e[0].data), 'hi');
  assert.deepEqual([...e[1].data], [0, 255, 7]);
});

test('not a zip', async () => {
  await assert.rejects(Z.unzip(enc('hello')), Z.ZipError);
});

test('listZip names without reading', async () => {
  assert.deepEqual(await Z.listZip(Z.zip([{ name: 'x', data: enc('1') }])), ['x']);
});
