// Which files of the save folder make a profile, and the screenshots' names (src/profiles.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = await load('profiles.ts');

// the game's own SaveData of an install with one player, OGD
const INSTALL = ['SaveData/4OGD.sav', 'SaveData/OGD1.hud', 'SaveData/OGD2.hud', 'SaveData/XXDefXX.sav',
  'SaveData/XXhud1XX.hud', 'SaveData/XXhud2XX.hud', 'SaveData/nfs5.trk', 'SaveData/pic16.fsh', 'settings.ini'];
const entries = paths => paths.map((path, i) => ({ path, size: 10, mtime: i }));

test('the install has one profile', () => {
  const p = P.profilesOf(entries(INSTALL));
  assert.equal(p.length, 1);
  assert.equal(p[0].name, 'OGD');
  assert.deepEqual([...p[0].files].sort(), ['SaveData/4OGD.sav', 'SaveData/OGD1.hud', 'SaveData/OGD2.hud']);
  assert.equal(p[0].size, 30);
  assert.equal(p[0].mtime, 2);   // its newest file's
});

test('no profiles in an empty folder', () => assert.deepEqual(P.profilesOf([]), []));

test('newest first, and a profile without its hud files', () => {
  const p = P.profilesOf([{ path: 'SaveData/4OLD.sav', size: 1, mtime: 5 }, { path: 'SaveData/4NEW.sav', size: 1, mtime: 9 },
    { path: 'SaveData/new1.hud', size: 1, mtime: 3 }]);
  assert.deepEqual(p.map(x => x.name), ['NEW', 'OLD']);
  assert.deepEqual(p[0].files, ['SaveData/4NEW.sav', 'SaveData/new1.hud']);   // names compare without case
  assert.deepEqual(p[1].files, ['SaveData/4OLD.sav']);
});

test('shots', () => {
  assert.ok(P.isShot('shots/porsche-20261115-101500.png'));
  assert.ok(!P.isShot('SaveData/x.png'));
  assert.ok(!P.isShot('shots/readme.txt'));
  assert.equal(P.shotName(new Date(2026, 10, 15, 10, 15, 0)), 'shots/porsche-20261115-101500.png');
});

test('stamp without a date is now', () => {
  assert.match(P.stamp(), /^\d{8}-\d{6}$/);
  assert.equal(P.stamp().slice(0, 4), String(new Date().getFullYear()));
});
