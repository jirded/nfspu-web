// The Play card: one state at a time, in words, and the Play button.
export type PlayState = 'loading' | 'ready' | 'starting' | 'running' | 'ended' | 'problem' | 'elsewhere' | 'busy';

const HEAD: Record<PlayState, string> = {
  loading: 'loading', ready: 'ready', starting: 'starting', running: 'running', ended: 'game over',
  problem: 'problem', elsewhere: 'open elsewhere', busy: 'one moment',
};
const DETAIL: Record<PlayState, string> = {
  loading: 'Downloading the game.',
  ready: 'The game is loaded. Press Play or Enter.',
  starting: 'Starting the game.',
  running: 'The game is running.',
  ended: '',
  problem: '',
  elsewhere: 'The game is open in another tab. Switch to it, or close it and this page takes over.',
  busy: 'Working on the saves.',
};

export interface PlayCard {
  /** detail: the line under the headline (default: the state's own); code: a problem's short code;
   *  playable: a problem a new Play may get past (the game ended by itself), so Play stays on */
  set(state: PlayState, detail?: string, code?: string, playable?: boolean): void;
  readonly state: PlayState;
  onPlay(cb: () => void): void;
  /** a button under the text (the log download after a problem); null takes it away */
  extra(label: string | null, cb?: () => void): void;
}

export function playCard(root: HTMLElement): PlayCard {
  root.innerHTML = `
    <h2 class="play-state" id="play-state" aria-live="polite"></h2>
    <p class="play-detail" id="play-detail"></p>
    <p class="play-code" id="play-code" hidden></p>
    <button class="btn-race" id="play" type="button" disabled>Play <kbd>Enter</kbd></button>
    <button class="btn" id="play-extra" type="button" hidden></button>`;
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const head = q('play-state'), detail = q('play-detail'), code = q('play-code');
  const btn = q<HTMLButtonElement>('play'), more = q<HTMLButtonElement>('play-extra');
  let state: PlayState = 'loading', play: () => void = () => {}, moreCb: () => void = () => {};
  btn.onclick = () => { if (!btn.disabled) play(); };
  more.onclick = () => moreCb();
  const card: PlayCard = {
    get state() { return state; },
    set(s, d, c, playable = false) {
      state = s;
      root.dataset.state = s;
      head.textContent = HEAD[s];
      detail.textContent = d ?? DETAIL[s];
      code.hidden = !c; code.textContent = c ?? '';
      btn.disabled = !(s === 'ready' || s === 'ended' || (s === 'problem' && playable));
    },
    onPlay(cb) { play = cb; },
    extra(label, cb) { more.hidden = !label; more.textContent = label ?? ''; moreCb = cb ?? (() => {}); },
  };
  card.set('loading');
  return card;
}
