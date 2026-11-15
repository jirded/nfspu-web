// Porsche Unleashed in the browser: the page's shell.
//
// The start page (Play, Saves, Game, Controls) and the game take turns: Play starts one run of the game
// (game.ts) over the page, and when it ends the start page is back and Play works again.  One game per
// browser: a Web Lock says which tab owns the save folder (instance.ts); another tab is read-only until
// it gets the lock.
//
// For development (as before): ?env=NAME=value (repeatable) sets a runtime variable, ?wasm= another
// module, ?scale=N the WebGPU picture's size, ?trace=a,b frames to trace; the log also goes to the
// server (POST /log -> out/web-porsche-browser.log).
import { startGame, type RunningGame } from './game';
import { playCard, type PlayState } from './ui-play';
import { claimInstance } from './instance';
import { LogRing, downloadBlob } from './logs';
import { enterFullscreen, exitFullscreen, isFullscreen, measureRefresh } from './display';
import { FpsOverlay, type FpsMode } from './overlay';
import { pageMenu } from './ui-menu';
import { opfsFs, readText, type SaveFs, type Entry } from './savefs';
import { shotName, stamp } from './profiles';
import { savesPanel } from './ui-saves';
import { gamePanel } from './ui-game';
import { controlsSheet } from './ui-controls';
import { SITE } from './keys';
import { resolve } from './settings';
import { tell } from './dialogs';

export interface Shell {
  /** this tab owns the save folder (false: the game is open in another tab) */
  readonly owner: boolean;
  readonly running: RunningGame | null;
  fs: SaveFs;
  /** the files of the game folder the server serves (its manifest), paths as the save folder's */
  readonly dataFiles: Entry[];
  /** settings.ini as it is now, null when there is none */
  settingsText(): Promise<string | null>;
  saveSettings(text: string): Promise<void>;
  /** the game started or ended, this tab became the owner, or the save folder changed */
  onChange(cb: () => void): void;
  /** tell the panels the save folder changed */
  changed(): void;
  /** closes the running game: asks it, and stops it if it does not answer */
  quit(): Promise<void>;
  /** runs something that changes the save folder or the data cache: Play is off until it is done and the Play card
   *  says `what`.  Not started (undefined) while a game runs or starts, or another such thing is under way. */
  during<T>(what: string, fn: () => Promise<T>): Promise<T | undefined>;
  /** something failed: into the log and before the player */
  report(what: string, e: unknown): void;
  log: LogRing;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);
const urlEnv = Object.fromEntries(query.getAll('env').filter(e => e.includes('='))
  .map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
const SETTINGS = 'settings.ini';
const LATENCY: Record<string, AudioContextLatencyCategory> = { lowest: 'interactive', balanced: 'balanced', robust: 'playback' };

// ---- the log: kept here for the download, and sent to the server for whoever debugs on this machine
const ring = new LogRing();
const pagePrefix = Math.random().toString(36).slice(2, 6);
let toServer: string[] = [];
setInterval(() => {
  if (!toServer.length) return;
  const body = toServer.join('\n'); toServer = [];
  void fetch('/log', { method: 'POST', body }).catch(() => {});
}, 1000);
function log(s: string) {
  const t = (performance.now() / 1000).toFixed(1);
  for (const l of s.split('\n')) if (l) { ring.add(l); toServer.push(`${pagePrefix} ${t} ${l}`); }
}
const downloadLog = () => downloadBlob(ring.text(), `porsche-log-${stamp()}.txt`, 'text/plain');

// ---- state
interface Problem { code: string; text: string; playable?: boolean }
const card = playCard($('play-card'));
const fs = opfsFs();
const listeners: (() => void)[] = [];
let owner = false, running: RunningGame | null = null, starting = false, quitAsked = false;
let moduleP: Promise<WebAssembly.Module> | null = null, moduleReady = false, progress = 0;
let problem: Problem | null = null, ended: string | null = null, savedAt: Date | null = null;
let settingsCache: string | null = null;
let dataFiles: Entry[] = [];
/** what is changing the save folder right now (Shell.during), null: nothing */
let working: string | null = null;
/** the display's refresh rate, measured as the page opens */
let displayHz = 60;
/** the largest automatic resolution scale this browser's graphics card kept up with (autoscale.ts), kept in this browser */
const AUTOSCALE = 'porsche.autoscale';
const autoScaleCap = () => { try { return Math.max(1, Math.min(4, +(localStorage.getItem(AUTOSCALE) ?? 4) || 4)); } catch { return 4; } };

const overlay = new FpsOverlay($('overlay'));
let toastTimer = 0;
/** a line over the game's picture; ms 0: it stays until the next one or the game's end */
function toast(text: string | null, ms = 1800) {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.hidden = !text; el.textContent = text ?? '';
  if (text && ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms) as unknown as number;
}
const closeDialogs = () => { for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close(); };

const changed = () => { for (const cb of listeners) try { cb(); } catch (e) { log(`[page] ${e}`); } };

function show() {
  let s: PlayState, detail: string | undefined, code: string | undefined, playable = false;
  if (running) s = 'running';
  else if (starting) s = 'starting';
  else if (working) { s = 'busy'; detail = working; }
  else if (!owner) s = 'elsewhere';
  else if (problem) { s = 'problem'; detail = problem.text; code = problem.code; playable = !!problem.playable && moduleReady; }
  else if (!moduleReady) { s = 'loading'; detail = progress ? `Downloading the game: ${Math.round(progress * 100)}%.` : undefined; }
  else if (ended !== null) { s = 'ended'; detail = ended; }
  else s = 'ready';
  card.set(s, detail, code, playable);
  card.extra(problem && problem.code.startsWith('GAME-') ? 'Download log' : null, downloadLog);
}

// ---- what the browser must have
function missing(): Problem | null {
  if (!crossOriginIsolated) return { code: 'NO-ISOLATION', text: 'This page is not cross-origin isolated, which the game\'s threads need. Open it from its own server (web-porsche/server.mjs).' };
  if (typeof SharedArrayBuffer === 'undefined') return { code: 'NO-SHARED-MEMORY', text: 'This browser has no shared memory (SharedArrayBuffer). Use the latest Google Chrome.' };
  if (!navigator.storage?.getDirectory) return { code: 'NO-OPFS', text: 'This browser cannot keep the saves (no private file system). Use the latest Google Chrome, not a private window.' };
  if (!(navigator as any).gpu && !(query.get('wasm') ?? '').includes('-sw')) return { code: 'NO-WEBGPU', text: 'This browser has no WebGPU, which draws the game. Use the latest Google Chrome on a computer.' };
  return null;
}

/** the module, compiled while it downloads, with how far the download is */
async function loadModule(url: string): Promise<WebAssembly.Module> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`the server answered ${r.status}`);
  const total = +(r.headers.get('Content-Length') ?? 0);
  if (!r.body || !total) return WebAssembly.compileStreaming(r);
  let got = 0;
  const counted = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) { got += chunk.byteLength; progress = got / total; show(); c.enqueue(chunk); },
  }));
  return WebAssembly.compileStreaming(new Response(counted, { headers: { 'Content-Type': 'application/wasm' } }));
}

async function hasData(): Promise<boolean> {
  try {
    const r = await fetch('/data-manifest');
    if (!r.ok) return false;
    const m = await r.json() as { files?: { p: string; d?: number; s?: number; m?: number }[] };
    dataFiles = (m.files ?? []).filter(f => !f.d).map(f => ({ path: f.p, size: f.s ?? 0, mtime: (f.m ?? 0) * 1000 }));
    return dataFiles.some(f => f.path.toLowerCase() === 'porsche.exe');
  } catch { return false; }
}

// ---- Play
function freshCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');   // a new one each game: a canvas keeps its first context for good
  c.id = 'screen'; c.width = 640; c.height = 480; c.tabIndex = 0;
  $('screen').replaceWith(c);
  return c;
}

async function play() {
  if (running || starting || working || !owner || !moduleReady || !moduleP || (problem && !problem.playable)) return;
  starting = true; problem = null; ended = null; savedAt = null; quitAsked = false;
  const res = resolve(settingsCache, urlEnv);
  for (const n of res.notes.slice(0, 20)) log(`[page] settings.ini: ${n}`);
  if (res.notes.length > 20) log(`[page] settings.ini: ${res.notes.length - 20} more lines ignored`);
  log(`[page] settings: ${Object.entries(res.page).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const canvas = freshCanvas();
  document.body.classList.add('playing');
  if (res.page.fullscreen_on_play === '1') void enterFullscreen($('stage')).then(r => { if (!r.ok) log(`[page] full screen: ${r.error}`); });
  toast('Starting the game', 0);
  const slow = setTimeout(() => { if (starting) toast('Still starting. If nothing comes, reload the page.', 0); }, 30000);
  show();
  let audio: AudioContext | null = null;
  try {
    // inside the click: the sound may play
    audio = new AudioContext({ sampleRate: 44100, latencyHint: LATENCY[res.page.output_latency] ?? 'interactive' });
    const scale = query.get('scale') ? +query.get('scale')! : res.page.resolution_scale === 'auto' ? undefined : +res.page.resolution_scale;
    const g = await startGame({
      module: await moduleP, canvas, audio, env: res.env, scale, log,
      displayHz, autoScaleCap: autoScaleCap(),
      onAutoScale: cap => { try { localStorage.setItem(AUTOSCALE, String(cap)); } catch { /* storage off */ } },
      trace: query.get('trace') ? query.get('trace')!.split(',').map(Number) : undefined,
      onSaved: path => { if (/^\/?savedata[\\/]/i.test(path)) savedAt = new Date(); },
    });
    running = g; starting = false;
    clearTimeout(slow);
    overlay.set(res.page.fps_counter as FpsMode, g);
    toast('Menu: Home', 4000);
    show(); changed();
    if (query.get('probe') === 'mouse') void mouseProbe(g);
    void g.exited.then(code => {
      running = null;
      overlay.set('off', null); toast(null); closeDialogs();
      exitFullscreen();
      document.body.classList.remove('playing');
      if (code === 0 || quitAsked) {
        ended = savedAt ? `Saved at ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Nothing was saved in that game.';
      } else problem = { code: 'GAME-EXIT', text: `The game ended by itself (exit code ${code}). The log says more.`, playable: true };
      show(); changed();
    });
  } catch (e) {
    starting = false;
    toast(null);
    exitFullscreen();
    document.body.classList.remove('playing');
    void audio?.close().catch(() => {});
    log(String((e as Error)?.stack ?? e));
    problem = { code: 'GAME-START', text: `The game did not start: ${(e as Error)?.message ?? e}`, playable: true };
    show();
  } finally { clearTimeout(slow); }
}

/** ?probe=mouse (development): 22 s after the game started, measures how long a
 *  pointer move takes to show in the picture (mouse-latency.js) and writes the result into the log.  Keep the
 *  mouse still meanwhile. */
async function mouseProbe(g: RunningGame) {
  await new Promise(r => setTimeout(r, 22000));   // the first menu is up and the automatic scale has settled
  if (running !== g) return;
  try {
    const url = '/mouse-latency.js';
    await import(url);
    toast('Measuring the mouse: keep it still', 0);
    const w = window as any, rd = g.renderer;
    const s0 = rd?.stats(), p = await w.rafProfile(2500), s1 = rd?.stats(), m = await w.mouseLatency(10);
    log(`[probe] picture at ${s1?.scale ?? '?'}x: shown ${p.hz} a second (frame ${p.intervalMs.median} ms, p90 ${p.intervalMs.p90}), game ${m.gameFps} fps, ` +
        `${s0 && s1 ? `${s1.skipped - s0.skipped} of ${s1.frames - s0.frames} frames skipped, ` : ''}` +
        `mouse ${m.medianMs} ms (${m.trials.map((t: any) => t.ms ?? '-').join(' ')}), ${m.trials.map((t: any) => t.gameFrames ?? '-').join(' ')} game frames; canvas ${p.canvas}`);
    toast('Mouse measured: see the log', 4000);
  } catch (e) { log(`[probe] mouse latency: ${e}`); toast(null); }
}

async function quit() {
  const g = running;
  if (!g) return;
  quitAsked = true;
  toast('Closing the game', 0);
  if (await g.quit() === 'stopped') { ended = `${ended ?? ''} The game did not answer and was stopped.`.trim(); show(); }
}

// ---- the shell the panels see
const shell: Shell = {
  get owner() { return owner; },
  get running() { return running; },
  fs,
  get dataFiles() { return dataFiles; },
  async settingsText() { return settingsCache = await readText(fs, SETTINGS); },
  async saveSettings(text) { await fs.write(SETTINGS, text); settingsCache = text; changed(); },
  onChange(cb) { listeners.push(cb); },
  changed,
  quit,
  async during(what, fn) {
    if (running || starting || working) return undefined;
    working = what; show();
    try { return await fn(); }
    finally { working = null; show(); }
  },
  report(what, e) {
    const why = (e as Error)?.message ?? String(e);
    log(`[page] ${what}: ${(e as Error)?.stack ?? why}`);
    void tell('problem', [`${what}: ${why}`]);
  },
  log: ring,
};
(window as any).__shell = shell;

// ---- the page's own keys and questions
card.onPlay(() => void play());
addEventListener('keydown', e => {
  if (e.key !== 'Enter' || running || starting || e.repeat || document.querySelector('dialog[open]')) return;
  const t = e.target as HTMLElement | null;
  if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName)) return;
  e.preventDefault();
  void play();
});
addEventListener('beforeunload', e => { if (running || starting || working) { e.preventDefault(); e.returnValue = ''; } });
const showLog = () => { $('log').textContent = ring.text(); $<HTMLDialogElement>('logdlg').showModal(); $('log').scrollTop = $('log').scrollHeight; };
$('show-log').onclick = showLog;
$('log-download').onclick = downloadLog;
$('log-close').onclick = () => $<HTMLDialogElement>('logdlg').close();

// ---- while playing: the page menu, the counter, the screenshot (keys.ts SITE: Home, End, Insert; the game
// uses F1 to F12 itself).  The page takes its keys before the game does: this listener is added before the
// game's input, so it runs first.
const menu = pageMenu($<HTMLDialogElement>('menu'), shell, {
  fullscreen: () => {
    if (isFullscreen()) exitFullscreen();
    else void enterFullscreen($('stage')).then(r => log(r.ok ? `[page] full screen${r.locked ? ', keys locked (hold Esc to leave)' : ''}` : `[page] full screen: ${r.error}`));
  },
  counter: () => overlay.set(overlay.next(), running),
  controls: () => $<HTMLDialogElement>('ctldlg').showModal(),
  log: showLog,
  downloadLog,
  quit: () => void quit(),
  state: () => ({ fullscreen: isFullscreen(), counter: overlay.mode }),
});
const PAGE_KEYS = new Set<string>(Object.values(SITE));
/** the game's picture as a PNG beside the saves (Saves shows them) */
async function screenshot() {
  const g = running;
  if (!g) return;
  if (!g.renderer) return toast('Screenshots need the WebGPU build of the game');
  try {
    const png = await g.renderer.shot();
    if (!png) return toast('No picture to save yet');
    await fs.write(shotName(new Date()), new Uint8Array(await png.arrayBuffer()));
    toast('Screenshot saved');
    changed();
  } catch (e) { log(`[page] screenshot: ${e}`); toast('The screenshot could not be saved'); }
}
addEventListener('keydown', e => {
  if (!running || !PAGE_KEYS.has(e.code)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.code === SITE.menu) { if (menu.isOpen) menu.close(); else if (!document.querySelector('dialog[open]')) menu.open(); }
  else if (e.code === SITE.counter) overlay.set(overlay.next(), running);
  else void screenshot();
}, true);
addEventListener('keyup', e => { if (running && PAGE_KEYS.has(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
// a dialog closed while the game runs: the keys go to the game again
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', () => { if (running && !document.querySelector('dialog[open]')) $('screen').focus(); });
$('ctl-close').onclick = () => $<HTMLDialogElement>('ctldlg').close();

// ---- the tabs: a click or the arrow keys; the last one chosen is remembered in this browser
function tabs() {
  const all = [...document.querySelectorAll<HTMLButtonElement>('#tabs .tab')];
  const pick = (t: HTMLButtonElement, focus = false) => {
    for (const b of all) {
      const on = b === t;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      $(b.getAttribute('aria-controls')!).hidden = !on;
    }
    try { localStorage.setItem('porsche.tab', t.id); } catch { /* storage off */ }
    if (focus) t.focus();
  };
  for (const [i, b] of all.entries()) {
    b.onclick = () => pick(b);
    b.onkeydown = e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); pick(all[(i + d + all.length) % all.length], true); }
    };
  }
  let last: string | null = null;
  try { last = localStorage.getItem('porsche.tab'); } catch { /* storage off */ }
  pick(all.find(b => b.id === last) ?? all[0]);
}

// ---- boot
async function boot() {
  tabs();
  void measureRefresh().then(r => { displayHz = r.hz; log(`[page] display: ${r.hz} Hz (animation frames at ${r.raw.toFixed(1)} a second)`); });
  savesPanel($('panel-saves'), shell);
  gamePanel($('panel-game'), shell);
  controlsSheet($('panel-controls'));
  controlsSheet($('ctl-sheet'));
  log(`[page] Porsche Unleashed start page, ${navigator.userAgent}`);
  show();
  const inst = claimInstance();
  void inst.whenOwner.then(async () => {
    owner = true;
    await shell.settingsText();
    log('[page] this tab owns the saves');
    show(); changed();
  });
  await Promise.race([inst.whenOwner, new Promise(r => setTimeout(r, 300))]);
  show();
  problem = missing();
  if (problem) { log(`[page] ${problem.code}: ${problem.text}`); show(); return; }
  moduleP = loadModule(query.get('wasm') ?? '/game.wasm');
  moduleP.then(() => { moduleReady = true; log('[page] the game module is ready'); show(); },
    e => { problem = { code: 'MODULE-LOAD', text: `The game did not download: ${(e as Error)?.message ?? e}. Reload the page; if it stays, the server has no built game (out/web/porsche.wasm).` }; log(`[page] ${problem.text}`); show(); });
  if (!await hasData() && !problem) {
    problem = { code: 'NO-DATA', text: 'The server has no game folder to serve. Start it with --data "<the folder with Porsche.exe>".' };
    log(`[page] ${problem.code}`); show();
  }
  changed();   // the game folder's own players are known now
}
void boot();
