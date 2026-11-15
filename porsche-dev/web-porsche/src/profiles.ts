// Which files of the save folder are what.  Pure (test/profiles.test.mjs).
//
// The game keeps its players in SaveData/: a player OGD is "4OGD.sav" (a digit, then the name) with
// "OGD1.hud" and "OGD2.hud" beside it.  The game's own defaults are XXDefXX.sav, XXhud1XX.hud and
// XXhud2XX.hud; nfs5.trk (records) and pic16.fsh (the chosen player's picture) are shared.

import type { Entry } from './savefs';

export const SAVES = 'SaveData';
export interface Profile { name: string; files: string[]; size: number; mtime: number }

/** the players of a save folder, the one saved last first */
export function profilesOf(entries: Entry[]): Profile[] {
  const out: Profile[] = [];
  for (const e of entries) {
    const m = new RegExp(`^${SAVES}/\\d(.+)\\.sav$`, 'i').exec(e.path);
    if (!m) continue;
    const name = m[1], huds = [1, 2].map(n => `${SAVES}/${name}${n}.hud`.toLowerCase());
    const own = entries.filter(x => x === e || huds.includes(x.path.toLowerCase()));
    out.push({ name, files: own.map(x => x.path), size: own.reduce((s, x) => s + x.size, 0), mtime: Math.max(...own.map(x => x.mtime)) });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export const SHOTS_DIR = 'shots';
/** a screenshot of ours */
export const isShot = (path: string) => new RegExp(`^${SHOTS_DIR}/[^/]+\\.png$`, 'i').test(path);
/** the game's stored options (the runtime's registry file, in the save folder's root) */
export const REGISTRY = '.nfsu2_registry';
/** a file of the player's: the players and what else the game keeps in SaveData, the game's options, the page's
 *  settings, the screenshots.  Not the copies of its own data the game leaves in the save folder (it opens some
 *  of FEData and gamedata for writing, and the save overlay then holds a copy). */
export const isSave = (path: string) =>
  new RegExp(`^${SAVES}/`, 'i').test(path) || path === 'settings.ini' || path === REGISTRY || isShot(path);
const two = (n: number) => String(n).padStart(2, '0');
/** YYYYMMDD-HHMMSS, local time */
export const stamp = (d = new Date()) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
export const shotName = (d: Date) => `${SHOTS_DIR}/porsche-${stamp(d)}.png`;
