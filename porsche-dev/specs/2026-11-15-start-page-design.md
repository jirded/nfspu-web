# Start page for Porsche Unleashed in the browser: design (2026-11-15)

## Intent

Today the page is a development harness: a header with a status line, Play, Full screen and Log buttons, and the
game's canvas. The user wants what nfsu2.xyz has for NFSU2: a start page from which a player starts the game, sets it
up, looks after the saves and reads the controls. Its functions follow nfsu2.xyz; its look is the project's own and
comes from Porsche Unleashed itself. The README is then brought in line with nfsu2-web's README and shows the page.

Reference: https://nfsu2.xyz/ (looked at on 2026-11-15) and its sources of 2026-10-31 in the local clone
`/mnt/c/Development/NFSPU/nfsu2-web/web/src/app` (MIT). The live site is newer than the clone; where they differ,
the clone is what can be reused.

## Goals

The page has a header, a left column (the Play card, then About and Credits) and a right column with three tabs:
**Saves**, **Game**, **Controls**. While the game runs its picture covers the page; when it ends the start page is
back.

### Play

- The card shows one state at a time, in words: downloading the game module (with progress), ready, starting,
  running, ended (and when the game last saved, if that can be told), a problem, open elsewhere.
- Play starts the game; Enter does the same while the start page is up.
- A problem is shown only when there is one, in plain words with what to do: the browser lacks WebGPU, cross-origin
  isolation, SharedArrayBuffer or OPFS; the module did not load; the game data cannot be reached.
- One game per browser: a second tab says the game is open elsewhere, cannot start it, and shows its settings and
  saves read-only. It takes over when the first tab closes.
- While playing, a page menu (F9) offers: full screen, the frame-rate counter, the controls, the log (show and
  download) and Quit game. F8 switches the frame-rate counter. Holding Esc leaves full screen; a short Esc goes to
  the game. Quit lets the game close properly, and falls back to stopping it if it does not answer.
- Closing the tab while the game runs asks first.

### Saves

- **Profiles:** the players the game has in its save folder, each with its name and when it was last saved.
  A profile can be deleted (after a confirmation that names it).
- **Download backup:** one zip with everything in the save folder: the profiles, the game's options, `settings.ini`
  and the screenshots.
- **Restore:** takes such a zip, shows what is in it, and asks before it replaces what the browser has. Only while
  no game runs.
- **Screenshots:** F12 while playing saves the picture as a PNG beside the saves. The tab lists them newest first;
  one can be opened large, downloaded or deleted.

### Game

A setting is on the page only if it demonstrably does something in this port. No control that does nothing.
Each change is saved at once and applies at the next Play. Candidates, to be verified one by one by the builder:

| Group | Setting | Known today |
|---|---|---|
| Display | Full screen on Play | page side, as on nfsu2.xyz |
| Display | Resolution scale | works (`?scale=N`; default: what fits the window, up to 4) |
| Display | Frame-rate counter (off, on, detailed) | the WebGPU renderer already reports frames, draws and vertices |
| Display | Game resolution | the game reads `Thrash Resolution` from the registry (640x480 today); only if another size really works |
| Game | Movies | the runtime has `NOMOVIES`; only if it does the right thing in Porsche |
| Game | Background tab (pause, or keep running) | the game pauses on blur today; only if keeping it running works |
| Game | Sound output latency | page side (the audio context and worklet) |
| Game data on this device | how much is in the browser, Preload, Delete | the host caches the data it reads; preloading needs the clone's predownload worker |

At the bottom: **Reset all settings** and **Edit settings.ini as text** (the file itself, with a note on each line
the game would ignore).

### Controls

- **Keyboard:** the game's default keys, as a table like nfsu2.xyz's. The keys are taken from the game's own
  Options, Controls screen, not from memory.
- **Site:** the page's keys. Fixed in this version. (Changed while building, 2026-11-15: the game itself uses F1 to
  F12, so the page's keys are Home for the menu, End for the frame-rate counter, Insert for a screenshot, and hold
  Esc to leave full screen; where this document says F8, F9 or F12, read those.)
- **Controller:** one line saying controllers and wheels are not supported yet.

### The look: "garage"

The user chose direction A of three mockups (kept in
`/mnt/c/Development/NFSPU/.superpowers/brainstorm/1059-1794730756/content/visual-style-v2.html`). It is taken from
the game's main menu:

- A dark concrete garage: near-black green-grey background that gets lighter toward the middle, a faint cold strip
  of light across the top, like the fluorescent tubes.
- Thin white hairlines crossing the page like the menu's targeting cross, and a dark circle behind the content.
- Panels: almost black, translucent, with a thin light border, square corners.
- Headings and tab names in lowercase, light weight, grey (as the menu's "main menu").
- The active tab and the chosen option are the game's red glossy bar with white text; switches are red.
- The Play button is the menu's RACE: uppercase, spaced, dark gold on a dark bar.
- Body text small, off-white, a plain sans-serif.

Everything is drawn with CSS. The page is English.

### README

Restructured after nfsu2-web's README: what it is and the disclaimer, a screenshot of the start page, what you
need, build, play (with the start page and its tabs in a few lines), how it works, credits. The screenshot shows
the start page only.

## Non-goals (this version)

Online and free roam, friends and crews, mods, cloud saves, a language choice for the page or the game, the
changelog, Discord and Donate, the players count, phones and touch controls, controller and wheel setup, changing
the site keys, offline use, renaming a profile (unless it turns out to be a plain file rename, see below).

## Anti-goals

- Looking like nfsu2.xyz (its lime accent, its bold italic headings, its rounded cards).
- Any of EA's art in the repository or on the page: no game textures, logos or screenshots of the game as page
  assets or in the README. The repository is public.
- A control that does nothing, or a setting the game ignores without the page saying so.
- Losing saves: a delete or a restore without a question, a restore while the game runs, two tabs writing the same
  save folder.
- Breaking what development uses today: the URL options `?env=`, `?wasm=`, `?trace=`, `?scale=`, the log sent to
  the server (`/log`, `out/web-porsche-browser.log`), and the canvas `#screen` taking input in game coordinates
  (the browser-automation notes in NOTES.md rely on it).

## Constraints

- Chrome with WebGPU on a PC. The Node server `web-porsche/server.mjs` stays; it may get new routes.
- Sources live in `porsche-dev/web-porsche/` and are copied into `web-porsche/` by `porsche-dev/webpage.sh`; the page
  is built with esbuild (`web-porsche/build.mjs`). The shared host, audio and input are in `web/src/`.
- The saves are in OPFS, folder `porsche-save` (the game writes `SaveData/` there). The settings go in a
  `settings.ini` in the same folder, as on nfsu2.xyz, so a backup carries them.
- Never touch the user's own profiles when testing. The user plays at `http://localhost:8080`; tests run at
  `http://127.0.0.1:8081`, from a second server, which is another origin for the browser: its own save folder, its
  own data cache and its own one-tab lock, so emptying or restoring there cannot reach the user's saves or lock
  their tab out, and the user's server is never restarted. The cost is a second copy of the cached game data.
  (The assistant's call.)
- Nothing is committed or pushed unless the user asks.

## How it gets made (decided)

- Reuse from the nfsu2-web clone, copied into this repository under its MIT licence (LICENSE already names it),
  with the online parts left behind: the save-folder access, zip, the log ring and download, the frame-rate
  overlay, full screen and keyboard lock, the one-tab lock, the settings file machinery with a list of keys of our
  own, the controls table. The start page's shell is written new and small: nfsu2's is 1900 lines, most of them
  online.
- No new npm dependencies.
- `InputHandle.requestQuit()` (web/src/input) is the way to ask the game to quit; the runtime's lifecycle code is
  already in the Porsche build.

- As in the clone: the one-tab lock is held for the life of the tab; a restore replaces everything in the save
  folder; Play works again in the same page after the game ends, without a reload; the page takes F8, F9 and F12
  itself; `settings.ini` is read at each Play and turned into the game's environment, and `?env=` wins over it.

These are the assistant's calls, not the user's.

## Left to the builder

- Which of the Game candidates pass verification, and how each reaches the game (environment variable, registry
  value, page option).
- How a profile maps to files in `SaveData/` (the install has `4OGD.sav`, `OGD1.hud`, `OGD2.hud` for a player OGD,
  and `XXDefXX.sav`, `XXhud1XX.hud`, `XXhud2XX.hud`, `nfs5.trk`, `pic16.fsh` beside them). Rename is in only if a
  profile's name is nowhere inside its files; otherwise it stays out.
- How F12 takes the picture (from the WebGPU canvas or from the renderer's target).
- The module split, the names, and whether the reused modules live in `web/src/app` or under `web-porsche/src`.
- Whether Preload is worth its worker in this version; "how much is here" and Delete are the minimum.

## Done means

In a controlled browser run, with the log as evidence and not the user's own play: the page loads in the garage
look; Play starts the game and reaches the menu; each setting on the page changes what it says after the next Play
and survives a reload; a backup downloaded and restored into an emptied save folder brings the test profile back;
a second tab is read-only; Quit game returns to the start page; F12 puts a PNG in Saves; the development URL
options still work. The README matches the page and the scripts.
