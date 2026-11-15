// The Saves tab: the screenshots (Insert while playing), the players, backup and restore.
//
// The players are the game's: files in SaveData/ of the save folder (profiles.ts).  The game also reads
// the SaveData of the game folder the server serves, so a player kept there shows in the game too; the
// tab lists those as "from the game folder" (the page cannot change that folder).
// Nothing is deleted or replaced without a question, and never while a game runs or in a tab that does
// not own the saves.  What changes the save folder runs through shell.during, so Play waits for it; what
// fails is told (shell.report).
import type { Shell } from './main';
import { profilesOf, isShot, type Profile } from './profiles';
import { exportSaves, readBackup, restoreSaves, BackupError } from './backup';
import { downloadBlob } from './logs';
import { ask, tell, list } from './dialogs';

/** a file larger than this is not read as a backup (a backup is the saves and some screenshots) */
const MAX_BACKUP = 512 << 20;

const when = (ms: number) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

export function savesPanel(root: HTMLElement, shell: Shell): { refresh(): Promise<void> } {
  root.innerHTML = `
    <div class="spread"><h3>screenshots</h3><span class="note">Screenshot with <kbd>Insert</kbd></span></div>
    <div id="shots-box"></div>
    <div class="spread"><h3>profiles</h3>
      <span class="ctl"><button class="btn" id="backup" type="button">Download backup</button>
      <button class="btn" id="restore" type="button">Restore</button></span></div>
    <input id="restore-file" type="file" accept=".zip,application/zip" hidden>
    <p class="note" id="saves-lock" hidden></p>
    <div id="profiles-box"></div>`;
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const shotsBox = q('shots-box'), profilesBox = q('profiles-box'), lock = q('saves-lock');
  const restoreBtn = q<HTMLButtonElement>('restore'), file = q<HTMLInputElement>('restore-file');
  let urls: string[] = [], turn = 0;
  const locked = () => (shell.running ? 'Quit the game to change the saves.' : !shell.owner ? 'The game is open in another tab.' : '');
  /** a handler whose failure is told, not lost */
  const told = (what: string, fn: () => Promise<unknown>) => () => { fn().catch(e => shell.report(what, e)); };

  function showShot(path: string, url: string) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const d = el('dialog', { className: 'wide' });
    const img = el('img', { id: 'shot-large', src: url, alt: 'Screenshot' });
    const del = el('button', { type: 'button', className: 'btn', textContent: 'Delete', disabled: !shell.owner });
    const down = el('button', { type: 'button', className: 'btn', textContent: 'Download' });
    const close = el('button', { type: 'button', className: 'btn', textContent: 'Close' });
    down.onclick = told('The screenshot could not be read', async () => downloadBlob(await shell.fs.read(path), name, 'image/png'));
    del.onclick = told('The screenshot could not be deleted', async () => {
      if (!shell.owner || !await ask('delete screenshot', [`Delete ${name}?`], 'Delete')) return;
      await shell.fs.remove(path);
      d.close();
      shell.changed();
    });
    close.onclick = () => d.close();
    d.append(img, el('div', { className: 'actions' }, down, del, close));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  async function removeProfile(p: Profile) {
    if (locked()) return;
    if (!await ask('delete profile', [`Delete the profile ${p.name}? This cannot be undone.`], 'Delete')) return;
    if (locked()) return;   // a game may have started in the meantime
    await shell.during('Deleting a profile.', async () => { for (const f of p.files) await shell.fs.remove(f); });
    shell.changed();
  }

  q('backup').onclick = told('The backup could not be made', async () => {
    const b = await exportSaves(shell.fs);
    if (!b.files) return tell('backup', ['There is nothing saved in this browser yet.']);
    downloadBlob(b.zip, b.name, 'application/zip');
  });
  restoreBtn.onclick = () => { if (!locked()) { file.value = ''; file.click(); } };
  file.onchange = told('The restore failed', async () => {
    const f = file.files?.[0];
    if (!f || locked()) return;
    if (f.size > MAX_BACKUP) return tell('restore', ['This file is too large to be a backup of saves.', 'Nothing was changed.']);
    let r;
    try { r = await readBackup(new Uint8Array(await f.arrayBuffer())); }
    catch (e) {
      if (e instanceof BackupError) return tell('restore', [e.message, 'Nothing was changed.']);
      throw e;
    }
    const has = [`Profiles: ${r.profiles.join(', ')}`, r.settings ? 'Settings (settings.ini)' : 'No settings', `${r.shots} screenshot${r.shots === 1 ? '' : 's'}`];
    const parts = [`${f.name} holds:`, list(has)];
    if (r.refused.length) parts.push(`Left out (not saves): ${r.refused.slice(0, 5).join(', ')}${r.refused.length > 5 ? ' ...' : ''}`);
    parts.push('This replaces the profiles, settings and screenshots in this browser.');
    if (!await ask('restore', parts, 'Restore') || locked()) return;
    let failed: unknown = null;
    await shell.during('Restoring a backup.', async () => {
      try { await restoreSaves(shell.fs, r); } catch (e) { failed = e; }
    });
    await shell.settingsText();
    shell.changed();
    if (failed) await tell('restore', [`The restore did not finish: ${(failed as Error)?.message ?? failed}`,
      'No save was removed, but some may already be the backup\'s. Free some disk space and restore again.']);
  });

  async function refresh() {
    const mine = ++turn;
    let entries;
    try { entries = await shell.fs.list(); }
    catch (e) {
      if (mine === turn) profilesBox.replaceChildren(el('p', { className: 'note problem', textContent: `The saves could not be read: ${(e as Error)?.message ?? e}` }));
      return;
    }
    if (mine !== turn) return;   // a newer refresh is on its way
    const why = locked();
    lock.hidden = !why; lock.textContent = why;
    restoreBtn.disabled = !!why;

    // screenshots, newest first
    const shots = entries.filter(e => isShot(e.path)).sort((a, b) => b.mtime - a.mtime);
    const made: [string, string][] = [];
    try {
      for (const s of shots) made.push([s.path, URL.createObjectURL(new Blob([await shell.fs.read(s.path)], { type: 'image/png' }))]);
    } catch { /* one went away meanwhile: the next refresh shows what is there */ }
    if (mine !== turn) { for (const [, u] of made) URL.revokeObjectURL(u); return; }
    for (const u of urls) URL.revokeObjectURL(u);
    urls = made.map(m => m[1]);
    shotsBox.replaceChildren(made.length
      ? el('div', { className: 'shots' }, ...made.map(([path, url]) => {
          const b = el('button', { type: 'button', title: path.slice(path.lastIndexOf('/') + 1) }, el('img', { src: url, alt: 'Screenshot', loading: 'lazy' }));
          b.onclick = () => showShot(path, url);
          return b;
        }))
      : el('p', { className: 'note', textContent: 'None yet.' }));

    // the players: this browser's, then the game folder's own
    const here = profilesOf(entries), names = new Set(here.map(p => p.name.toLowerCase()));
    const theirs = profilesOf(shell.dataFiles).filter(p => !names.has(p.name.toLowerCase()));
    const rows = [
      ...here.map(p => {
        const del = el('button', { type: 'button', className: 'btn small', textContent: 'Delete', disabled: !!why, title: `Delete ${p.name}` });
        del.onclick = told('The profile could not be deleted', () => removeProfile(p));
        return el('li', { }, el('b', { textContent: p.name }), el('span', { className: 'when', textContent: when(p.mtime) }), del);
      }),
      ...theirs.map(p => el('li', { }, el('b', { textContent: p.name }), el('span', { className: 'when', textContent: 'from the game folder' }))),
    ];
    profilesBox.replaceChildren(rows.length ? el('ul', { className: 'list' }, ...rows)
      : el('p', { className: 'note', textContent: 'No profiles yet: create a player in the game.' }));
  }

  shell.onChange(() => void refresh());
  void refresh();
  return { refresh };
}
