// When the picture is drawn smaller by itself (src/autoscale.ts): the graphics card cannot keep up.
// The sign is how far apart the game's frames are drawn.  The numbers are a measured case, an integrated
// GPU on a 144 Hz display: a frame every 43 ms with the picture at 3 times the game's resolution (the mouse
// 100 ms behind), every 26 ms at 2 times (79 ms), every 14 ms at 1 time (27 ms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { ScaleGovernor } = await load('autoscale.ts');

/** `n` frames of the game, each drawn `ms` after the one before; what the governor said meanwhile */
function run(g, ms, n) {
  const said = [];
  for (let i = 0; i < n; i++) { const r = g.sample(ms); if (r) said.push(r); }
  return said;
}

test('frames at the game\'s own rate are left alone', () => {
  assert.deepEqual(run(new ScaleGovernor(144), 14, 600), []);      // 70 a second
  assert.deepEqual(run(new ScaleGovernor(144), 17, 600), []);
  assert.deepEqual(run(new ScaleGovernor(60), 16.7, 600), []);     // a 60 Hz display's every refresh
  assert.deepEqual(run(new ScaleGovernor(60), 18.5, 600), []);     // and its jitter
});

test('the measured card: 43 ms at 3x, 26 ms at 2x, 14 ms at 1x', () => {
  const g = new ScaleGovernor(144);
  assert.deepEqual(run(g, 43, 59), []);              // not before it has seen enough
  assert.deepEqual(run(g, 43, 1), ['lower']);        // 3x -> 2x
  assert.deepEqual(run(g, 26, 60), ['keep']);        // that helped
  assert.deepEqual(run(g, 26, 60), ['lower']);       // 38 frames a second is still slow: 2x -> 1x
  assert.deepEqual(run(g, 14, 60), ['keep']);
  assert.deepEqual(run(g, 14, 600), []);
});

test('a 60 Hz display at half its rate is slow too', () => {
  assert.deepEqual(run(new ScaleGovernor(60), 33.3, 60), ['lower']);
});

test('frames that are no closer with a smaller picture are not the card: the step is taken back, once', () => {
  const held = new ScaleGovernor(144);                // a half covered window: animation frames 13 times a second
  assert.deepEqual(run(held, 77, 60), ['lower']);
  assert.deepEqual(run(held, 77, 60), ['undo']);
  assert.deepEqual(run(held, 77, 600), []);
  const game = new ScaleGovernor(144);                // a game that makes 30 frames a second by itself
  assert.deepEqual(run(game, 33, 60), ['lower']);
  assert.deepEqual(run(game, 31, 60), ['undo']);
  assert.deepEqual(run(game, 33, 600), []);
});

test('a few slow frames among fast ones (loading, a new texture) do not lower it', () => {
  const g = new ScaleGovernor(144);
  const said = [];
  for (let i = 0; i < 20; i++) said.push(...run(g, 60, 1), ...run(g, 14, 5));
  assert.deepEqual(said, []);
});

test('a covered or hidden window says nothing about the card', () => {
  const g = new ScaleGovernor(144);
  assert.deepEqual(run(g, 500, 300), []);      // animation frames twice a second
  assert.deepEqual(run(g, 1000, 300), []);
  assert.equal(g.sample(-1), null);
  assert.equal(g.sample(NaN), null);
});

test('reset forgets what it saw', () => {
  const g = new ScaleGovernor(144);
  run(g, 43, 59);
  g.reset();
  assert.deepEqual(run(g, 43, 59), []);
});

test('a display rate measured while the window was covered (21 Hz) counts as 60', () => {
  assert.deepEqual(run(new ScaleGovernor(21), 43, 60), ['lower']);     // 43 ms is slow against a real display's 16.7 ms
  assert.deepEqual(run(new ScaleGovernor(21), 18.5, 600), []);
});
