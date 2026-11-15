// The Game tab: the settings (built from settings.ts KEYS: a row a key), the game data this browser keeps,
// and settings.ini itself.  A change is saved at once and applies at the next Play.
import type { Shell } from './main';
import { KEYS, TEMPLATE, get, parse, put, type KeyDef } from './settings';
import { cacheBytes, clearCache } from './savefs';
import { AUTOSCALE_KEY } from './autoscale';
import { ask } from './dialogs';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const mb = (bytes: number) => (bytes < 1 << 20 ? (bytes ? '< 1' : '0') : String(Math.round(bytes / (1 << 20))));

export function gamePanel(root: HTMLElement, shell: Shell): { refresh(): Promise<void> } {
  let text: string | null = null, turn = 0, cache = { bytes: 0, files: 0 };
  const readOnly = () => !shell.owner;

  async function set(k: KeyDef, value: string | null) {
    if (readOnly()) return;
    if (k.key === 'resolution_scale') try { localStorage.removeItem(AUTOSCALE_KEY); } catch { /* storage off */ }   // Auto starts again from what fits
    text = put(text ?? TEMPLATE, k.key, value);   // from what the panel shows: a second change does not wait for the first's file
    render();                                      // at once; the file follows
    try { await shell.saveSettings(text); }        // tells every panel, this one too
    catch (e) { shell.report('The setting could not be saved', e); void refresh(); }
  }

  function row(k: KeyDef): HTMLElement {
    const v = get(text, k.key), off = readOnly();
    let ctl: HTMLElement;
    if (k.kind === 'bool') {
      const b = ctl = el('button', { type: 'button', className: 'switch', disabled: off });
      b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(v === '1')); b.setAttribute('aria-label', k.label);
      b.onclick = () => void set(k, v === '1' ? '0' : '1');
    } else {
      ctl = el('span', { className: 'seg' }, ...(k.values ?? []).map(val => {
        const b = el('button', { type: 'button', textContent: k.names?.[val] ?? val, disabled: off });
        b.setAttribute('aria-pressed', String(val === v));
        b.onclick = () => void set(k, val);
        return b;
      }));
      ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', k.label);
    }
    const box = el('span', { className: 'ctl' });
    if (v !== k.def && !off) {
      const r = el('button', { type: 'button', className: 'btn small', textContent: 'Reset', title: `Back to ${k.names?.[k.def] ?? k.def}` });
      r.onclick = () => void set(k, null);
      box.append(r);
    }
    box.append(ctl);
    const e = el('div', { className: 'row' }, el('div', { className: 'what' }, el('b', { textContent: k.label }), el('small', { textContent: k.help })), box);
    e.dataset.key = k.key;
    return e;
  }

  function group(name: 'display' | 'game'): Node[] {
    const keys = KEYS.filter(k => k.group === name);
    if (!keys.length) return [];
    const out: Node[] = [el('h3', { textContent: name }), ...keys.filter(k => !k.more).map(row)];
    const more = keys.filter(k => k.more);
    if (more.length) {
      const changed = more.filter(k => get(text, k.key) !== k.def).length;
      const d = el('details', { className: 'more' }, el('summary', { textContent: `More ${name} settings${changed ? ` (${changed} changed)` : ''}` }), ...more.map(row));
      d.dataset.group = name;
      d.open = !!changed || localStorage.getItem(`porsche.more.${name}`) === '1';
      d.ontoggle = () => { try { localStorage.setItem(`porsche.more.${name}`, d.open ? '1' : '0'); } catch { /* storage off */ } };
      out.push(d);
    }
    return out;
  }

  function editFile() {
    const d = el('dialog', { className: 'wide' });
    const area = el('textarea', { rows: 16, spellcheck: false, value: text ?? TEMPLATE });
    const notes = el('ul', {});
    const check = () => {
      const bad = parse(area.value).filter(l => l.problem);
      notes.replaceChildren(...bad.slice(0, 12).map(l => el('li', { textContent: `Line ${l.n} is ignored: ${l.problem}` })),
        ...(bad.length > 12 ? [el('li', { textContent: `... and ${bad.length - 12} more lines` })] : []));
    };
    area.oninput = check;
    const save = el('button', { type: 'button', className: 'btn red', textContent: 'Save' });
    const cancel = el('button', { type: 'button', className: 'btn', textContent: 'Cancel' });
    save.onclick = async () => {
      try { if (!readOnly()) await shell.saveSettings(area.value); d.close(); }
      catch (e) { shell.report('settings.ini could not be saved', e); }
    };
    cancel.onclick = () => d.close();
    d.append(el('h2', { textContent: 'settings.ini' }), el('p', { className: 'note', textContent: 'One "key = value" a line. Applies at the next Play.' }),
      area, notes, el('div', { className: 'actions' }, save, cancel));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    check();
    d.showModal();
  }

  async function refresh() {
    const mine = ++turn;
    const [t, c] = [await shell.settingsText(), await cacheBytes()];
    if (mine !== turn) return;
    text = t; cache = c;
    render();
  }

  function render() {
    const off = readOnly(), busy = !!shell.running;
    const del = el('button', { type: 'button', className: 'btn', textContent: 'Delete game data', disabled: off || busy || !cache.bytes });
    del.onclick = async () => {
      if (shell.running || readOnly()) return;
      if (!await ask('delete game data', ['The game data kept in this browser is deleted. Your saves stay; the game loads the data from the server again when it needs it.'], 'Delete')) return;
      try { await shell.during('Deleting the game data.', clearCache); }
      catch (e) { shell.report('The game data could not be deleted', e); }
      void refresh();
    };
    const reset = el('button', { type: 'button', className: 'btn', textContent: 'Reset all settings', disabled: off });
    reset.onclick = async () => {
      if (!await ask('reset all settings', ['Every setting on this page goes back to its default.'], 'Reset') || readOnly()) return;
      try { await shell.saveSettings(TEMPLATE); } catch (e) { shell.report('The settings could not be reset', e); }
    };
    const edit = el('button', { type: 'button', className: 'btn', textContent: 'Edit settings.ini as text', disabled: off });
    edit.onclick = editFile;
    const bad = text ? parse(text).filter(l => l.problem).length : 0;
    root.replaceChildren(
      ...(off ? [el('p', { className: 'note', textContent: 'Read only: the game runs in another tab.' })] : []),
      ...group('display'), ...group('game'),
      el('h3', { textContent: 'game data on this device' }),
      el('div', { className: 'row' },
        el('div', { className: 'what' }, el('b', { id: 'cache-size', textContent: `${mb(cache.bytes)} MB of game data is in this browser.` }),
          el('small', { textContent: busy ? 'Quit the game to delete it.' : 'The game keeps what it loads from the server, so later starts are quick.' })),
        el('span', { className: 'ctl' }, del)),
      el('div', { className: 'actions' }, reset, edit),
      ...(bad ? [el('p', { className: 'note warn', textContent: `settings.ini has ${bad} line${bad === 1 ? '' : 's'} the page ignores: "Edit settings.ini as text" shows them.` })] : []),
      el('p', { className: 'note', textContent: 'Changes apply the next time you press Play.' }));
  }

  shell.onChange(() => void refresh());
  void refresh();
  return { refresh };
}
