// When "Resolution scale: Auto" draws the picture smaller by itself: the graphics card cannot keep up.
//
// Auto starts at what fits the window (up to 4 times the game's 640x480).  An integrated GPU cannot fill
// that many pixels in time.  Measured on one, on a 144 Hz display: with the picture at 3 times a frame of
// the game was drawn every 43 ms and the mouse was 100 ms behind; at 2 times every 26 ms (79 ms); at 1 time
// every 14 ms, the game's own rate (27 ms).  The game waits for each frame to be drawn before it makes the
// next (glide_gpu.c glb_swap), so a slow card shows as frames far apart.
// Frames are also far apart when the game itself is slow, or in a window the browser holds back (half
// covered: animation frames 13 times a second), and no size of picture helps that.  So a step down is a
// trial: when the frames do not come closer with it, it is taken back and the picture is left alone.
// Pure (test/autoscale.test.mjs).

/** where the page keeps the largest scale Auto came down to, in this browser.  The number at its end goes up
 *  when drawing got cheaper, so that what an earlier version of the page had to settle for is forgotten (2: the
 *  specialised shader, 6 times less work for the card than the one before). */
export const AUTOSCALE_KEY = 'porsche.autoscale.2';

/** frames of the game further apart than this are slow (under 50 a second), or than one and a quarter of the
 *  display's refreshes (a 60 Hz display's every refresh, 16.7 ms, is not slow; every other one is) */
const SLOW_MS = 20;
/** longer than this is no slow card: the window is covered or hidden and the browser holds the frames back */
const THROTTLED_MS = 200;
/** frames are judged WINDOW at a time; the picture goes one step down when NEED of them were slow */
const WINDOW = 60, NEED = 40;
/** a step down helped when the frames came this much closer: to this part of the time between them */
const HELPED = 0.7;

/** lower: draw the picture one step smaller, as a trial.  keep: the trial helped, the size stays (remember it).
 *  undo: it did not help, go back up; the governor says nothing more. */
export type Verdict = 'lower' | 'keep' | 'undo';

export class ScaleGovernor {
  private gaps: number[] = [];
  private readonly limit: number;
  /** the average time between frames before the step down on trial */
  private trial: number | null = null;
  private done = false;
  /** displayHz: the display's refresh rate as measured; below 50 it was measured in a covered window and counts as 60 */
  constructor(displayHz: number) { this.limit = Math.max(SLOW_MS, 1.25 * 1000 / (displayHz >= 50 ? displayHz : 60)); }

  /** A frame of the game is drawn, `ms` after the one before. */
  sample(ms: number): Verdict | null {
    if (this.done || !(ms >= 0) || ms > THROTTLED_MS) return null;
    this.gaps.push(ms);
    if (this.gaps.length < WINDOW) return null;
    const avg = this.gaps.reduce((a, b) => a + b, 0) / WINDOW, slow = this.gaps.filter(g => g > this.limit).length;
    this.gaps = [];
    if (this.trial !== null) {
      const helped = avg <= HELPED * this.trial;
      this.trial = null;
      if (!helped) this.done = true;
      return helped ? 'keep' : 'undo';
    }
    if (slow < NEED) return null;
    this.trial = avg;
    return 'lower';
  }
  /** the picture's size was changed by someone else: start again */
  reset() { this.gaps = []; this.trial = null; this.done = false; }
}
