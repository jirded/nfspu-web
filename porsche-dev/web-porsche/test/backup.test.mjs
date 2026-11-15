// Backup and restore of the save folder (src/backup.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, enc } from './load.mjs';
import { memFs } from './memfs.mjs';

const B = await load('backup.ts');
const Z = await load('zip.ts');

test('unsafe paths', () => {
  for (const n of ['../x', '/abs', 'C:\\x', 'a/../../b', 'a\\..\\b', '', 'a//b', 'a/./b', 'x\0y']) assert.equal(B.safeEntryPath(n), null, n);
  assert.equal(B.safeEntryPath('SaveData/4OGD.sav'), 'SaveData/4OGD.sav');
  assert.equal(B.safeEntryPath('SaveData\\4OGD.sav'), 'SaveData/4OGD.sav');   // a zip made on Windows
});

test('export then restore into another folder', async () => {
  const a = memFs({ 'SaveData/4TEST.sav': 'S', 'SaveData/TEST1.hud': 'H', 'settings.ini': 'fps_counter = on\n', 'shots/porsche-1.png': 'P' });
  const { zip, files, name } = await B.exportSaves(a, new Date(2026, 10, 15, 9, 5, 7));
  assert.equal(files, 4);
  assert.equal(name, 'porsche-saves-20261115-090507.zip');
  const r = await B.readBackup(zip);
  assert.deepEqual(r.profiles, ['TEST']);
  assert.equal(r.settings, true);
  assert.equal(r.shots, 1);
  assert.deepEqual(r.refused, []);
  const b = memFs({ 'SaveData/4OLD.sav': 'x', 'shots/old.png': 'y' });
  await B.restoreSaves(b, r);
  assert.deepEqual([...b.files.keys()].sort(), [...a.files.keys()].sort());   // the backup's files, and only those
});

test('a zip that is not a backup', async () => {
  await assert.rejects(B.readBackup(Z.zip([{ name: 'readme.txt', data: enc('x') }])), B.BackupError);
  await assert.rejects(B.readBackup(enc('not a zip')), B.BackupError);
  await assert.rejects(B.readBackup(new Uint8Array(0)), B.BackupError);
  const r = await B.readBackup(Z.zip([{ name: 'SaveData/4A.sav', data: enc('s') }, { name: '../evil', data: enc('e') }]));
  assert.deepEqual(r.refused, ['../evil']);
  assert.deepEqual(r.entries.map(e => e.name), ['SaveData/4A.sav']);
});

test('an entry too large to be a save is refused before it is read', async () => {
  const z = Z.zip([{ name: 'SaveData/4A.sav', data: enc('s') }, { name: 'SaveData/big.bin', data: new Uint8Array(B.MAX_ENTRY + 1) }]);
  const r = await B.readBackup(z);
  assert.deepEqual(r.refused, ['SaveData/big.bin']);
});

test('a restore that fails halfway keeps the old saves', async () => {
  const b = memFs({ 'SaveData/4OLD.sav': 'old' });
  const r = await B.readBackup(Z.zip([1, 2, 3].map(i => ({ name: `SaveData/4N${i}.sav`, data: enc('n') }))));
  b.failAfter = 2;
  await assert.rejects(B.restoreSaves(b, r));
  assert.ok(b.files.has('SaveData/4OLD.sav'));
});

// the game opens some of its own data for writing, and the save overlay then holds a copy of it
// (FEData/controls/*.ctr, gamedata/...): that is the game's data, not the player's saves
test('copies of game data in the save folder stay out of the backup', async () => {
  const a = memFs({ 'SaveData/0TEST.sav': 'S', 'SaveData/player.lst': 'L', '.nfsu2_registry': 'R', 'settings.ini': '', 'shots/porsche-1.png': 'P',
    'FEData/controls/3DCar.ctr': 'EA', 'gamedata/track/coastal.map': 'EA' });
  const { zip, files } = await B.exportSaves(a);
  assert.equal(files, 5);
  assert.deepEqual((await Z.listZip(zip)).sort(), ['.nfsu2_registry', 'SaveData/0TEST.sav', 'SaveData/player.lst', 'settings.ini', 'shots/porsche-1.png']);
});

test('a restore neither writes nor removes game data copies', async () => {
  const r = await B.readBackup(Z.zip([{ name: 'SaveData/0NEW.sav', data: enc('n') }, { name: 'FEData/controls/evil.ctr', data: enc('x') }]));
  assert.deepEqual(r.refused, ['FEData/controls/evil.ctr']);
  const b = memFs({ 'SaveData/0OLD.sav': 'o', 'FEData/controls/3DCar.ctr': 'EA' });
  await B.restoreSaves(b, r);
  assert.deepEqual([...b.files.keys()].sort(), ['FEData/controls/3DCar.ctr', 'SaveData/0NEW.sav']);
});
