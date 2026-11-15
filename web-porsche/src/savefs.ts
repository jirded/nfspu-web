// The save folder as the page sees it: the OPFS directory the I/O worker mounts as /save
// (web/src/host/io-worker.ts), and the game data the browser keeps (OPFS "cache/").
// After nfsu2-web's web/src/app/savefs.ts (MIT, th0mk), cut down to what this page uses.
//
// The page writes only while no game runs in this tab (the shell sees to it), so its writes never race
// the I/O worker's handles; but a screenshot, a new file of its own the game never opens.

import { BLOCK, CACHE_DIR } from '../../web/src/host/datacache';

export const SAVE_DIR = 'porsche-save';

export interface Entry { path: string; size: number; mtime: number }
/** a save folder: paths are relative to its root, '/' separated */
export interface SaveFs {
  /** every file, sorted by path */
  list(): Promise<Entry[]>;
  read(path: string): Promise<Uint8Array>;
  /** writes a whole file, creating its folders */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** a missing file is not an error */
  remove(path: string): Promise<void>;
}

type Dir = FileSystemDirectoryHandle;
const entriesOf = (d: Dir) => (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>;

function parts(path: string): string[] {
  const p = path.split('/').filter(x => x && x !== '.');
  if (!p.length || p.some(x => x === '..')) throw new Error(`bad path ${path}`);
  return p;
}
async function dirOf(base: Dir, path: string[], create: boolean) {
  let d = base;
  for (const p of path) d = await d.getDirectoryHandle(p, { create });
  return d;
}

export function opfsFs(saveDir = SAVE_DIR): SaveFs {
  const root = async (create: boolean) => (await navigator.storage.getDirectory()).getDirectoryHandle(saveDir, { create });
  return {
    async list() {
      const out: Entry[] = [];
      async function walk(d: Dir, rel: string) {
        for await (const [name, h] of entriesOf(d)) {
          const r = rel ? rel + '/' + name : name;
          if (h.kind === 'directory') await walk(h as Dir, r);
          else { const f = await (h as FileSystemFileHandle).getFile(); out.push({ path: r, size: f.size, mtime: f.lastModified }); }
        }
      }
      let top: Dir;
      try { top = await root(false); }
      catch (e) { if ((e as DOMException).name === 'NotFoundError') return []; throw e; }   // no save folder yet
      await walk(top, '');
      return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async read(path) {
      const p = parts(path);
      const d = await dirOf(await root(false), p.slice(0, -1), false);
      return new Uint8Array(await (await (await d.getFileHandle(p[p.length - 1])).getFile()).arrayBuffer());
    },
    async write(path, data) {
      const p = parts(path);
      const d = await dirOf(await root(true), p.slice(0, -1), true);
      const w = await (await d.getFileHandle(p[p.length - 1], { create: true })).createWritable();
      try { await w.write(data as FileSystemWriteChunkType); await w.close(); }
      catch (e) { try { await w.abort(); } catch { /* already closed */ } throw e; }
    },
    async remove(path) {
      const p = parts(path);
      let d: Dir;
      try { d = await dirOf(await root(false), p.slice(0, -1), false); } catch { return; }
      try { await d.removeEntry(p[p.length - 1]); }
      catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }
    },
  };
}

/** The text of a file of the save folder, or null when it is not there. */
export async function readText(fs: SaveFs, path: string): Promise<string | null> {
  try { return new TextDecoder().decode(await fs.read(path)); } catch { return null; }
}

/** Game data this browser keeps (OPFS "cache/", host/datacache.ts): every file there is sparse, with a
 *  ".have" map of one byte per 1 MiB block, so what is here is the number of blocks present (the last
 *  block of a file may be shorter; the file's size bounds it). */
export async function cacheBytes(): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0;
  try {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(CACHE_DIR);
    for await (const [name, h] of entriesOf(d)) {
      if (h.kind !== 'file' || !name.endsWith('.have')) continue;
      const have = new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
      let n = 0; for (const b of have) n += b ? 1 : 0;
      if (!n) continue;
      let size = n * BLOCK;
      try { size = Math.min(size, (await (await d.getFileHandle(name.slice(0, -5))).getFile()).size); } catch { /* data file gone */ }
      bytes += size; files++;
    }
  } catch { /* no cache yet */ }
  return { bytes, files };
}

export async function clearCache(): Promise<void> {
  try { await (await navigator.storage.getDirectory()).removeEntry(CACHE_DIR, { recursive: true }); }
  catch (e) { if ((e as DOMException).name !== 'NotFoundError') throw e; }   // absent: nothing to delete
}
