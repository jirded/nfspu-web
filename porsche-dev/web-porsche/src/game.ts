// One run of the game: the recompiled Porsche.exe (/game.wasm) started through nfsu2-web's host
// (web/src/host: shared memory, game-thread workers, the I/O worker that serves /data from the server
// and /save from OPFS), with its ticker, sound, input and picture attached.  The picture: the module
// draws either with WebGPU (runtime/porsche_web/glide_gpu.c -> glide-gpu.ts) or in software
// (glide_sw.c + fb_web.c, host kind 8: each finished frame is copied onto the canvas).
// Everything attached here is taken off again when the game ends, so the page can start another.
import { startProcess, type GameProcess } from '../../web/src/host/process';
import { attachAudio, type AudioHandle } from '../../web/src/audio/index';
import { attachInput, type InputHandle } from '../../web/src/input/index';
import { attachGlide, PG_HOST_KIND, type GlideRenderer } from './glide-gpu';
import { SAVE_DIR } from './savefs';

const HOST_KIND_FB = 8, HOST_KIND_TICKER = 10;
/** how long quit() waits for the game: the runtime's own 2 s for WM_CLOSE, then at most 5 s for open save files
 *  and 2 s to stop the game's threads, and some room */
const QUIT_GRACE_MS = 12000;

export interface GameOptions {
  module: WebAssembly.Module;
  /** a canvas no context was taken from yet */
  canvas: HTMLCanvasElement;
  /** made inside the Play click, so it may play; closed when the game ends */
  audio: AudioContext;
  /** added to HOME, NFSU2_SAVEDIR and NFSU2_READONLY_DATA */
  env: Record<string, string>;
  /** the WebGPU picture's size, in times the game's resolution (default: what fits the canvas, up to 4) */
  scale?: number;
  /** for the automatic scale (glide-gpu.ts GlideOptions): the display's rate, the largest scale, and the word when it came down */
  displayHz?: number; autoScaleCap?: number; onAutoScale?(cap: number): void;
  trace?: number[];
  log(s: string): void;
  /** the game closed a file of the save folder it had written, path relative to it */
  onSaved?(path: string): void;
}

export interface RunningGame {
  input: InputHandle;
  /** null: the software renderer build */
  renderer: GlideRenderer | null;
  /** the exit code; -1 when it was stopped */
  exited: Promise<number>;
  /** asks the game to close, waits graceMs (default 12 s) for it, then stops it */
  quit(graceMs?: number): Promise<'quit' | 'stopped'>;
  /** frames shown in the last second */
  fps(): number;
}

/** the software picture: copies each frame the game publishes onto the canvas; returns its frame count and a stop */
function present(p: GameProcess, canvas: HTMLCanvasElement, ptr: number) {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let img: ImageData | null = null, last = -1, frames = 0, on = true;
  const tick = () => {
    if (!on) return;
    const buf = p.memory.buffer as unknown as SharedArrayBuffer;
    const u = new Uint32Array(buf, ptr, 8);
    const fr = Atomics.load(u, 4);
    if (fr !== last) {
      last = fr;
      const w = u[2], h = u[3], cur = Atomics.load(u, 7) & 1, px = u[5 + cur];
      if (w && h && px) {
        if (!img || img.width !== w || img.height !== h) { canvas.width = w; canvas.height = h; img = ctx.createImageData(w, h); }
        img.data.set(new Uint8Array(buf, px, w * h * 4));
        ctx.putImageData(img, 0, 0);
        frames++;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { frames: () => frames, stop: () => { on = false; } };
}

export async function startGame(o: GameOptions): Promise<RunningGame> {
  const { log, canvas } = o;
  const t0 = performance.now();
  const undo: (() => void)[] = [];
  let p: GameProcess | null = null;
  try {
    p = await startProcess({
      module: o.module,
      initialPages: 16384,   // 1 GB: the guest's 640 MB and the runtime above it (tools/porsche_web_build.sh)
      cfg: {
        args: ['porsche', '/data/Porsche.exe'],
        // NFSU2_QUIT_GRACE: Porsche's window ignores WM_CLOSE (it has no close box: the way out is its own exit
        // menu), so the runtime ends the game itself after this many seconds, once the save files are closed
        // (runtime/lifecycle.c, runtime/web/input_web.c force_exit)
        env: { HOME: '/save', NFSU2_SAVEDIR: '/save', NFSU2_READONLY_DATA: '1', NFSU2_QUIT_GRACE: '2', ...o.env },
        dataBase: '/data/', manifestUrl: '/data-manifest', saveDir: SAVE_DIR,
      },
      onLog: (s, fd, tid) => log(`[${tid}${fd === 2 ? '!' : ''}] ${s}`),
      onNote: log,
      onSaved: path => o.onSaved?.(path),
      onExit: code => log(`EXIT ${code}`),
    });
    const proc = p;
    log(`[page] process started in ${(performance.now() - t0).toFixed(0)} ms`);
    // precise sleeps for the game's threads (runtime/porsche_web/ticker.c)
    let over = false;
    void proc.exited.then(() => { over = true; });
    void proc.registered(HOST_KIND_TICKER).then(r => {
      if (over) return;
      const w = new Worker(new URL('/ticker.js', import.meta.url), { type: 'module', name: 'ticker' });
      w.postMessage({ memory: proc.memory, ptr: r.ptr });
      undo.push(() => w.terminate());
      log('[page] ticker started (precise sleeps)');
    });
    let audio: AudioHandle | null = null;
    try { audio = await attachAudio(proc, { context: o.audio, log }); } catch (e) { log(`[page] audio: ${e}`); void o.audio.close().catch(() => {}); }
    if (audio) { const a = audio; undo.push(() => a.detach()); }
    const input = attachInput(proc, canvas, { log });
    undo.push(() => input.detach());
    canvas.focus();

    const first = await Promise.race([
      proc.registered(PG_HOST_KIND).then(r => ({ gpu: true, r })),
      proc.registered(HOST_KIND_FB).then(r => ({ gpu: false, r })),
      proc.exited.then(code => { throw new Error(`the game ended before its first frame (exit code ${code})`); }),
    ]);
    log(`[page] first frame from the game at ${(performance.now() - t0).toFixed(0)} ms (${first.gpu ? 'WebGPU' : 'software'} renderer)`);
    let renderer: GlideRenderer | null = null, frames: () => number;
    if (first.gpu) {
      const g = renderer = await attachGlide(proc, canvas, { log, scale: o.scale, trace: o.trace,
        displayHz: o.displayHz, autoCap: o.autoScaleCap, onAutoCap: o.onAutoScale });
      undo.push(() => g.detach());
      frames = () => g.stats().frames;
    } else {
      const s = present(proc, canvas, first.r.ptr);
      undo.push(s.stop);
      frames = s.frames;
    }
    let rate = 0, last = frames(), t1 = performance.now();
    const meter = setInterval(() => {
      const f = frames(), now = performance.now();
      rate = (f - last) * 1000 / (now - t1); last = f; t1 = now;
    }, 1000);
    undo.push(() => clearInterval(meter));

    void proc.exited.then(() => {
      for (const u of undo.splice(0).reverse()) try { u(); } catch (e) { log(`[page] cleanup: ${e}`); }
      // the game is over, its files are closed: the workers go, and with them the I/O worker's hold on the
      // data cache (its open files kept "Delete game data" and the next game's cache from them)
      proc.terminate();
    });
    return {
      input, renderer, exited: proc.exited,
      fps: () => rate,
      async quit(graceMs = QUIT_GRACE_MS) {
        let done = false;
        void proc.exited.then(() => { done = true; });
        if (graceMs > 0 && input.requestQuit()) await Promise.race([proc.exited, new Promise(r => setTimeout(r, graceMs))]);
        await Promise.resolve();
        if (done) return 'quit';
        log('[page] the game did not close: stopping it');
        proc.terminate();
        await proc.exited;
        return 'stopped';
      },
    };
  } catch (e) {
    for (const u of undo.splice(0).reverse()) try { u(); } catch { /* going down anyway */ }
    p?.terminate();
    throw e;
  }
}
