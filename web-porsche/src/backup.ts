// Backup and restore of the saves: one zip with the player's files of the save folder (profiles.ts isSave: the
// players, the game's options, settings.ini, the screenshots).  The copies of its own data the game leaves in
// the save folder are neither backed up nor touched by a restore.  No DOM (test/backup.test.mjs).

import type { SaveFs } from './savefs';
import { zip, unzip, ZipError, type ZipEntry } from './zip';
import { isSave, isShot, profilesOf, stamp } from './profiles';

export class BackupError extends Error {}

/** no file of a save folder is near this; a larger entry is not read */
export const MAX_ENTRY = 64 << 20;

/** a zip entry's name as a path below the save root ('/' separated), or null when it is not one */
export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\0') || /^[A-Za-z]:/.test(name)) return null;
  const p = name.replace(/\\/g, '/').split('/');
  if (p.some(x => x === '' || x === '.' || x === '..')) return null;   // also a leading '/', and 'a//b'
  return p.join('/');
}

export async function exportSaves(fs: SaveFs, now = new Date()): Promise<{ zip: Uint8Array; name: string; files: number }> {
  const entries: ZipEntry[] = [];
  for (const e of await fs.list()) if (isSave(e.path)) entries.push({ name: e.path, data: await fs.read(e.path), mtime: e.mtime });
  return { zip: zip(entries), name: `porsche-saves-${stamp(now)}.zip`, files: entries.length };
}

export interface Restore {
  /** the files to write, names as safe paths */
  entries: ZipEntry[];
  /** the players in it */
  profiles: string[];
  settings: boolean;
  shots: number;
  /** entries left out: not a file of the saves, or too large */
  refused: string[];
}

/** what a zip holds, when it is a backup of ours (it has at least one player's .sav); else BackupError */
export async function readBackup(buf: Uint8Array): Promise<Restore> {
  const refused: string[] = [];
  let raw: ZipEntry[];
  const ours = (name: string) => { const p = safeEntryPath(name); return p !== null && isSave(p); };
  try { raw = await unzip(buf, (name, size) => ours(name) && size <= MAX_ENTRY, refused); }
  catch (e) {
    if (e instanceof ZipError || e instanceof RangeError) throw new BackupError('This file is not a zip of saves.');
    throw e;
  }
  const entries = raw.map(e => ({ ...e, name: safeEntryPath(e.name)! }));
  const profiles = profilesOf(entries.map(e => ({ path: e.name, size: e.data.length, mtime: e.mtime ?? 0 }))).map(p => p.name);
  if (!profiles.length) throw new BackupError('This zip has no saves of Porsche Unleashed in it.');
  return { entries, profiles: profiles.sort(), settings: entries.some(e => e.name === 'settings.ini'),
           shots: entries.filter(e => isShot(e.name)).length, refused };
}

/** The saves become the backup's.  The backup's files are written first; only when every one of them is in
 *  place are the saves it does not have removed, so a write that fails leaves every old file there. */
export async function restoreSaves(fs: SaveFs, r: Restore): Promise<void> {
  const keep = new Set(r.entries.map(e => e.name));
  for (const e of r.entries) await fs.write(e.name, e.data);
  for (const old of await fs.list()) if (isSave(old.path) && !keep.has(old.path)) await fs.remove(old.path);
}
