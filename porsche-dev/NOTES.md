# NFS Porsche Unleashed in the browser: project notes (state 2026-11-15)

Goal: run NFS Porsche Unleashed (Porsche.exe v3.5) in the browser the way nfsu2.xyz runs NFSU2:
static recompilation x86 -> C -> wasm, Glide drawn with WebGPU, sound and input through the
nfsu2-web host. Base: github.com/th0mk/nfsu2-web (MIT), itself built on TalhaMudo/NFSU2Recomp.
Git: /mnt/c/Development/NFSPU/porsche-web is the user's own repository, branch main, with a history of its own
(started 2026-11-15 from nfsu2-web 78cc90d, without its commits); the only remote is
origin = git@github.com:jirded/nfspu-web.git (PUBLIC). No remote to th0mk. Run git from WSL. Commit and push only
when the user asks.
NFSU2's own parts are gone from the repo (2026-11-15: tests, web/server-rs, the NFSU2 page, discord-bot, win, docs,
CI, the macOS build, the runtime and tools files no Porsche build reads): about 220 files left of 1238. If one is needed
again (winsock for multiplayer, dinput_pad for gamepads ...), take it from the nfsu2-web clone or from upstream.
verify_build.sh (snap, then check) rebuilds everything from scratch and compares gen/, porsche.wasm and the page with
the snapshot: use it after any such clean-up (the pruned tree gave byte-identical outputs).
EA game data must not be published (copyright): the game, gen/, out/, screenshots, *.fsh, *.sav stay out (.gitignore).

## Where things are
Everything lives in C:\Development\NFSPU (moved there from the WSL home on 2026-10-31), used from
WSL Ubuntu-24.04 (user jd) as /mnt/c/Development/NFSPU:
  porsche-web/  the project's git repository (main): runtime, tools, gen, out, deps, web, web-porsche, porsche-dev
  nfsu2-web/    a plain clone of th0mk/nfsu2-web (main), for reference only; porsche-web no longer depends on it
  games/        porsche/ (game data the server and native runs read), porsche.registry
  tools/node/   Node 22 (Linux build; ~/.bashrc puts tools/node/bin on PATH)
- If the folder moves again: fix the absolute paths in porsche-dev/*.sh.
- core.filemode is false in porsche-web (drvfs shows every file as 0777). Compiling on C: is as fast as on the WSL
  disk (CPU bound); walking many files is ~10x slower.
- Tools: porsche-web/.venv (capstone 5.0.7, pefile), porsche-web/deps/ wasi-sdk 34, system clang 18 and gdb in WSL,
  Node 22 at /mnt/c/Development/NFSPU/tools/node (web/ has had npm ci).
- Game copy: /mnt/c/Development/NFSPU/games/porsche (the user's own install of v3.5, without Ereg and Support).
  Porsche.exe must be the unprotected v3.5 executable (full relocations, entry 0x5a2d1a);
  Drivers/voodoo2z.dll = Glide thrash driver.
- Native registry file: /mnt/c/Development/NFSPU/games/porsche.registry (lines `s Name=value`; Glide needs Thrash Driver=Voodoo2, Group=Glide).
- THIS FOLDER (/mnt/c/Development/NFSPU/porsche-web/porsche-dev) is the source of truth for everything new; edit it
  in place. install_rt.sh copies rt/ into the repo (uses dirname $0); the other scripts name absolute paths under
  /mnt/c/Development/NFSPU.

## Layout of the new code (install_rt.sh copies it into the repo)
- rt/porsche/ -> runtime/porsche/
  - glide.c: Glide 3 front end (state, vertex layout, 4 MB TMU memory + decoded texture cache, palettes, LFB,
    grGet, grQueryResolutions). grBufferSwap calls vclock_tick and watchdog_on_present; metal_frames() = frame count.
  - glide.h, glide_sw.c (software rasterizer, PNG dump PORSCHE_DUMP / PORSCHE_DUMP_DIR / PORSCHE_FPS).
  - porsche_win32.c: Win32 extras (GetKeyState, GetAsyncKeyState, CharUpperA, GetKeyboardType, DirectDrawCreate
    fails cleanly, GetDC/GetDeviceCaps ...) and extra imports: glide3x.dll entry points, gimme.dll ConvertFile.
  - porsche_hle.c: guest function overrides (see "Root causes").
  - porsche_stubs.c: no-op stand-ins for NFSU2-only runtime parts.
- rt/porsche_web/ -> runtime/porsche_web/: main.c (wasm entry), glide_gpu.c/.h (WebGPU command recorder, host kind 9),
  fb_web.c (software frame for the page, kind 8), ticker.c (precise nanosleep through a tick futex, kind 10).
- rt/linux/ -> runtime/linux/: porsche_main.c (native headless entry), linux_plat.h, compat/.
- rt/porsche_native.sh, rt/porsche_web_build.sh, rt/porsche_lift.sh, rt/porsche_glide_lift.sh -> tools/
  (they take the repo root from their own path and the game file as an argument: the README's build steps).
- rt/patch_rt*.py: patches to the shared NFSU2 runtime, applied in glob order, idempotent:
  1 Linux ports | 2 argcount for Porsche imports | 3 WaitForMultipleObjectsEx + timeouts |
  4 DirectInput 1-7 factory, DSound capture | 5 ask porsche_win32.c before reporting a stub |
  6 argcount voodoo2z | 7 extra imports | 8 thrash DLLs from the Drivers folder | 9 DI device enumeration |
  9a DI QueryInterface for older interfaces | 9b mouse GetObjectInfo/GetCapabilities |
  9c PulseEvent, semaphores, blocking GetMessageA | 9d registry default renderer Glide |
  9e PORSCHE_PROF=1 import wall-time profile | 9f GetAsyncKeyState + mouse buttons |
  9g key/button release waits 2 frames after its press | 9h fileio_resolve_write |
  9i virtual clock at real speed in long stalls | 9j release stuck modifiers (Alt) |
  9k DeleteFileA of a file that is only in the read-only game folder succeeds.
- web-porsche/ -> repo web-porsche/ (webpage.sh copies and builds): the start page (2026-11-15; design and plan in
  specs/2026-11-15-start-page-*.md).  index.html + style.css (the "garage" look, all CSS, no images);
  src/main.ts = the shell (boot, checks, the one-tab lock, start page <-> game, the page's keys, URL options
  ?env=K=V, ?wasm=, ?trace=, ?scale=; log POST /log; window.__shell for checks);
  src/game.ts = one run of the game (startProcess, ticker worker, audio, input, WebGPU or software picture; ends
  the workers when the game exits); src/ui-play.ts, ui-saves.ts, ui-game.ts, ui-controls.ts, ui-menu.ts = one
  panel each; src/settings.ts (settings.ini: keys, parse, put, resolve), savefs.ts (OPFS save folder + data cache),
  profiles.ts (which files are a player), backup.ts + zip.ts, keys.ts (the game's and the page's keys), overlay.ts,
  dialogs.ts, logs.ts, display.ts, instance.ts; src/glide-gpu.ts (WebGPU renderer, WGSL uber-shader, pipeline
  cache, shot() = the picture as PNG, the automatic scale); src/autoscale.ts (when Auto draws the picture
  smaller); src/ticker.ts; test/*.test.mjs (unit tests of the pure modules); mouse-latency.js (a probe, see
  "Root causes": ?probe=mouse); build.mjs (esbuild); server.mjs (Node server).

## Build and run
- Lift Porsche.exe (only when overrides or the lifter change, ~30 s): tools/porsche_lift.sh [Porsche.exe]
  = tools/reloc_dir.py (out/relocs.txt), then OVERRIDE=53c2e0,5366e0 X87PC=1 tools/genall.py <exe> 64 (gen/all,
  reproducible), then tools/argcount.py (gen/all/impargs.c). The lifter also reads tools/retpast.txt.
  relift_build.sh = install_rt + the lift + the wasm build.
- voodoo2z.dll is the second guest module at 0x00A00000 (gen/server, prefix srv_):
  tools/porsche_glide_lift.sh [voodoo2z.dll] (gen_glide.sh calls it with the local path).
- Native: build.sh (install_rt + argcount + tools/porsche_native.sh) -> out/native/porsche_boot.
  run4.sh = headless run with PNG frames.
- Wasm: webbuild.sh (install_rt + tools/porsche_web_build.sh) -> out/web/porsche.wasm
  (~2 min when every shard rebuilds, i.e. after a lift; seconds for runtime-only changes).
- Page: webpage.sh (copies web-porsche into the repo, runs node web-porsche/build.mjs). Unit tests: pagetest.sh
  (copy, then node --test web-porsche/test/*.test.mjs; 30 tests).
- Test server: testserver.sh start|run|stop = a second server on http://127.0.0.1:8081/ (stopped by PID only;
  server_stop.sh's pkill would also take the user's server). Its page log is out/test-browser.log (tlog.sh [N]
  [pattern], tlogafter.sh PATTERN [N]). Browser checks run there (or at http://localhost:8081/, one more origin),
  never at http://localhost:8080/: each origin has its own saves, data cache and one-tab lock.
- Server: cd /mnt/c/Development/NFSPU/porsche-web && /mnt/c/Development/NFSPU/tools/node/bin/node web-porsche/server.mjs --data /mnt/c/Development/NFSPU/games/porsche --port 8080
  -> http://localhost:8080/ . Stop with server_stop.sh. The page log goes to /mnt/c/Development/NFSPU/porsche-web/out/web-porsche-browser.log
  (each page load has a 4-character prefix; blog.sh [N] [exclude-regex] shows the newest page).
- Useful runtime env (page URL ?env=NAME=value): PORSCHE_PROF=1 (import profile every 10 s),
  NFSU2_KEY_LOG=1 (key log), NFSU2_WATCHDOG=seconds (stall report).
- WSL from Windows: commands must start with `wsl -d Ubuntu-24.04` (allowed rule). Git Bash mangles $, backslashes
  and /mnt paths, and heredocs with apostrophes or double backslashes: put scripts in files and run
  wsl -d Ubuntu-24.04 -- bash -lc "bash /mnt/c/.../x.sh". In python patches write a backslash as chr(92).
  Run helper python with -I (a file named dis.py once shadowed the stdlib).

## Status
- Browser (Chrome, WebGPU): boot, intro, profile select, menus, 3D garage, quick race on Cote d Azur at ~55-61 fps
  with HUD, opponents and sound. Mouse works. Keyboard verified with synthetic keys (throttle, reverse, left, right);
  the user also drove it by hand.
- Start page (2026-11-15): Play card with states, Saves (players, backup, restore, screenshots), Game (4 settings,
  game data, settings.ini), Controls; while playing Home = page menu, End = frame-rate counter, Insert =
  screenshot (the game uses F1-F12 itself: its "predefined keys"), Quit game from the menu. Checked in Chrome at
  the test origin; not checked: full screen (Chrome refuses it in the automation window: "not granted").
- Native headless: renders the menus (software rasterizer).

## Root causes fixed (patterns to remember)
- Chrome timers are 15.6 ms on Windows -> ticker worker with precise sleeps.
- The virtual clock (win32.c host_us) moves at presents only -> vclock_tick in grBufferSwap ("animations very slow");
  patch 9i: after 250 ms without a frame it runs at real speed (Porsche loads without presenting frames).
- Clicks lost when press and release fall between two frames -> patch 9g.
- gimme.dll ConvertFile missing (LoadLibrary fine, GetProcAddress 0, call through NULL at 0x4DBE36) -> "error trying to
  create that player". Reimplemented: ConvertFile(src, dst, index) cdecl takes image `index` of FEData/Art/ALLdrivr.fsh
  (SHPI, 54x64, code 0x7B 8-bit + 0x29 565 palette) and writes SaveData/pic16.fsh (one image, code 0x78 565,
  "Buy ERTS" padding), byte-identical to gimme.dll's output. Player pictures of their own (.tif .tga .jpg .bmp) are not
  converted (returns 0).
- RACE froze (black screen, sound gone): guest lock (GIL) starvation. Wait loops spin on counters other guest threads
  move (timer thread tid 999 -> event -> tick thread tid 101 = sub_565270 increments [0x6B7C7C] and runs the tick jobs
  that move the race clock [0x5E99B8]) and call no Win32 function, so the runtime never handed the lock over
  (it does so only at Win32 calls: guest_fair_yield). Overrides in porsche_hle.c: 0x53C2E0 (tick read: after 32 equal
  reads for more than 2 ms, unlock + 1 ms sleep) and 0x5366E0 (jobs runner: guest_fair_yield first). Loops seen:
  0x53C380 wait(ticks), 0x4A88A0 (640 ticks during the race load), the race loop around 0x4154D4.
  The same starvation truncated a profile save (4OGD.sav) earlier.
- "there was an error trying to create that player" on a fresh save folder, at the first try only (2026-11-15):
  the game copies SaveData\XXhud1XX.hud to <NAME>1.hud, DELETES XXhud1XX.hud and writes it again (then the same
  with XXhud2XX.hud). With the save overlay DeleteFileA goes to the write root, where a file the game never wrote
  is not: unlink said ENOENT, the game stopped. (The game then wrote its default XXhud files into the save
  folder, so the second try found them and worked.) Patch 9k: when the file is only in the read-only game
  folder, DeleteFileA says it is deleted (log: "only in the game folder, taken as deleted"). No whiteouts: the
  game folder's copy is still read until the game writes the file again, which is what it does here; a player
  that lives only in the game folder (OGD) still cannot really be removed in the game.
  How it was found: the log of the failed try next to the working one; the working one had a CopyFileA to
  XXhud1XX.hud right after the DeleteFileA, the failed one stopped at the DeleteFileA.
- The cursor lagged 100-250 ms behind the mouse (2026-11-15), and the picture was shown at 9-34 frames a second
  while the status said 50-60: the graphics card was behind. Measured on the user's Intel GPU, 144 Hz display, with
  the probe (open the page with ?probe=mouse, Play, keep the mouse still; after 22 s it times the animation
  frames and the delay from a pointer move to the frame that shows it, into the log as "[probe] ..."):
    picture at 3x (1920x1440, what Auto chose for the window): a frame every 43 ms, mouse 106 ms
    at 2x: every 26 ms, mouse 79 ms;   at 1x: every 14 ms (the game's own 66-70 fps), mouse 27-31 ms
  The page's script took 1 ms a frame: no long tasks, all of it the card. Three things were wrong:
  1. the page drew every queued frame of the game, up to 3 an animation frame, though only the last is seen:
     each batch took 3 frames' time, 3 more queued meanwhile, and it stayed there. Now, when several wait, the
     older ones are only taken (their textures) if the next starts by clearing the whole picture (glide-gpu.ts
     startsFresh/takeFrame; GlideRenderer.skipStale);
  2. the game ran up to PG_NSLOT-1 = 2 frames ahead of the page: every frame ahead is one the input is late by.
     PgCtl.ahead (glide_gpu.h, written by the page, default 0): the game waits in glb_swap until the page has
     drawn the frame it published. With a slow card that also halves the game's frame rate (it no longer makes
     frames nobody sees), so it only pays together with 3;
  3. "Resolution scale: Auto" took what fits the window, up to 4x, whatever the card. Now it steps down while
     the game's frames are drawn under 50 a second (autoscale.ts ScaleGovernor: 40 of 60 frames slow -> one step
     down as a trial; kept and remembered in localStorage porsche.autoscale when the frames came 30 % closer,
     taken back for good otherwise: a slow game or a held-back window is not the card). Choosing a scale in the
     Game tab clears what was remembered.
  Signals that did NOT work for 3: the animation frame after a drawing one being late (it is the one after
  that), and how long the game waits for the page (the page marks a frame done when it is submitted, not when
  the card has drawn it). The frame rate the status line used to show (frames taken a second) hid all of this.
  Still open: why 100 draws cost this card 14-43 ms (overdraw of the menu's big translucent layers through the
  uber-shader?); the picture at 1x is 640x480 stretched.
- Stuck Alt: Chrome on Windows can keep Alt's key up (no blur) -> the game saw Alt held, arrows came as WM_SYSKEYDOWN,
  the car did not move. Patch 9j: on a non-modifier key press, a held Alt/Ctrl/Shift the event says is up is released.

## How to debug a freeze
1. Reproduce in the browser, wait about 20 s: the stall watchdog prints every guest thread (state, eip, guest stack,
   held critical sections) into the page log.
2. A thread "holds the GIL: running" for long = a spin loop. Disassemble with
   .venv/bin/python -I x86dis.py /mnt/c/Development/NFSPU/games/porsche/Porsche.exe START END; inspect lifted C with fnsrc.sh, fnstr.sh,
   fnof.sh, writers.sh (who writes an address).
3. Fix with an override: add the address to OVERRIDE in rt/porsche_lift.sh (the lifted original becomes
   sub_XXXXXXXX_orig), define sub_XXXXXXXX in rt/porsche/porsche_hle.c, run relift_build.sh.

## Browser automation notes (Claude in Chrome)
- The viewport height flips between 698 and 744, so physical clicks miss (one nearly removed a profile). Click with JS
  PointerEvents on #screen in game coordinates 640x480 (gclick helper). Menu points: continue (322,400), single player
  (233,54, sometimes twice), quick race (320,261), RACE (355,467), create player (321,352), first portrait (227,239),
  done (321,400).
- Keys: dispatch KeyboardEvent on the focused #screen; synthetic keys are only flagged in the key log.
- The game pauses when the window blurs or the page is hidden (log: app: deactivated).
- Tabs share the OPFS save folder porsche-save; the page's one-tab lock (Web Lock "porsche-saves") lets only one
  tab of an origin start the game. The user may be playing in another tab: test at the test origin (above).
- The automation window is often occluded: requestAnimationFrame is throttled, the game shows 2-5 fps and a
  click needs a long hold (move, 800 ms, down, 1000 ms, up, 2 s). With the window in front it is 50-80 fps.
- Do not open extra tabs with the tool and close the older one: the remaining tab fell out of the tool's group
  once and kept the lock (it had to be closed by hand).
- More menu points (game coordinates): select a player in "select user" (297,239), continue (322,402), options
  (498,466), there: controllers (216,11), advanced controls (451,76), predefined keys (532,118); in "create
  player" click the name box (360,169) before typing; the error box's OK (322,262).
- Page state for checks: window.__shell (owner, running, fs, log.tail(n), quit()).
- Do not take the user's own play for a test result: verify with controlled input and the key log.

## Open items / ideas
- The user's profile OGD is broken (SaveData/4OGD.sav truncated to 56 KB by the earlier freeze): remove it in the game
  and create a new one. Test profile TEST exists in OPFS (can be removed).
- Not tested: a race to the finish, other tracks and modes (career, knockout, factory driver), replays, options,
  gamepad/wheel, multiplayer (Winsock), long sessions, weaker machines, Firefox/Safari.
- The game ignores WM_CLOSE (no close box; "WM_CLOSE ignored, re-posting every second"): Quit game relies on the
  runtime's forced exit after NFSU2_QUIT_GRACE (the page sets 2 s), which waits for open save files. EXIT 0.
- A player is SaveData/<digit><NAME>.sav (the digit = the portrait chosen) + <NAME>1.hud + <NAME>2.hud; player.lst
  names the current one; the name is also inside the .sav, so the page has no Rename. The game also lists the
  players of the served game folder's SaveData (OGD), shown on the page as "from the game folder".
- The save folder also holds copies of game data the game opens for writing (FEData/controls/*.ctr, gamedata/...):
  a backup leaves them out (profiles.ts isSave).
- Game-tab candidates left out: movies (NOMOVIES knows only NFSU2's formats; Porsche's .mad are not opened at all),
  keep running in the background (NFSU2_BACKGROUND=run exists, but the picture needs requestAnimationFrame; not
  verifiable with the browser tool), game resolution ("Thrash Resolution=800x600" in .nfsu2_registry did not change
  the menus' 640x480 frame buffer).
- The first synthetic key after a game start did not reach the game twice (later ones did): shared input, not looked into.
- More spin loops of the same kind may exist elsewhere.
- ConvertFile for custom pictures; FEData/Art/pic16.fsh uses code 0x6D (4444), not produced.
- README.md describes the build for others (own game copy, exact Porsche.exe hash): keep it in step with the
  scripts. Packaging for the user.
- Names left from NFSU2 in the shared runtime (NFSU2_* env variables and macros, gen/server for voodoo2z).
