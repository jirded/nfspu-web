// A small local server for Porsche Unleashed in the browser (in place of nfsu2-web's Rust server,
// which is built around NFSU2's folder and online services).
//
//   node web-porsche/server.mjs --data "<Porsche Unleashed folder>" [--port 8080] [--host 127.0.0.1]
//
// Serves the page (web-porsche/dist), the game module (/game.wasm = out/web/porsche.wasm) and the game
// folder the way the host's I/O worker reads it (web/src/host/datacache.ts):
//   /data-manifest           every file and folder: {files: [{p, s, m} | {p, d: 1}], blocks}
//   /data-blocks/<path>?b=&n= blocks b .. b+n-1 of 1 MiB of a file
//   /data/<path>             the file, with byte ranges
// Every answer is cross-origin isolated (COOP/COEP), which SharedArrayBuffer needs.  The folder is read only.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
const DATA = path.resolve(arg('--data', process.env.PORSCHE_DATA ?? ''));
const DIST = path.resolve(arg('--dist', path.join(here, 'dist')));
const WASM = path.resolve(arg('--wasm', path.join(here, '../out/web/porsche.wasm')));
const PORT = +arg('--port', '8080'), HOST = arg('--host', '127.0.0.1');
const BLOCK = 1 << 20, MAX_RUN = 8;
const LOGFILE = path.resolve(arg('--log', path.join(here, '../out/web-porsche-browser.log')));
if (!DATA || !fs.existsSync(path.join(DATA, 'Porsche.exe'))) {
  console.error('usage: node web-porsche/server.mjs --data "<folder with Porsche.exe>"'); process.exit(2);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const ISO = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };

async function manifest() {
  const files = [];
  async function walk(dir, rel) {
    const ents = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name, full = path.join(dir, e.name);
      if (e.isDirectory()) { files.push({ p, d: 1 }); await walk(full, p); }
      else if (e.isFile()) { const st = await fsp.stat(full); files.push({ p, s: st.size, m: Math.floor(st.mtimeMs / 1000) }); }
    }
  }
  await walk(DATA, '');
  return { v: 1, files, blocks: { url: '/data-blocks/', size: BLOCK, max: MAX_RUN } };
}
/** a path below `root` from URL segments, or null when it would leave it */
function inside(root, urlPath) {
  let rel;
  try { rel = urlPath.split('/').filter(Boolean).map(decodeURIComponent).join(path.sep); } catch { return null; }
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}
async function readRange(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, start); return b.subarray(0, bytesRead); }
  finally { await fh.close(); }
}
function send(res, code, headers, body) {
  res.writeHead(code, { ...ISO, ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/log') {   // the page's log lines, for whoever debugs on this machine
      const chunks = []; for await (const c of req) chunks.push(c);
      await fsp.appendFile(LOGFILE, Buffer.concat(chunks).toString('utf8') + '\n');
      return send(res, 204, {}, '');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {}, '');
    if (p === '/data-manifest') {
      return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, JSON.stringify(await manifest()));
    }
    if (p.startsWith('/data-blocks/')) {
      const f = inside(DATA, p.slice('/data-blocks/'.length));
      if (!f || !fs.existsSync(f)) return send(res, 404, {}, 'not found');
      const size = (await fsp.stat(f)).size, b = +(url.searchParams.get('b') ?? 0), n = +(url.searchParams.get('n') ?? 1);
      const start = b * BLOCK, end = Math.min(size, (b + n) * BLOCK);
      if (!(n >= 1 && n <= MAX_RUN) || start >= size) return send(res, 416, {}, '');
      const body = await readRange(f, start, end - start);
      return send(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' }, req.method === 'HEAD' ? '' : body);
    }
    if (p.startsWith('/data/')) {
      const f = inside(DATA, p.slice('/data/'.length));
      if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, {}, 'not found');
      const size = (await fsp.stat(f)).size, m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (m) {
        const start = +m[1], end = Math.min(size - 1, m[2] ? +m[2] : size - 1);
        if (start > end) return send(res, 416, { 'Content-Range': `bytes */${size}` }, '');
        const body = await readRange(f, start, end - start + 1);
        return send(res, 206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }, req.method === 'HEAD' ? '' : body);
      }
      return send(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Accept-Ranges': 'bytes' }, req.method === 'HEAD' ? '' : await fsp.readFile(f));
    }
    if (p === '/game.wasm' || p === '/porsche-sw.wasm') {   // the second: the software renderer build (?wasm=/porsche-sw.wasm)
      const body = await fsp.readFile(p === '/game.wasm' ? WASM : path.join(path.dirname(WASM), 'porsche-sw.wasm'));
      return send(res, 200, { 'Content-Type': 'application/wasm', 'Cache-Control': 'no-cache', 'Content-Length': body.length }, req.method === 'HEAD' ? '' : body);
    }
    const f = inside(DIST, p === '/' ? 'index.html' : p);
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, {}, 'not found');
    const body = await fsp.readFile(f);
    return send(res, 200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }, req.method === 'HEAD' ? '' : body);
  } catch (e) {
    console.error(`${req.method} ${p}: ${e}`);
    if (!res.headersSent) send(res, 500, {}, String(e)); else res.end();
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Porsche Unleashed: http://localhost:${PORT}/  (game folder ${DATA}, module ${WASM})`);
});
