# Start page for Porsche Unleashed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the development harness page with a start page (Play, Saves, Game, Controls) in the game's own
"garage" look, and bring the README in line with it.

**Architecture:** The page is plain TypeScript bundled by esbuild, no framework. Pure modules (settings file, zip,
profiles, backup) are unit-tested under `node --test`; everything that touches the DOM, OPFS or the game is checked
in Chrome on an origin of its own. `game.ts` owns one run of the game (process, ticker, sound, input, renderer);
`main.ts` is the shell that moves between the start page and the game; one `ui-*.ts` file per panel.

**Tech Stack:** TypeScript, esbuild (from `web/node_modules`), Node 22 `node --test`, OPFS, Web Locks, WebGPU,
the shared host in `web/src/{host,audio,input}`.

**Spec:** `porsche-dev/specs/2026-11-15-start-page-design.md` (read it first; this plan argues from it).

## Global Constraints

- Chrome with WebGPU on a PC. English page text. Everything drawn with CSS.
- No art of EA's anywhere in the repository or on the page: no game textures, logos or game screenshots, in page
  assets, tests or the README.
- No new npm dependencies.
- Sources of truth: `porsche-dev/web-porsche/` (edit there). `porsche-dev/webpage.sh` copies them into
  `web-porsche/` and builds `web-porsche/dist`. Reused files come from
  `/mnt/c/Development/NFSPU/nfsu2-web/web/src/app/` (MIT); keep each file's header comment and add one line saying
  where it came from.
- Shell: every command runs in WSL, as
  `wsl -d Ubuntu-24.04 -- bash -lc "bash /mnt/c/Development/NFSPU/porsche-web/porsche-dev/<script>.sh"`. Scripts go
  in files, never inline (Git Bash mangles `$` and quotes).
- Browser checks run only at **`http://127.0.0.1:8081/`**, from a server of their own
  (`porsche-dev/testserver.sh`, Task 1). Never open, reload or test `http://localhost:8080/`: that origin holds the
  user's saves and they may be playing. Never stop or restart the server on port 8080.
- Browser checks use controlled input (JS `PointerEvent`/`KeyboardEvent` on `#screen` in 640x480 game coordinates,
  see "Browser automation notes" in `porsche-dev/NOTES.md`) and the page log as evidence
  (`out/web-porsche-browser.log`, `porsche-dev/blog.sh`).
- Must keep working: URL options `?env=NAME=value`, `?wasm=`, `?trace=`, `?scale=`; the log POST to `/log`; the
  canvas id `#screen`, focusable, taking input in game coordinates.
- A setting is on the page only if a check in this plan showed it does something. No dead controls.
- **No commits and no pushes.** Each task ends with a checkpoint instead; the user commits when they ask to.

## Review Focus

1. **A zip that is not ours in Restore** (any zip, entries `../x`, `/abs`, `C:\x`, a 2 GB entry): nothing is written
   or removed; the page says the file is not a backup. → Task 2, `backup.test.mjs`.
2. **A restore or a delete that fails halfway** (quota, a file locked by a running game): the saves that were there
   are still there; the whole backup is checked before anything is removed, and both are refused while a game runs.
   → Task 2 (`restoreSaves` order), Task 6 (buttons off while running).
3. **A `settings.ini` edited by hand** (CRLF, a BOM, unknown keys, `key` with no `=`, a value out of range, 1 MB of
   text): the page starts, uses the default for what it cannot read, keeps the unknown lines, and says which lines
   it ignored. → Task 1, `settings.test.mjs`.
4. **The game ends on its own** (crash, non-zero exit, a worker error, WebGPU device lost): the start page comes
   back in the "problem" state with the exit code and a log download, and Play works again without a reload.
   → Task 3.
5. **The first tab closes while a second is open:** the second leaves "open elsewhere" by itself, its panels become
   writable and show the save folder as it is now, without a reload. → Task 3 (lock), Task 6 (refresh).

---

## File Structure

All under `porsche-dev/web-porsche/` (copied to `web-porsche/` by `webpage.sh`):

| File | Responsibility |
|---|---|
| `index.html` | the page's skeleton: header, start page (`#start`), game layer (`#stage` with `canvas#screen`), dialogs |
| `style.css` | the garage look and every component's style |
| `build.mjs` | also copies `style.css` into `dist` |
| `src/main.ts` | the shell: boot, checks, state machine start page ↔ game, wiring of the panels |
| `src/game.ts` | one run of the game (moved out of today's `main.ts`) |
| `src/settings.ts` | `settings.ini`: keys, parse, put, resolve. Pure |
| `src/savefs.ts` | OPFS access to the save folder and the data cache (from the clone, trimmed) |
| `src/zip.ts` | zip and unzip (from the clone, unchanged) |
| `src/profiles.ts` | which files make a profile, screenshots' paths. Pure |
| `src/backup.ts` | backup zip out, backup zip in |
| `src/logs.ts` | log ring, download (from the clone) |
| `src/display.ts` | full screen, keyboard lock (from the clone) |
| `src/instance.ts` | the one-tab lock (from the clone, lock name `porsche-saves`) |
| `src/overlay.ts` | the frame-rate counter |
| `src/keys.ts` | the keyboard table and the site keys, as data |
| `src/ui-play.ts`, `ui-saves.ts`, `ui-game.ts`, `ui-controls.ts`, `ui-menu.ts` | one panel each |
| `test/load.mjs`, `test/*.test.mjs` | unit tests |

New scripts in `porsche-dev/`: `pagetest.sh` (copy + unit tests), `testserver.sh` (start/stop the server on 8081).
`webpage.sh` is changed to copy `style.css` and `test/` too.

---

### Task 1: Test harness and the settings file

**Files:**
- Create: `porsche-dev/pagetest.sh`, `porsche-dev/testserver.sh`
- Create: `porsche-dev/web-porsche/test/load.mjs`, `porsche-dev/web-porsche/test/settings.test.mjs`
- Create: `porsche-dev/web-porsche/src/settings.ts`
- Modify: `porsche-dev/webpage.sh` (copy `style.css` if present and `test/`)

**Interfaces:**
- Produces (`test/load.mjs`): `export async function load(tsFile: string): Promise<any>` bundles
  `web-porsche/src/<tsFile>` with esbuild (`format: 'esm'`, `platform: 'neutral'`, `write: false`) and imports the
  result from a `data:` URL. esbuild is `createRequire('<repo>/web/package.json')('esbuild')`, as `build.mjs` does.
- Produces (`pagetest.sh`): copies the sources as `webpage.sh` does (without building the page), then
  `node --test web-porsche/test/`. Exit code is the tests'.
- Produces (`testserver.sh start|stop`): the server on `--host 127.0.0.1 --port 8081` in the background, PID in
  `out/testserver.pid`, output in `out/testserver.log`. `start` when already running does nothing.
- Produces (`settings.ts`):

```ts
export type Kind = 'bool' | 'enum';
export type Target = 'page' | 'env' | 'registry';
export interface KeyDef {
  key: string; kind: Kind; values?: readonly string[]; def: string;
  target: Target; name?: string;                 // env variable or registry value name, for those targets
  group: 'display' | 'game'; label: string; help: string; more?: boolean;
  /** for target env: value -> the variable's value, or null for "not set" */
  toEnv?: (v: string) => string | null;
}
export const KEYS: readonly KeyDef[];
export interface Line { n: number; raw: string; key?: string; value?: string; problem?: string }
export function parse(text: string): Line[];
export function get(text: string | null, key: string): string;             // the value, or the key's default
export function put(text: string | null, key: string, value: string | null): string;   // null removes the line
export interface Resolved { page: Record<string, string>; env: Record<string, string>; registry: Record<string, string>; notes: string[] }
export function resolve(text: string | null, urlEnv: Record<string, string>): Resolved;
export const TEMPLATE: string;   // the commented file written on first use
```

  File format, as nfsu2's: one `key = value` a line, `#` starts a comment, keys case-insensitive, bool is `0`/`1`.
  `KEYS` in this task (the four that are the page's own and certain):

  | key | kind | values | def | target |
  |---|---|---|---|---|
  | `fullscreen_on_play` | bool | | `0` | page |
  | `resolution_scale` | enum | `auto,1,2,3,4` | `auto` | page |
  | `fps_counter` | enum | `off,on,detailed` | `off` | page |
  | `output_latency` | enum | `lowest,balanced,robust` | `balanced` | page |

  `resolve`: `page` has every page key with its value or default; `env` is the env-target keys' variables, then
  `urlEnv` over them (`?env=` wins); `notes` has one line for each ignored line of the file.

- [ ] **Step 1: Write `test/load.mjs` and the failing tests** in `test/settings.test.mjs`:

```js
test('defaults', () => { assert.equal(S.get(null, 'resolution_scale'), 'auto'); assert.equal(S.get('', 'fps_counter'), 'off'); });
test('put then get, comments and other lines kept', () => {
  const t = S.put('# mine\nfoo = 1\n', 'fps_counter', 'on');
  assert.equal(S.get(t, 'fps_counter'), 'on'); assert.match(t, /# mine/); assert.match(t, /foo = 1/);
  assert.equal(S.get(S.put(t, 'fps_counter', null), 'fps_counter'), 'off');
});
test('put replaces, never duplicates', () => {
  const t = S.put(S.put(null, 'resolution_scale', '2'), 'Resolution_Scale', '3');
  assert.equal(t.match(/resolution_scale/gi).length, 1); assert.equal(S.get(t, 'resolution_scale'), '3');
});
test('a hand-edited file', () => {   // Review Focus 3
  const text = '\uFEFFfullscreen_on_play = 1\r\nresolution_scale = 9\r\nnonsense\r\nunknown_key = x\r\n';
  const r = S.resolve(text, {});
  assert.equal(r.page.fullscreen_on_play, '1');
  assert.equal(r.page.resolution_scale, 'auto');            // out of range: the default
  assert.equal(r.notes.length, 3);                           // the bad value, the line with no =, the unknown key
  assert.match(S.put(text, 'fps_counter', 'on'), /unknown_key = x/);   // unknown lines survive a change
});
test('a huge file does not hang', () => { S.resolve('x = 1\n'.repeat(200000), {}); });
test('?env= wins over the file', () => {
  assert.deepEqual(S.resolve(null, { PORSCHE_PROF: '1' }).env, { PORSCHE_PROF: '1' });
});
```

- [ ] **Step 2: Run `pagetest.sh`.** Expected: FAIL, `settings.ts` not found.
- [ ] **Step 3: Implement `settings.ts`** to the interface above.
- [ ] **Step 4: Run `pagetest.sh`.** Expected: 6 tests pass.
- [ ] **Step 5: `testserver.sh start`, then check** `curl -sI http://127.0.0.1:8081/` from WSL returns `200` with
  `Cross-Origin-Opener-Policy: same-origin`; `testserver.sh stop` ends it. Port 8080 is untouched (`ss -ltn`).
- [ ] **Step 6: Checkpoint.** `git status --short` lists only this task's files. No commit.

---

### Task 2: The save folder: files, profiles, backup

**Files:**
- Create: `src/savefs.ts`, `src/zip.ts`, `src/profiles.ts`, `src/backup.ts`
- Create: `test/memfs.mjs`, `test/zip.test.mjs`, `test/profiles.test.mjs`, `test/backup.test.mjs`

**Interfaces:**
- Produces (`savefs.ts`; from the clone's `savefs.ts` without `profile.ts`'s covers):

```ts
export const SAVE_DIR = 'porsche-save';
export interface Entry { path: string; size: number; mtime: number }
export interface SaveFs {
  list(): Promise<Entry[]>;                       // every file, paths relative to the save root, '/' separated
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array | string): Promise<void>;   // creates folders
  remove(path: string): Promise<void>;            // a missing file is not an error
}
export function opfsFs(saveDir?: string): SaveFs;
export async function cacheBytes(): Promise<{ bytes: number; files: number }>;   // the game data cached in this browser
export async function clearCache(): Promise<void>;
```

- Produces (`test/memfs.mjs`): `export function memFs(files?: Record<string, Uint8Array | string>): SaveFs & { files: Map<string, Uint8Array>; failAfter?: number }`
  (`failAfter = n`: the n-th `write` from now throws, for Review Focus 2).
- Produces (`zip.ts`): the clone's file as is: `zip(entries: ZipEntry[]): Uint8Array`,
  `unzip(buf, accept?, refused?): Promise<ZipEntry[]>`, `listZip(buf)`, `class ZipError`,
  `interface ZipEntry { name: string; data: Uint8Array; mtime?: number }`.
- Produces (`profiles.ts`):

```ts
export interface Profile { name: string; files: string[]; size: number; mtime: number }
export function profilesOf(entries: Entry[]): Profile[];            // newest first
export const SHOTS_DIR = 'shots';
export function isShot(path: string): boolean;                      // shots/*.png
export function shotName(d: Date): string;                          // shots/porsche-YYYYMMDD-HHMMSS.png
```

  The rule, from the install's own `SaveData/` (player OGD: `4OGD.sav`, `OGD1.hud`, `OGD2.hud`; the game's defaults
  `XXDefXX.sav`, `XXhud1XX.hud`, `XXhud2XX.hud`; shared `nfs5.trk`, `pic16.fsh`): a profile is a file
  `SaveData/<digit><NAME>.sav`; its files are that one and `SaveData/<NAME>1.hud`, `SaveData/<NAME>2.hud` where they
  exist. Names compare case-insensitively. Task 6 checks this rule against a profile the game makes; if the game
  does otherwise, the rule and its test change there.

- Produces (`backup.ts`):

```ts
export class BackupError extends Error {}
export function safeEntryPath(name: string): string | null;        // null: not a path below the save root
export async function exportSaves(fs: SaveFs, now?: Date): Promise<{ zip: Uint8Array; name: string; files: number }>;
   // name: porsche-saves-YYYYMMDD-HHMMSS.zip; every file of the save folder
export interface Restore { entries: ZipEntry[]; profiles: string[]; settings: boolean; shots: number; refused: string[] }
export async function readBackup(buf: Uint8Array): Promise<Restore>;   // throws BackupError when it is not a backup
export async function restoreSaves(fs: SaveFs, r: Restore): Promise<void>;
```

  A zip is a backup when it has at least one `SaveData/*.sav`. `readBackup` refuses entries whose path is not safe
  (lists them in `refused`) and any entry over 64 MB. `restoreSaves` writes the backup's files first, and only when
  every write succeeded removes the files that are not in the backup: a failure halfway leaves every old file in
  place.

- [ ] **Step 1: Write the failing tests.**

```js
// zip.test.mjs
test('round trip', async () => { const z = Z.zip([{ name: 'a/b.txt', data: enc('hi') }]); assert.equal(dec((await Z.unzip(z))[0].data), 'hi'); });
test('not a zip', async () => { await assert.rejects(Z.unzip(enc('hello')), Z.ZipError); });

// profiles.test.mjs
const INSTALL = ['SaveData/4OGD.sav', 'SaveData/OGD1.hud', 'SaveData/OGD2.hud', 'SaveData/XXDefXX.sav',
  'SaveData/XXhud1XX.hud', 'SaveData/XXhud2XX.hud', 'SaveData/nfs5.trk', 'SaveData/pic16.fsh', 'settings.ini'];
test('the install has one profile', () => {
  const p = P.profilesOf(INSTALL.map((path, i) => ({ path, size: 10, mtime: i })));
  assert.equal(p.length, 1); assert.equal(p[0].name, 'OGD');
  assert.deepEqual(p[0].files.sort(), ['SaveData/4OGD.sav', 'SaveData/OGD1.hud', 'SaveData/OGD2.hud']);
});
test('no profiles in an empty folder', () => assert.deepEqual(P.profilesOf([]), []));
test('shots', () => { assert.ok(P.isShot('shots/porsche-20261115-101500.png')); assert.ok(!P.isShot('SaveData/x.png'));
  assert.equal(P.shotName(new Date(2026, 10, 15, 10, 15, 0)), 'shots/porsche-20261115-101500.png'); });

// backup.test.mjs
test('unsafe paths', () => { for (const n of ['../x', '/abs', 'C:\\x', 'a/../../b', 'a\\..\\b', '']) assert.equal(B.safeEntryPath(n), null);
  assert.equal(B.safeEntryPath('SaveData/4OGD.sav'), 'SaveData/4OGD.sav'); });
test('export then restore into an empty folder', async () => {
  const a = memFs({ 'SaveData/4TEST.sav': 'S', 'SaveData/TEST1.hud': 'H', 'settings.ini': 'fps_counter = on\n', 'shots/porsche-1.png': 'P' });
  const { zip, files } = await B.exportSaves(a); assert.equal(files, 4);
  const r = await B.readBackup(zip); assert.deepEqual(r.profiles, ['TEST']); assert.equal(r.settings, true); assert.equal(r.shots, 1);
  const b = memFs({ 'SaveData/4OLD.sav': 'x' }); await B.restoreSaves(b, r);
  assert.deepEqual([...b.files.keys()].sort(), [...a.files.keys()].sort());
});
test('a zip that is not a backup', async () => {   // Review Focus 1
  await assert.rejects(B.readBackup(Z.zip([{ name: 'readme.txt', data: enc('x') }])), B.BackupError);
  await assert.rejects(B.readBackup(enc('not a zip')), B.BackupError);
  const r = await B.readBackup(Z.zip([{ name: 'SaveData/4A.sav', data: enc('s') }, { name: '../evil', data: enc('e') }]));
  assert.deepEqual(r.refused, ['../evil']); assert.equal(r.entries.length, 1);
});
test('a restore that fails halfway keeps the old saves', async () => {   // Review Focus 2
  const b = memFs({ 'SaveData/4OLD.sav': 'old' }); b.failAfter = 2;
  const r = await B.readBackup(Z.zip([1, 2, 3].map(i => ({ name: `SaveData/4N${i}.sav`, data: enc('n') }))));
  await assert.rejects(B.restoreSaves(b, r)); assert.ok(b.files.has('SaveData/4OLD.sav'));
});
```

- [ ] **Step 2: Run `pagetest.sh`.** Expected: the new tests fail (modules missing).
- [ ] **Step 3: Copy `zip.ts`; write `savefs.ts`, `profiles.ts`, `backup.ts`** to the interfaces above.
- [ ] **Step 4: Run `pagetest.sh`.** Expected: all pass (Task 1's too).
- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 3: The game runner, the Play card and the one-tab lock

**Files:**
- Create: `src/game.ts`, `src/ui-play.ts`, `src/instance.ts`, `src/logs.ts`, `src/display.ts`
- Rewrite: `src/main.ts`, `index.html` (structure only; Task 4 gives it its look)

**Interfaces:**
- Consumes: `resolve()` (Task 1), `opfsFs()` (Task 2), `startProcess`, `attachAudio`, `attachInput` (`web/src`),
  `attachGlide` (`src/glide-gpu.ts`).
- Produces (`game.ts`):

```ts
export interface GameOptions {
  module: WebAssembly.Module; canvas: HTMLCanvasElement; audio: AudioContext;
  env: Record<string, string>;              // added to HOME, NFSU2_SAVEDIR, NFSU2_READONLY_DATA
  scale?: number; trace?: number[];
  log(s: string): void;
}
export interface RunningGame {
  input: InputHandle; renderer: GlideRenderer | null;   // null: the software renderer build
  exited: Promise<number>;                               // the exit code; -1 when stopped
  /** asks the game to close (InputHandle.requestQuit), waits graceMs, then terminates it */
  quit(graceMs?: number): Promise<'quit' | 'stopped'>;
  fps(): number;                                         // frames presented in the last second
}
export async function startGame(o: GameOptions): Promise<RunningGame>;
```

  It is today's `playBtn.onclick` body (process, ticker worker, audio, input, WebGPU or software picture), moved.
  `quit` default grace: 10 000 ms.
- Produces (`ui-play.ts`):

```ts
export type PlayState = 'loading' | 'ready' | 'starting' | 'running' | 'ended' | 'problem' | 'elsewhere';
export interface PlayCard { set(state: PlayState, detail?: string, code?: string): void; readonly state: PlayState; onPlay(cb: () => void): void }
export function playCard(root: HTMLElement): PlayCard;
```

  Headline per state: loading "loading", ready "ready", starting "starting", ended "game over", problem
  "problem", elsewhere "open elsewhere". Play is enabled only in `ready` and `ended`.
- Produces (`main.ts`, for the other panels): `export interface Shell { readonly owner: boolean; readonly running: RunningGame | null; fs: SaveFs; settingsText(): Promise<string | null>; saveSettings(text: string): Promise<void>; onChange(cb: () => void): void; log: LogRing }`
  `onChange` fires when the game starts or ends, when this tab becomes the owner, and when the save folder changed.
- `index.html` ids: `#start` (the start page), `#play-card`, `#about`, `#tabs`, `#panel-saves`, `#panel-game`,
  `#panel-controls`, `#stage` (holds `canvas#screen`, `tabindex="0"`, 640x480), `#menu` (`<dialog>`), `#log`.
  `body.playing` shows `#stage` over everything and hides `#start`.
- Problems (state `problem`), each with a code shown beside the text and one line on what to do: `NO-WEBGPU`,
  `NO-ISOLATION`, `NO-SHARED-MEMORY`, `NO-OPFS`, `MODULE-LOAD`, `NO-DATA` (`/data-manifest` does not answer:
  the server was started without the game folder), `GAME-EXIT` (with the exit code), `GAME-START`.
- Debug hook for the browser checks: `window.__shell = shell`.
- Lock: `claimInstance('porsche-saves')`; not the owner → state `elsewhere`, Play off; `whenOwner` → `ready` (or
  `loading`) and `onChange`.
- The ended state's detail: "Saved at HH:MM" when the newest mtime under `SaveData/` moved during the run, else
  "Nothing was saved in that game."
- `beforeunload` asks while a game runs. Enter on the start page (no dialog open, focus not in a field) presses
  Play.

- [ ] **Step 1: Move the run into `game.ts`, write `ui-play.ts` and the new `main.ts`/`index.html`;** copy
  `instance.ts`, `logs.ts`, `display.ts` from the clone. Keep `?env`, `?wasm`, `?trace`, `?scale` and the `/log`
  POST exactly as they behave now.
- [ ] **Step 2: Build (`webpage.sh`) and start `testserver.sh`.** Expected: build ends "page built".
- [ ] **Step 3: Browser check, start.** Open `http://127.0.0.1:8081/`. Expected: Play card goes loading → ready;
  `crossOriginIsolated === true`; no error in the console.
- [ ] **Step 4: Browser check, play and quit.** Press Enter. Expected: `body.playing`; the log has
  `first frame from the game` and `WebGPU renderer`. Call the shell's quit (temporary: a "Quit" button in `#stage`,
  replaced in Task 5). Expected: start page back, state `ended`, the log has `EXIT 0` (or the stop note after the
  grace). Press Play again: the game starts again without a reload.
- [ ] **Step 5: Browser check, a game that ends without the shell asking** (Review Focus 4). In one run call
  `__shell.running.input.requestQuit()` from the console (the game closes by itself); in a second run
  `__shell.running.quit(0)` (stopped at once, exit code -1). Expected: the first ends in `ended`; the second in
  `problem` with code `GAME-EXIT` and a "Download log" button; both times the canvas is hidden, Play is enabled,
  and the next Play works.
- [ ] **Step 6: Browser check, two tabs** (Review Focus 5). Open a second tab on the same address. Expected:
  "open elsewhere", Play disabled. Close the first tab. Expected within 2 s: the second shows `ready`, with no
  reload.
- [ ] **Step 7: Browser check, the development options.** `?scale=2` → log line
  `frame buffer 640x480, drawn at 1280x960`; `?env=PORSCHE_PROF=1` → an import profile in the log after 10 s.
- [ ] **Step 8: Checkpoint.** No commit.

---

### Task 4: The garage look

**Files:**
- Create: `style.css`; Modify: `index.html` (classes, the header and About/Credits text), `build.mjs` (copy
  `style.css` to `dist`)

**Interfaces:**
- Consumes: the ids of Task 3.
- Produces: CSS custom properties and classes the panels use. Tokens (from the chosen mockup
  `/mnt/c/Development/NFSPU/.superpowers/brainstorm/1059-1794730756/content/visual-style-v2.html`, class `.va`):

  | token | value |
  |---|---|
  | `--bg-0`, `--bg-1`, `--bg-2` | `#171a17`, `#2b322c`, `#1c211d` (page gradient bottom, middle, top) |
  | `--panel` | `rgba(10,12,10,.62)`; border `rgba(255,255,255,.14)`; square corners |
  | `--text`, `--mute` | `#d9dcd6`, `#aab0a8` |
  | `--red-0`, `--red-1`, `--red-2`, `--red-edge` | `#e0303a`, `#a80f18`, `#7c0a10`, `#e4636a` (the glossy bar, top to bottom) |
  | `--gold`, `--gold-edge` | `#c9a227`, `#4a3d16` |
  | `--line` | `rgba(255,255,255,.22)` (hairlines) |
  | font | `'Segoe UI', 'Trebuchet MS', sans-serif`; headings weight 300, lowercase |

  Components: `.panel`, `.tabs` + `.tab` (`.on` = red bar), `.row` (label, help, control), `.seg` (segmented
  choice, `.on` red), `.switch` (red when on), `.btn` (dark, light border), `.btn-race` (the Play button: gold,
  uppercase, letter-spacing 3px), `.note`, `.problem`, `dialog`.
  Page: max width 1040px, centred; left column 300px; header title "porsche unleashed" with the line
  "Fan project. Not affiliated with or endorsed by Electronic Arts or Porsche."; the cold light strip under the
  header; one horizontal and one vertical hairline and a dark ellipse behind the content.
  About: two short paragraphs (what it is; you bring your own copy). Credits: nfsu2-web by th0mk, NFSU2Recomp by
  Talha Müderrisoğlu, MIT, a link to the repository.
  Tabs switch by click and by arrow keys; the chosen tab is remembered in `localStorage` (`porsche.tab`).

- [ ] **Step 1: Write `style.css` and the markup.**
- [ ] **Step 2: Build; browser check.** Open the page at 1280x800 and at 3440x1215. Expected: the layout of the
  mockup, the content column centred, no horizontal scroll; `getComputedStyle` of the active tab has the red
  gradient and of `.btn-race` the colour `rgb(201, 162, 39)`; tabs switch and survive a reload.
- [ ] **Step 3: Check there is no image.** `grep -rEn "url\(|<img|\.png|\.jpg" porsche-dev/web-porsche/style.css porsche-dev/web-porsche/index.html`
  prints nothing.
- [ ] **Step 4: Checkpoint.** No commit.

---

### Task 5: While playing: the page menu, the counter, full screen, quit, the log

**Files:**
- Create: `src/ui-menu.ts`, `src/overlay.ts`; Modify: `src/main.ts`, `index.html`, `style.css`

**Interfaces:**
- Consumes: `RunningGame` (Task 3), `enterFullscreen`, `exitFullscreen`, `lockKeys`, `isFullscreen`
  (`display.ts`), `LogRing`, `downloadBlob`, `stamp` (`logs.ts`), page settings `fullscreen_on_play`,
  `fps_counter` (Task 1).
- Produces (`overlay.ts`): `export type FpsMode = 'off' | 'on' | 'detailed'; export class FpsOverlay { constructor(el: HTMLElement); set(mode: FpsMode, game: RunningGame | null): void; next(): FpsMode }`
  `on`: frames per second. `detailed`: also draws and vertices of the last frame (`renderer.stats()`).
- Produces (`ui-menu.ts`): `export function pageMenu(dialog: HTMLDialogElement, shell: Shell, actions: { fullscreen(): void; counter(): void; controls(): void; log(): void; downloadLog(): void; quit(): void }): { open(): void; close(): void; readonly isOpen: boolean }`
- Keys, taken by the page before the game sees them: F9 opens/closes the menu, F8 switches the counter
  (off → on → detailed), F12 is Task 6. While the menu is open the game gets no keys. Esc held 1 s in full screen
  leaves it; a shorter Esc goes to the game (`navigator.keyboard.lock(['Escape'])` where Chrome has it).
- Quit game: closes the menu, shows "Closing the game" over the picture, `running.quit()`; a result of `'stopped'`
  puts a note in the ended state ("The game did not answer and was stopped.").
- The menu's Controls item shows Task 8's sheet in a dialog; until then, a line with the site keys.
- `fullscreen_on_play = 1`: Play enters full screen inside the click.

- [ ] **Step 1: Implement.** Remove Task 3's temporary Quit button.
- [ ] **Step 2: Build; browser check.** In a running game: synthetic `F9` keydown on `#screen` → `#menu` open and
  the key log (`?env=NFSU2_KEY_LOG=1`) shows no F9 reaching the game; F8 three times → the overlay shows a number,
  then the detailed lines, then is hidden; menu → Quit game → start page, state `ended`, log `EXIT 0`.
- [ ] **Step 3: Browser check, full screen.** Menu → Full screen → `document.fullscreenElement` is `#stage`;
  again → null. With `fullscreen_on_play = 1` written through the shell, Play → full screen.
- [ ] **Step 4: Browser check, the log.** Menu → Download log produces a blob named
  `porsche-log-YYYYMMDD-HHMMSS.txt` whose text contains `first frame from the game`.
- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 6: The Saves tab and screenshots

**Files:**
- Create: `src/ui-saves.ts`; Modify: `src/glide-gpu.ts`, `src/main.ts`, `index.html`, `style.css`;
  maybe `src/profiles.ts` + its test (if the game's file names differ from the rule)

**Interfaces:**
- Consumes: `Shell`, `SaveFs`, `profilesOf`, `isShot`, `shotName`, `exportSaves`, `readBackup`, `restoreSaves`,
  `BackupError`, `downloadBlob`.
- Produces (`glide-gpu.ts`): `GlideRenderer.shot(): Promise<Blob | null>`: a PNG of the game's picture at the size
  it is drawn (the offscreen target, not the stretched canvas); null when it cannot.
- Produces (`ui-saves.ts`): `export function savesPanel(root: HTMLElement, shell: Shell): { refresh(): Promise<void> }`
- The panel, top to bottom: **screenshots** (thumbnails newest first, "Screenshot with F12"; a click opens one
  large with Download and Delete; "None yet." when empty), **profiles** (name, last saved as a local date and
  time, a delete button; "No profiles yet: create a player in the game."), **Download backup** and **Restore**.
- Delete a profile: a confirm dialog "Delete the profile NAME? This cannot be undone.", then removes the
  profile's files only.
- Restore: a file picker (`.zip`), then a dialog listing the profiles in the backup, whether it has settings, how
  many screenshots, any refused entries, and "This replaces everything saved in this browser."; Restore and
  Cancel. A `BackupError` shows its message and changes nothing.
- While a game runs, or when this tab is not the owner: Delete, Restore are disabled with the line "Quit the game
  to change the saves." / "The game is open in another tab."
- F12 while playing: `renderer.shot()`, written to `shotName(new Date())`; a short "Screenshot saved" note over
  the picture. The software renderer build: the note says screenshots need the WebGPU build.
- `refresh()` runs on `shell.onChange`.

- [ ] **Step 1: Check the profile rule against the game.** At `http://127.0.0.1:8081/`, create a player `TEST` in
  the game with controlled clicks (create player (321,352), first portrait (227,239), type the name, done
  (321,400); NOTES.md), quit through the menu, then list the save folder with `opfsFs().list()` in the page
  console. Expected: `SaveData/<digit>TEST.sav`, `SaveData/TEST1.hud`, `SaveData/TEST2.hud`. If the names differ,
  change `profilesOf`, add a test with the names seen, run `pagetest.sh`.
- [ ] **Step 2: Decide Rename.** Read `SaveData/<digit>TEST.sav` and the two `.hud` files: search for the bytes
  `TEST` (ASCII and UTF-16). Found anywhere → no Rename in this version (write the finding into NOTES.md, Task 9).
  Not found → add Rename (letters and digits, the game's own length limit, refused when the name exists), with a
  browser check that the renamed profile loads in the game.
- [ ] **Step 3: Implement the panel and `shot()`.**
- [ ] **Step 4: Browser check, profiles and backup.** The panel lists `TEST`. Download backup → a zip whose
  listing (`listZip`) has the `TEST` files. Delete `TEST` (confirm) → the panel is empty and the files are gone.
  Restore the zip → the dialog names `TEST`; after Restore the panel lists it and Play → the game offers the
  player TEST.
- [ ] **Step 5: Browser check, a wrong file.** Restore a zip made of one text file → the message, nothing changed.
- [ ] **Step 6: Browser check, screenshots.** With the game at its main menu dispatch F12 → note shown; after
  quitting, the tab shows one thumbnail; the PNG is 640·scale by 480·scale and not one flat colour (read it back
  through a canvas: more than 16 distinct pixel values). Delete removes it.
- [ ] **Step 7: Browser check, locked while playing.** During a game the tab's Delete and Restore are disabled.
- [ ] **Step 8: Checkpoint.** No commit.

---

### Task 7: The Game tab

**Files:**
- Create: `src/ui-game.ts`; Modify: `src/settings.ts` + its test (new keys), `src/main.ts`, `src/game.ts`,
  `index.html`, `style.css`

**Interfaces:**
- Consumes: `KEYS`, `get`, `put`, `parse`, `resolve`, `TEMPLATE`, `Shell`, `cacheBytes`, `clearCache`.
- Produces (`ui-game.ts`): `export function gamePanel(root: HTMLElement, shell: Shell): { refresh(): Promise<void> }`
- The panel is built from `KEYS`: groups "display" and "game", each key a `.row` with its label, help and a
  `.switch` (bool) or `.seg` (enum); keys with `more: true` sit under "More … settings". A changed key shows
  "Reset". Each change: `put`, `shell.saveSettings`, applies at the next Play. Not the owner: every control
  disabled and the line "Read only: the game runs in another tab."
- How the four page keys apply (in `main.ts` at Play): `fullscreen_on_play` (Task 5); `resolution_scale` → the
  renderer's `scale` (`auto` = undefined; `?scale=` wins); `fps_counter` → the overlay's mode at start;
  `output_latency` → the `AudioContext`'s `latencyHint`: lowest `'interactive'`, balanced `'balanced'`, robust
  `'playback'`.
- **Game data on this device:** "N MB of game data is in this browser." (`cacheBytes`), and **Delete game data**
  (confirm; disabled while a game runs). No Preload in this version (its worker is not in this repository).
- **Reset all settings** (confirm; writes `TEMPLATE`). **Edit settings.ini as text**: a dialog with the file in a
  textarea, under it the list of `parse` problems by line number, Save and Cancel.

- [ ] **Step 1: Implement the panel with the four page keys.**
- [ ] **Step 2: Browser check, each page key.** `resolution_scale = 2` → next Play logs `drawn at 1280x960`;
  `fps_counter = on` → the overlay is visible at start; `output_latency = robust` → the log's audio line shows a
  larger base latency than with `lowest`; `fullscreen_on_play` as in Task 5. Each value survives a reload.
- [ ] **Step 3: Verify the candidates, one at a time.** For each, add the key to `KEYS` only when its check
  passes; otherwise leave it out and note why for Task 9.

  | Candidate | How it would work | It passes when |
  |---|---|---|
  | `movies` (bool, def `1`, group game) | env `NOMOVIES=1` when off (`runtime/fileio.c`) | off: the game reaches the main menu with no intro movie and nothing else breaks (menus, a quick race start); on: as today |
  | `background` (enum `pause,run`, def `pause`, group game, more) | the page does not send the deactivation on blur (look for a switch in `web/src/input/index.ts`; add an `InputOptions` flag if a small one does it) | with `run`, 30 s with the tab in the background: the frame count in the log keeps rising and sound and timing are right when it is back |
  | `game_resolution` (enum `640x480,800x600,1024x768`, def `640x480`, group display, more) | registry value `Thrash Resolution` written into `/.nfsu2_registry` of the save folder before Play (format: a line `s Thrash Resolution=800x600`; replace the line if present) | the log shows `frame buffer 800x600`, the menus are complete and clicks land (a controlled click on "options" opens it) |

  A candidate that needs more than a page-side change or one small runtime switch is out of this version.
- [ ] **Step 4: Unit tests for what was added.** For each key added: its default, and its effect in `resolve`
  (for `movies`: `resolve('movies = 0\n', {}).env.NOMOVIES === '1'` and no `NOMOVIES` when on; for
  `game_resolution`: `resolve(...).registry['Thrash Resolution']`). Run `pagetest.sh`: all pass.
- [ ] **Step 5: Browser check, the file editor and reset.** Edit as text: add `fps_counter = maybe` → the dialog
  lists line N as ignored; Save keeps the text; the row shows the default. Reset all settings → every row at its
  default, the file equals `TEMPLATE`.
- [ ] **Step 6: Browser check, game data.** After one Play the line shows more than 0 MB; Delete game data → 0 MB;
  the next Play loads again from the server and reaches the menu.
- [ ] **Step 7: Checkpoint.** No commit.

---

### Task 8: The Controls tab

**Files:**
- Create: `src/keys.ts`, `src/ui-controls.ts`; Modify: `src/ui-menu.ts`, `index.html`, `style.css`

**Interfaces:**
- Produces (`keys.ts`): `export interface KeyRow { keys: string[]; what: string } export const GAME_KEYS: readonly KeyRow[]; export const SITE_KEYS: readonly KeyRow[];`
  `SITE_KEYS`: F8 "Frame-rate counter: off, on, detailed"; F9 "Menu: full screen, controls, log, quit"; F12
  "Screenshot"; Hold Esc "Leave full screen".
- Produces (`ui-controls.ts`): `export function controlsSheet(root: HTMLElement): void` with sub-tabs
  **keyboard**, **controller**, **site**. Keyboard and site are tables of key caps (`<kbd>`) and what they do;
  under the keyboard table: "In menus: the mouse, or the arrow keys and Enter; Esc goes back. Change keys in the
  game's Options, Controls." Controller: "Controllers and wheels are not supported yet."
- The page menu's Controls item (Task 5) shows the same sheet in a dialog.

- [ ] **Step 1: Read the keys from the game.** At `http://127.0.0.1:8081/`, in the game open options → controls
  (controlled clicks; "options" is at the bottom of the main menu), page through its keyboard list and take
  `renderer.shot()` of each page into a scratch folder outside the repository. Write `GAME_KEYS` from what the
  screens show (action and key, in the screen's order). Delete the scratch pictures afterwards: they are game
  art.
- [ ] **Step 2: Implement the sheet.**
- [ ] **Step 3: Browser check.** The tab shows as many rows as the game's list had, with the same keys; the three
  sub-tabs switch; F9 → Controls shows the sheet over the game.
- [ ] **Step 4: Spot check two keys in a race** with the key log (`?env=NFSU2_KEY_LOG=1`): the keys the table
  gives for throttle and for the handbrake make the game log those key codes and the car reacts (speed rises;
  NOTES.md has the quick-race clicks).
- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 9: README, notes and the acceptance run

**Files:**
- Modify: `README.md`, `porsche-dev/NOTES.md`; Create: `docs/start-page.png`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Take the screenshot.** The start page at 1280x800, Play card `ready`, the Game tab open, with no
  profile name and no game picture on it → `docs/start-page.png`.
- [ ] **Step 2: Rewrite `README.md`** after `/mnt/c/Development/NFSPU/nfsu2-web/README.md`'s order: title and one
  paragraph, the disclaimer, the screenshot, Status, What you need (keep the exact sizes and SHA-256 that are
  there now), Build (keep the commands that are there now), Play (the server command, then the start page: Play
  and Enter, the three tabs in one line each, F9), How it works, Credits. Every command and option in it is one a
  step of this plan ran.
- [ ] **Step 3: Update `NOTES.md`:** the page's layout and files, `pagetest.sh` and `testserver.sh`, that tests
  run at `127.0.0.1:8081`, which Game candidates were dropped and why, the Rename finding, the profile file rule.
- [ ] **Step 4: The acceptance run** ("Done means" of the spec), in one fresh tab at `http://127.0.0.1:8081/`,
  each line with its evidence written into the task's report:
  1. the page loads in the garage look;
  2. Play starts the game and reaches the main menu (log: first frame, WebGPU);
  3. every setting on the page changes what it says at the next Play and survives a reload;
  4. download a backup, delete the profile `TEST` and reset all settings, restore the backup: the profile and
     the settings are back and the game offers the player TEST;
  5. a second tab is read-only and takes over when the first closes;
  6. Quit game returns to the start page;
  7. F12 puts a PNG in Saves;
  8. `?env=`, `?scale=`, `?wasm=/porsche-sw.wasm`, `?trace=` still do what they did;
  9. `pagetest.sh` passes; `grep -rEn "localhost:8080" porsche-dev/web-porsche/test` prints nothing.
- [ ] **Step 5: `testserver.sh stop`. Checkpoint:** `git status --short` and a summary of what changed, for the
  user to decide about a commit.
