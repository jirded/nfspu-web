// The controls sheet: the game's keys, the controller note and the page's keys, under three small tabs.
// Shown in the Controls tab and, while playing, in a dialog from the page menu.
import { ADVANCED_KEYS, FIXED_KEYS, GAME_KEYS, SITE_KEYS, type KeyRow } from './keys';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const table = (rows: readonly KeyRow[]) => el('table', { className: 'keys' }, el('tbody', {},
  ...rows.map(r => el('tr', {}, el('td', {}, ...r.keys.map(k => el('kbd', { textContent: k }))), el('td', { textContent: r.what })))));

let sheets = 0;

export function controlsSheet(root: HTMLElement): void {
  const id = `ctl${++sheets}`;
  const panes: [name: string, content: Node[]][] = [
    ['keyboard', [
      el('h3', { textContent: 'game controls' }), table(GAME_KEYS),
      el('h3', { textContent: 'advanced controls' }), table(ADVANCED_KEYS),
      el('p', { className: 'note', textContent: 'In menus: the mouse. Change these keys in the game\'s Options, Controllers.' }),
      el('h3', { textContent: 'predefined keys' }), table(FIXED_KEYS),
    ]],
    ['controller', [el('p', { textContent: 'Controllers and wheels are not supported yet.' })]],
    ['site', [table(SITE_KEYS), el('p', { className: 'note', textContent: 'The page\'s own keys while you play. The game uses F1 to F12 itself.' })]],
  ];
  const tabs = el('div', { className: 'tabs sub' });
  tabs.setAttribute('role', 'tablist');
  const bodies = panes.map(([name, content]) => {
    const b = el('div', { id: `${id}-${name}` }, ...content);
    b.setAttribute('role', 'tabpanel');
    b.dataset.pane = name;
    return b;
  });
  const buttons = panes.map(([name], i) => {
    const t = el('button', { type: 'button', className: 'tab', textContent: name });
    t.setAttribute('role', 'tab'); t.setAttribute('aria-controls', `${id}-${name}`);
    t.onclick = () => pick(i);
    t.onkeydown = e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); pick((i + d + panes.length) % panes.length, true); }
    };
    return t;
  });
  function pick(i: number, focus = false) {
    buttons.forEach((b, j) => { b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
    bodies.forEach((b, j) => { b.hidden = i !== j; });
    if (focus) buttons[i].focus();
  }
  tabs.append(...buttons);
  root.replaceChildren(tabs, ...bodies);
  pick(0);
}
