// A probe for the browser console (not a unit test): how many animation frames pass between a pointer
// move on the game's canvas and the first drawn frame that shows it, in the game's menus.
// Open the page with ?probe=mouse (it runs 15 s after Play and logs the result), or in the console:
//   await mouseLatency()   ->  { rafHz, gameFps, trials: [{ frames, ms, gameFrames }], median... }
// It moves the pointer between two spots with synthetic pointermove events and watches a small patch of
// the canvas at the target (read back with drawImage in an animation frame, after the renderer drew).
window.mouseLatency = async function (trials = 10, A = [90, 330], B = [560, 250]) {
  const c = document.getElementById('screen'), g = window.__shell.running;
  if (!g || !g.renderer) throw new Error('no WebGPU game running');
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const N = 24, probe = new OffscreenCanvas(N, N), px = probe.getContext('2d', { willReadFrequently: true });
  const patch = ([gx, gy]) => {            // the game's 24x24 pixels right and below the point: where its cursor is drawn
    const k = c.width / 640;
    px.drawImage(c, gx * k, gy * k, N * k, N * k, 0, 0, N, N);
    return px.getImageData(0, 0, N, N).data.slice();
  };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4); };
  const move = ([gx, gy]) => {
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + gx / 640 * r.width, clientY: r.top + gy / 480 * r.height,
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
  };
  const frames = () => g.renderer.stats().frames;
  /** the next animation frame in which the renderer drew a new game frame */
  const drawn = async () => { for (;;) { const f = frames(); await raf(); if (frames() !== f) return; } };

  // the display's rate and the game's
  let t0 = performance.now(), f0 = frames(), n = 0;
  while (performance.now() - t0 < 1000) { await raf(); n++; }
  const rafHz = n * 1000 / (performance.now() - t0), gameFps = (frames() - f0) * 1000 / (performance.now() - t0);

  const out = [];
  for (let t = 0; t < trials; t++) {
    const [from, to] = t % 2 ? [B, A] : [A, B];
    move(from);
    for (let i = 0; i < 40; i++) await raf();                 // the cursor rests at `from`
    await drawn(); const base = patch(to);
    await drawn(); const noise = diff(base, patch(to));        // what the patch changes by on its own
    const start = performance.now(), fStart = frames();
    move(to);
    let k = 0, hit = null;
    while (k < 60) {
      const f = frames(); await raf(); k++;
      if (frames() === f) continue;                            // nothing new drawn: the canvas holds no picture to read
      const d = diff(base, patch(to));
      if (d > Math.max(6, noise * 4)) { hit = { frames: k, ms: Math.round(performance.now() - start), gameFrames: frames() - fStart, d: Math.round(d), noise: Math.round(noise) }; break; }
    }
    out.push(hit ?? { frames: null });
  }
  const ok = out.filter(o => o.frames).map(o => o.frames).sort((a, b) => a - b);
  return { rafHz: Math.round(rafHz), gameFps: Math.round(gameFps), median: ok[ok.length >> 1] ?? null, min: ok[0] ?? null, max: ok[ok.length - 1] ?? null,
           medianMs: (out.filter(o => o.ms).map(o => o.ms).sort((a, b) => a - b))[ok.length >> 1] ?? null, trials: out };
};

// Where an animation frame's time goes: for `ms` milliseconds every requestAnimationFrame callback is timed.
//   await rafProfile()  ->  { hz, intervalMs: {median, p90, max}, workMs: {median, max}, callbacks: [...], longTasks }
// hz far below the display's rate with little work per frame means the frames are not held up by the page's script.
window.rafProfile = async function (ms = 3000) {
  const orig = window.requestAnimationFrame, stat = new Map(), frames = [];
  let last = -1;
  const long = [];
  let po = null;
  try { po = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); po.observe({ entryTypes: ['longtask'] }); } catch { /* no long task timing */ }
  window.requestAnimationFrame = cb => orig.call(window, t => {
    const a = performance.now();
    if (t !== last) { frames.push({ t, work: 0 }); last = t; }
    try { cb(t); }
    finally {
      const d = performance.now() - a;
      frames[frames.length - 1].work += d;
      const k = cb.toString().replace(/\s+/g, ' ').slice(0, 70);
      const s = stat.get(k) ?? { n: 0, ms: 0, max: 0 };
      s.n++; s.ms += d; s.max = Math.max(s.max, d); stat.set(k, s);
    }
  });
  await new Promise(r => setTimeout(r, ms));
  window.requestAnimationFrame = orig;
  po?.disconnect();
  const iv = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b), wk = frames.map(f => f.work).sort((a, b) => a - b);
  const q = (a, p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : null);
  return {
    hz: Math.round(frames.length * 1000 / ms), intervalMs: { median: q(iv, 0.5), p90: q(iv, 0.9), max: q(iv, 1) },
    workMs: { median: q(wk, 0.5), p90: q(wk, 0.9), max: q(wk, 1) },
    callbacks: [...stat].map(([k, s]) => ({ fn: k, n: s.n, avgMs: +(s.ms / s.n).toFixed(2), maxMs: +s.max.toFixed(1) })).sort((a, b) => b.avgMs * b.n - a.avgMs * a.n).slice(0, 6),
    longTasks: { n: long.length, maxMs: Math.max(0, ...long) },
    screen: `${screen.width}x${screen.height} dpr ${devicePixelRatio}`, canvas: (c => `${c.width}x${c.height} shown ${c.clientWidth}x${c.clientHeight}`)(document.getElementById('screen')),
  };
};
