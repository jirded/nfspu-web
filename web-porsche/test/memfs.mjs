// A save folder in memory with the page's SaveFs interface (src/savefs.ts), for the unit tests.
// failAfter = n: the n-th write from now throws (a full disk halfway through a restore).
import { enc } from './load.mjs';

export function memFs(init = {}) {
  const files = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === 'string' ? enc(v) : v]));
  let clock = 1000;
  const fs = {
    files, failAfter: 0,
    async list() {
      return [...files].map(([path, d]) => ({ path, size: d.length, mtime: fs.mtimes.get(path) ?? 0 }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    mtimes: new Map(),
    async read(path) { const d = files.get(path); if (!d) throw new Error(`no file ${path}`); return d; },
    async write(path, data) {
      if (fs.failAfter && --fs.failAfter === 0) throw new Error('disk full');
      files.set(path, typeof data === 'string' ? enc(data) : data); fs.mtimes.set(path, ++clock);
    },
    async remove(path) { files.delete(path); },
  };
  return fs;
}
