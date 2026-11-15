// Small modal dialogs made on the spot: a question and a message.
export type Part = string | Node;

function dialog(title: string, parts: Part[], buttons: [label: string, value: boolean, red?: boolean][]): Promise<boolean> {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.append(Object.assign(document.createElement('h2'), { textContent: title }));
    for (const p of parts) d.append(typeof p === 'string' ? Object.assign(document.createElement('p'), { textContent: p }) : p);
    const row = Object.assign(document.createElement('div'), { className: 'actions' });
    let answer = false;
    for (const [label, value, red] of buttons) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: red ? 'btn red' : 'btn', textContent: label });
      b.onclick = () => { answer = value; d.close(); };
      row.append(b);
    }
    d.append(row);
    d.addEventListener('close', () => { d.remove(); resolve(answer); });
    document.body.append(d);
    d.showModal();
    (row.lastElementChild as HTMLElement).focus();   // the harmless one: Enter does not delete anything
  });
}

/** a question; true when the player chose `yes` (Esc and Cancel are no) */
export const ask = (title: string, parts: Part[], yes: string) => dialog(title, parts, [[yes, true, true], ['Cancel', false]]);
/** something to read */
export const tell = (title: string, parts: Part[]) => dialog(title, parts, [['OK', true]]).then(() => {});

/** a bulleted list for a dialog */
export function list(items: string[]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const i of items) ul.append(Object.assign(document.createElement('li'), { textContent: i }));
  return ul;
}
