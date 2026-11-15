// The page menu while playing (Home): full screen, the frame-rate counter, the controls, the log, quit.
// A modal dialog: while it is open the game gets no keys (web/src/input ignores events then).
import type { Shell } from './main';

export interface MenuActions {
  fullscreen(): void; counter(): void; controls(): void; log(): void; downloadLog(): void; quit(): void;
  /** what the menu shows beside its items: is the game in full screen, the counter's mode */
  state(): { fullscreen: boolean; counter: string };
}
export interface PageMenu { open(): void; close(): void; readonly isOpen: boolean }

export function pageMenu(dialog: HTMLDialogElement, shell: Shell, actions: MenuActions): PageMenu {
  const items: [string, () => string, () => void, boolean][] = [
    // label, the note at its right, what it does, whether the menu stays open
    ['Resume', () => 'Home', () => {}, false],
    ['Full screen', () => (actions.state().fullscreen ? 'on' : 'off'), actions.fullscreen, true],
    ['Frame-rate counter', () => actions.state().counter, actions.counter, true],
    ['Controls', () => '', actions.controls, false],
    ['Show log', () => '', actions.log, false],
    ['Download log', () => '', actions.downloadLog, true],
    ['Quit game', () => '', actions.quit, false],
  ];
  const draw = () => {
    dialog.innerHTML = '<h2>menu</h2>';
    for (const [label, note, run, stay] of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'item'; b.dataset.item = label;
      b.append(label, Object.assign(document.createElement('span'), { textContent: note() }));
      b.onclick = () => { if (!stay) menu.close(); run(); if (stay && dialog.open) setTimeout(redraw, 150); };
      dialog.append(b);
    }
  };
  const redraw = () => {
    if (!dialog.open) return;
    const at = (document.activeElement as HTMLElement | null)?.dataset?.item;
    draw();
    (dialog.querySelector<HTMLElement>(`[data-item="${at}"]`) ?? dialog.querySelector<HTMLElement>('.item'))?.focus();
  };
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...dialog.querySelectorAll<HTMLElement>('.item')], i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    e.preventDefault();
  });
  const menu: PageMenu = {
    get isOpen() { return dialog.open; },
    open() { if (dialog.open || !shell.running) return; draw(); dialog.showModal(); dialog.querySelector<HTMLElement>('.item')?.focus(); },
    close() { if (dialog.open) dialog.close(); },
  };
  return menu;
}
