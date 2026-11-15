// The precise-sleep ticker (runtime/porsche_web/ticker.c): while any game
// thread sleeps, notify the shared `tick` word every half millisecond, so a
// sleeper wakes close to its deadline instead of on Windows' 15.6 ms timer.
// Nobody asleep: this worker waits (no CPU) until a sleeper arrives.
// Block: i32 [0] tick, [1] on, [2] sleepers.
const PERIOD_MS = 0.5;
self.onmessage = (e: MessageEvent<{ memory: WebAssembly.Memory; ptr: number }>) => {
  const w = new Int32Array(e.data.memory.buffer as unknown as ArrayBuffer, e.data.ptr, 4);
  Atomics.store(w, 1, 1);
  for (;;) {
    if (Atomics.load(w, 2) === 0) { Atomics.wait(w, 2, 0, 1000); continue; }
    const until = performance.now() + PERIOD_MS;
    while (performance.now() < until) { /* spin: a timed wait would end on the coarse OS timer */ }
    Atomics.add(w, 0, 1);
    Atomics.notify(w, 0);
  }
};
