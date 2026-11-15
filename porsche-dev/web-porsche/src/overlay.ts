// The frame-rate counter over the game (End: off, on, detailed).
import type { RunningGame } from './game';

export type FpsMode = 'off' | 'on' | 'detailed';
export const FPS_MODES: readonly FpsMode[] = ['off', 'on', 'detailed'];

export class FpsOverlay {
  mode: FpsMode = 'off';
  private timer = 0;
  constructor(private el: HTMLElement) {}

  /** on: frames per second; detailed: also what the last frame drew (the WebGPU renderer's numbers) */
  set(mode: FpsMode, game: RunningGame | null) {
    this.mode = mode;
    clearInterval(this.timer);
    if (mode === 'off' || !game) { this.el.hidden = true; return; }
    const draw = () => {
      let s = `${Math.round(game.fps())} fps`;
      const st = mode === 'detailed' ? game.renderer?.stats() : null;
      if (st) s += `\n${st.drawsLast} draws\n${st.vertsLast} vertices\n${st.textures} textures\n${st.pipelines} pipelines`;
      this.el.textContent = s;
    };
    draw();
    this.el.hidden = false;
    this.timer = setInterval(draw, 500) as unknown as number;
  }
  /** the mode the counter key goes to from this one */
  next(): FpsMode { return FPS_MODES[(FPS_MODES.indexOf(this.mode) + 1) % FPS_MODES.length]; }
}
