// Porsche Unleashed in the browser: the page.
//
// Starts the recompiled game (/game.wasm, built by tools/porsche_web_build.sh)
// through nfsu2-web's host (web/src/host: shared memory, game-thread workers,
// the I/O worker that serves /data from the server and /save from OPFS), and
// attaches its sound and input.  The picture: the software Glide backend
// publishes each finished frame (runtime/porsche_web/fb_web.c, host kind 8)
// and this page copies it onto the canvas at every animation frame.
import { startProcess, type GameProcess } from '../../web/src/host/process';
import { attachAudio } from '../../web/src/audio/index';
import { attachInput } from '../../web/src/input/index';
import { attachGlide, PG_HOST_KIND } from './glide-gpu';

const HOST_KIND_FB = 8;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen'), statusEl = $('status'), logEl = $('log');
const playBtn = $<HTMLButtonElement>('play');

// ---- log
const lines: string[] = [];
let logDirty = false;
// the log also goes to the server (web-porsche/server.mjs writes out/web-porsche-browser.log)
const pagePrefix = Math.random().toString(36).slice(2, 6);
let toServer: string[] = [];
setInterval(() => {
  if (!toServer.length) return;
  const body = toServer.join('\n'); toServer = [];
  void fetch('/log', { method: 'POST', body }).catch(() => {});
}, 1000);
function log(s: string) {
  console.log(s);
  const t = (performance.now() / 1000).toFixed(1);
  for (const l of s.split('\n')) if (l) { lines.push(l); toServer.push(`${pagePrefix} ${t} ${l}`); }
  if (lines.length > 4000) lines.splice(0, lines.length - 4000);
  logDirty = true;
}
setInterval(() => {
  if (!logDirty || !document.body.classList.contains('showlog')) return;
  logDirty = false;
  const atEnd = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  logEl.textContent = lines.join('\n');
  if (atEnd) logEl.scrollTop = logEl.scrollHeight;
}, 250);
$('logbtn').onclick = () => { document.body.classList.toggle('showlog'); logDirty = true; };
$('full').onclick = () => { void canvas.requestFullscreen?.(); canvas.focus(); };
const status = (s: string) => { statusEl.textContent = s; };

// ---- checks the host needs
const missing: string[] = [];
if (!crossOriginIsolated) missing.push('cross-origin isolation (the server sends COOP/COEP)');
if (typeof SharedArrayBuffer === 'undefined') missing.push('SharedArrayBuffer');
if (!('storage' in navigator) || !navigator.storage.getDirectory) missing.push('OPFS (navigator.storage)');

// ---- the module, compiled while the player reads the page
let modP: Promise<WebAssembly.Module> | null = null;
if (missing.length) status(`This browser lacks ${missing.join(', ')}.`);
else {
  status('Downloading the game module.');
  modP = WebAssembly.compileStreaming(fetch(new URLSearchParams(location.search).get('wasm') ?? '/game.wasm'));
  modP.then(() => { status('Ready. Press Play.'); playBtn.disabled = false; },
            e => status(`The game module did not load: ${e}`));
}

// ---- the picture
function present(p: GameProcess, ptr: number) {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let img: ImageData | null = null, last = -1, frames = 0, t0 = performance.now();
  const tick = () => {
    const buf = p.memory.buffer as unknown as SharedArrayBuffer;
    const u = new Uint32Array(buf, ptr, 8);
    const fr = Atomics.load(u, 4);
    if (fr !== last) {
      last = fr;
      const w = u[2], h = u[3], cur = Atomics.load(u, 7) & 1, px = u[5 + cur];
      if (w && h && px) {
        if (!img || img.width !== w || img.height !== h) {
          canvas.width = w; canvas.height = h; img = ctx.createImageData(w, h);
        }
        img.data.set(new Uint8Array(buf, px, w * h * 4));
        ctx.putImageData(img, 0, 0);
        frames++;
      }
    }
    const now = performance.now();
    if (now - t0 >= 1000) { status(`Running: ${(frames * 1000 / (now - t0)).toFixed(0)} frames per second.`); frames = 0; t0 = now; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- Play
playBtn.onclick = async () => {
  playBtn.disabled = true;
  const audioCtx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });   // inside the click: allowed to play
  try {
    const module = await modP!;
    status('Starting the game.');
    const t0 = performance.now();
    const p = await startProcess({
      module,
      initialPages: 16384,   // 1 GB: the guest's 640 MB and the runtime above it (tools/porsche_web_build.sh)
      cfg: {
        args: ['porsche', '/data/Porsche.exe'],
        env: { HOME: '/save', NFSU2_SAVEDIR: '/save', NFSU2_READONLY_DATA: '1',
               // ?env=NAME=value (repeatable): the runtime's switches, e.g. PORSCHE_PROF=1
               ...Object.fromEntries(new URLSearchParams(location.search).getAll('env')
                 .filter(e => e.includes('=')).map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)])) },
        dataBase: '/data/', manifestUrl: '/data-manifest', saveDir: 'porsche-save',
      },
      onLog: (s, fd, tid) => log(`[${tid}${fd === 2 ? '!' : ''}] ${s}`),
      onNote: log,
      onExit: code => { status(`The game ended (exit code ${code}).`); log(`EXIT ${code}`); },
    });
    log(`[page] process started in ${(performance.now() - t0).toFixed(0)} ms`);
    // precise sleeps for the game's threads (runtime/porsche_web/ticker.c)
    p.registered(10).then(r => {
      new Worker(new URL('/ticker.js', import.meta.url), { type: 'module', name: 'ticker' }).postMessage({ memory: p.memory, ptr: r.ptr });
      log('[page] ticker started (precise sleeps)');
    });
    try { await attachAudio(p, { context: audioCtx, log }); } catch (e) { log(`[page] audio: ${e}`); }
    try { attachInput(p, canvas, { log }); } catch (e) { log(`[page] input: ${e}`); }
    canvas.focus();
    status('Loading the game data (the first start downloads it).');
    // the module draws either with WebGPU (glide_gpu.c) or in software (glide_sw.c + fb_web.c)
    const first = await Promise.race([
      p.registered(PG_HOST_KIND).then(r => ({ gpu: true, r })),
      p.registered(HOST_KIND_FB).then(r => ({ gpu: false, r })),
    ]);
    log(`[page] first frame from the game at ${(performance.now() - t0).toFixed(0)} ms (${first.gpu ? 'WebGPU' : 'software'} renderer)`);
    if (first.gpu) {
      const q = new URLSearchParams(location.search);
      const g = await attachGlide(p, canvas, { log, scale: q.get('scale') ? +q.get('scale')! : undefined,
        trace: q.get('trace') ? q.get('trace')!.split(',').map(Number) : undefined });
      let last = 0, t1 = performance.now();
      setInterval(() => {
        const s = g.stats(), now = performance.now();
        status(`Running: ${((s.frames - last) * 1000 / (now - t1)).toFixed(0)} frames per second, ${s.drawsLast} draws, ${s.vertsLast} vertices.`);
        last = s.frames; t1 = now;
      }, 1000);
    } else present(p, first.r.ptr);
  } catch (e) {
    status(`The game did not start: ${e}`);
    log(String((e as Error)?.stack ?? e));
    playBtn.disabled = false;
  }
};
