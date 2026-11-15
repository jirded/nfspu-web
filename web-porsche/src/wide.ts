// Wide screen driving, the page's part.  The game's options offer, next to its 4:3 sizes, pictures made to
// fit the page: 720, 1080 and 1440 lines at the aspect of the stage, and the stage's own size in pixels (the
// runtime gives four of the game's display modes those sizes: runtime/porsche/porsche_hle.c).  The page tells
// the game how large the stage is (glide-gpu.ts writes it into the control block) and gives the canvas the
// aspect of the picture the game makes.  Pure: no DOM (test/wide.test.mjs).

/** what the game is told: the stage in the display's own pixels, [0, 0] while it has no size */
export function viewPixels(cssW: number, cssH: number, dpr: number): [number, number] {
  if (!(cssW > 0) || !(cssH > 0) || !(dpr > 0)) return [0, 0];
  return [Math.round(cssW * dpr), Math.round(cssH * dpr)];
}

/** the scale a w x h picture is drawn at: the wanted one, cut so that the picture still fits one texture of the
 *  card (maxDim a side), at least 1 */
export function fitScale(want: number, w: number, h: number, maxDim: number): number {
  return Math.max(1, Math.min(want, Math.floor(maxDim / Math.max(w, h))));
}
