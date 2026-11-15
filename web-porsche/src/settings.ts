// settings.ini: the page's settings, a text file in the save folder (so a backup carries it), read at
// every Play.  The format is nfsu2-web's: one "key = value" a line, # starts a comment line, keys in any
// case, a switch is 0 or 1.  Pure: no DOM, no storage (test/settings.test.mjs).
//
// A key's target says who gets its value: the page itself (full screen, the renderer's scale ...), the
// game's environment (a variable of the runtime) or the game's registry (a value the game reads).

export type Kind = 'bool' | 'enum';
export type Target = 'page' | 'env' | 'registry';
export interface KeyDef {
  key: string; kind: Kind; values?: readonly string[]; def: string;
  target: Target; name?: string;                 // the environment variable or registry value, for those targets
  group: 'display' | 'game'; label: string; help: string; more?: boolean;
  /** what the page shows for a value (default: the value itself) */
  names?: Readonly<Record<string, string>>;
  /** for target env: value -> the variable's value, or null for "not set" */
  toEnv?: (v: string) => string | null;
}

export const KEYS: readonly KeyDef[] = [
  { key: 'fullscreen_on_play', kind: 'bool', def: '0', target: 'page', group: 'display', label: 'Full screen on Play',
    help: 'Off: play in the window; the menu (Home) has full screen. Hold Esc to leave it.' },
  { key: 'resolution_scale', kind: 'enum', values: ['auto', '1', '2', '3', '4'], def: 'auto', target: 'page', group: 'display',
    label: 'Resolution scale', names: { auto: 'Auto', 1: '1x', 2: '2x', 3: '3x', 4: '4x' },
    help: "How many times the game's own resolution the picture is drawn at. Auto: as fits the window, up to 4x, and smaller when the graphics card cannot keep up." },
  { key: 'fps_counter', kind: 'enum', values: ['off', 'on', 'detailed'], def: 'off', target: 'page', group: 'display',
    label: 'Frame-rate counter', names: { off: 'Off', on: 'On', detailed: 'Detailed' }, help: 'End switches it while you play.' },
  { key: 'output_latency', kind: 'enum', values: ['lowest', 'balanced', 'robust'], def: 'lowest', target: 'page', group: 'game',
    label: 'Sound output latency', names: { lowest: 'Lowest', balanced: 'Balanced', robust: 'Robust' }, more: true,
    help: 'Lowest reacts fastest; Robust survives a busy PC best.' },
];
const BY_KEY = new Map(KEYS.map(k => [k.key, k]));
export function keyDef(key: string): KeyDef | undefined { return BY_KEY.get(key.trim().toLowerCase()); }

const valuesOf = (k: KeyDef) => (k.kind === 'bool' ? ['0', '1'] : k.values ?? []);
/** the value as the key takes it, or null */
function valid(k: KeyDef, v: string): string | null {
  const s = v.trim().toLowerCase();
  return valuesOf(k).includes(s) ? s : null;
}

export interface Line { n: number; raw: string; key?: string; value?: string; problem?: string }

const lines = (text: string) => text.replace(/^﻿/, '').split(/\r?\n/);

/** every line of the file; a line the page will not use has a problem saying why */
export function parse(text: string): Line[] {
  const ls = lines(text);
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  return ls.map((raw, i) => {
    const n = i + 1, t = raw.trim();
    if (!t || t.startsWith('#')) return { n, raw };
    const eq = t.indexOf('=');
    if (eq < 0) return { n, raw, problem: 'no "=" on this line' };
    const key = t.slice(0, eq).trim().toLowerCase(), value = t.slice(eq + 1).trim();
    const k = BY_KEY.get(key);
    if (!k) return { n, raw, key, value, problem: 'not a setting of this page' };
    if (valid(k, value) === null) return { n, raw, key, value, problem: `"${value.slice(0, 40)}" is not one of: ${valuesOf(k).join(', ')}` };
    return { n, raw, key, value: valid(k, value)! };
  });
}

/** the key's value in the file (its last good line), or its default */
export function get(text: string | null, key: string): string {
  const k = keyDef(key);
  if (!k) return '';
  let v = k.def;
  if (text) for (const l of parse(text)) if (l.key === k.key && !l.problem) v = l.value!;
  return v;
}

/** the file with the key set (value null: its line removed, which is the default); other lines stay as they are */
export function put(text: string | null, key: string, value: string | null): string {
  const k = key.trim().toLowerCase(), src = text ?? '';
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const ls = lines(src);
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  const isKey = (raw: string) => {
    const t = raw.trim(), eq = t.indexOf('=');
    return !t.startsWith('#') && eq > 0 && t.slice(0, eq).trim().toLowerCase() === k;
  };
  const out: string[] = [];
  let done = value === null;
  for (const raw of ls) {
    if (!isKey(raw)) { out.push(raw); continue; }
    if (!done) { out.push(`${k} = ${value}`); done = true; }
  }
  if (!done) out.push(`${k} = ${value}`);
  return out.length ? out.join(eol) + eol : '';
}

export interface Resolved { page: Record<string, string>; env: Record<string, string>; registry: Record<string, string>; notes: string[] }

/** what a Play uses: the page's own options, the game's environment (the address's ?env= over the file's) and
 *  the registry values to set; notes says which lines were ignored */
export function resolve(text: string | null, urlEnv: Record<string, string>): Resolved {
  const vals = new Map<string, string>(KEYS.map(k => [k.key, k.def]));
  const notes: string[] = [];
  if (text) for (const l of parse(text)) {
    if (l.problem) notes.push(`line ${l.n}: ${l.problem}: ${l.raw.trim().slice(0, 60)}`);
    else if (l.key) vals.set(l.key, l.value!);
  }
  const r: Resolved = { page: {}, env: {}, registry: {}, notes };
  for (const k of KEYS) {
    const v = vals.get(k.key)!;
    if (k.target === 'page') r.page[k.key] = v;
    else if (k.target === 'env') { const e = k.toEnv ? k.toEnv(v) : v; if (e !== null && k.name) r.env[k.name] = e; }
    else if (k.name) r.registry[k.name] = v;
  }
  Object.assign(r.env, urlEnv);
  return r;
}

/** the file as the page first writes it: every setting at its default, with what it does */
export const TEMPLATE = [
  '# Porsche Unleashed in the browser: settings, read at every Play.',
  '# One "key = value" a line. A line starting with # is a comment.',
  '',
  ...KEYS.flatMap(k => [`# ${k.label}. ${k.help} (${valuesOf(k).join(', ')})`, `${k.key} = ${k.def}`, '']),
].join('\n');
