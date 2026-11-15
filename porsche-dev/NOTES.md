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
    glide_view_size / glide_mode_size: wide screen driving (below).
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
  dialogs.ts, logs.ts, display.ts, instance.ts; src/wide.ts (wide screen driving: the view's size told to the game,
  the scale a wide picture fits a texture at); src/glide-gpu.ts (WebGPU renderer, WGSL uber-shader, pipeline
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
  (copy, then node --test web-porsche/test/*.test.mjs; 37 tests).
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
- Wide screen driving (2026-11-15): the game's Options > graphics > screen size offers, after 640x480, 800x600 and
  1024x768 (4:3, bars at the sides), "720p", "1080p", "1440p" (that many lines at the window's aspect) and the
  window's own size; a race in one of those fills the window with a wider view, the dials in the corners; the
  menus stay 640x480. Checked on Cote d Azur in a 3440x1215 window: all four (2038x720, 3058x1080, 4076x1440,
  3440x1214, 60+ fps at 1x), the pause menu, race again, a replay, back to the menus, the game's own "wide
  screen" option on (no bars in a wide race, still "on" afterwards), a changed window between two games.
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
  2. the game ran up to PG_NSLOT-1 = 2 frames ahead of the page. PgCtl.ahead (glide_gpu.h, written by the page)
     says how many it may. 0 (wait for each frame to be drawn) was tried and taken back: it cost the game a
     refresh of waiting a frame (54 against 64 fps in a race, 68 against 97 in the menus, 144 Hz) and the mouse
     came no sooner. The page asks for 1;
  3. "Resolution scale: Auto" took what fits the window, up to 4x, whatever the card. Now it steps down while
     the game's frames are drawn under 50 a second (autoscale.ts ScaleGovernor: 40 of 60 frames slow -> one step
     down as a trial; kept and remembered in localStorage porsche.autoscale when the frames came 30 % closer,
     taken back for good otherwise: a slow game or a held-back window is not the card). Choosing a scale in the
     Game tab clears what was remembered.
  Signals that did NOT work for 3: the animation frame after a drawing one being late (it is the one after
  that), and how long the game waits for the page (the page marks a frame done when it is submitted, not when
  the card has drawn it). The frame rate the status line used to show (frames taken a second) hid all of this.
- The game stuttered at a higher resolution scale (2026-11-15): the fragment shader. One shader did every Glide
  combine mode, test and fog, reading the modes from the uniform block and branching on them for each pixel,
  and wrote the depth for each pixel (no early depth test). The card's own clock (timestamp queries, ?probe=gpu)
  on the Intel GPU, ms for the game's pass, old shader / new / a plain textured fill:
    menus (640x480, drawn 8 times over):   1x 4.3 / 0.6 / 0.6    2x 19.6 / 3.0 / 3.2    3x 41.8 / 8.8 / 7.1
    race (1024x768, drawn 2 times over):   1x 8.3 / 0.8 / 0.5    2x 26.1 / 4.4 / 2.0    3x 70.2 / 9.4 / 5.3
  The pass onto the canvas is 0.5 ms, the page's script 1 ms. Now (glide-gpu.ts WGSL_MAIN): the modes are
  constants of the pipeline (WGSL overrides, SHADER_MODES/shaderModes: a pipeline for each set of modes, 20-45 in
  a game), so the compiler drops what a draw does not use; with a z buffer the depth comes from the vertices
  (fs_z; fs writes it only for a w buffer); and the fog table's entry is worked out instead of searched in a
  63-step loop for each pixel (that loop was two thirds of a race frame after the first two). Menus at 3x went
  from 22 to 90 fps (mouse 106 -> 47 ms), a race at 2048x1536 from 27 to 64 fps.
  The old shader stays as WGSL_UBER for checking: renderer.compare() draws one frame with both on a cleared
  picture and compares them (menus, the 3D garage, a race: identical, but for 2-3 pixels of a race frame where
  the depth differs in the last bit). renderer.variant('uber'|'full'|'flat'), gpuTimes() (which modes cover
  how much of the picture). ?probe=gpu runs the table above 22 s after Play; ?probe=gpu-manual when
  __gpuProbe() is called in the console (get into a race first).
  The scale Auto remembers is under a new key (autoscale.ts AUTOSCALE_KEY ends in .2): caps found with the old
  shader are forgotten. In a race the game itself is the limit now (45-64 fps at any scale up to 3x).
- The race load froze on a black screen, two times in three on a new player (2026-11-15): one more loop that
  never gave the guest lock up. Watchdog: tid 1 "holds the GIL: running" at eip 0x533CB7, the file thread
  (tid 102) "waiting for the GIL", "critical section ... held by tid 1". The loop at 0x533CA1 (read and
  wait) calls 0x567F70 (is the request to the file thread done?) until it is, inside one of the game's
  critical sections, and guest_fair_yield does nothing inside a critical section. Override 0x567F70
  (porsche_hle.c): guest_unlock(); guest_lock(c) first, so the queued threads run. 4 loads of 4 since.
  When it did not freeze before, the file thread had got the lock before the loop began.
- Stuck Alt: Chrome on Windows can keep Alt's key up (no blur) -> the game saw Alt held, arrows came as WM_SYSKEYDOWN,
  the car did not move. Patch 9j: on a non-modifier key press, a held Alt/Ctrl/Shift the event says is up is released.

## Three more from playing (2026-11-15)
- A race's loading screen had the game's first loading picture in its corner (in a mode larger than 640x480).
  What the game writes through the linear frame buffer is kept on the game's side (glide_gpu.c g_shadow), so a
  read lock gets it back; the copy was only made anew at the next write, so the first lock in a new mode read
  the old mode's picture into the new one's corner. glb_open drops it: a new mode starts black.
- "Exit" (main menu, or quit > exit to windows in a race) left a black screen for good. 0x53BCB0 closes the
  game's window on the way out: it posts the window's thread (0x53B8D0, a GetMessage loop) the message 0x466 and
  waits, Sleep(0) after Sleep(0), until that thread has destroyed the window and cleared its handle 0x6B7BF8.
  The runtime posts no messages (PostMessageA, PostQuitMessage, DestroyWindow are no-ops), so the wait never
  ended (watchdog: tid 1 in sub_0053bcb0 <- sub_00575930 <- sub_00557120 <- sub_00467740 <- sub_004b6a50).
  Override 0x53BCB0 clears the handle itself; the game goes on to ExitProcess, the page shows its start page.
  0x53BCB0 is also called when no window is up (handle 0): nothing to do then.
- In a race the car looked smooth and the world went by in jerks (not solved to the user's liking yet).
  What is known:
  - The race's world moves in steps, 64 a second: the game's timer (0x4A45D0, 128 calls a second) counts
    0x6559EC 64 times a second, and each pass of the race's loop (0x4152E0) runs 0x414FF0 once for every tick
    since the pass before, then draws a frame; with no tick passed it draws nothing. So the game makes at most
    64 frames a second, and a frame shows the world after 1, 2, 3.. steps: nothing in between. A frame that
    is dropped, or a frame that takes two steps, is a jump of the world; the car stands still in the picture
    and hides it.
  - Measured (race at 3058x1080 and 3440x1270, 144 Hz display, Intel GPU): the game needs 11-16 ms for a
    frame, the card about 10 ms. As it was, frames were shown 7 to 42 ms apart and one in three was dropped
    as stale (two were ready, the older is not drawn).
  - Tried and taken out again: every frame for the same number of the display's refreshes ("pacing": the game
    waited for each frame's turn, ahead 0). In the user's window that worked as meant (48 frames a second,
    85-99% of them exactly 3 refreshes) and was "not extra smooth": 64 steps a second in 48 frames are 1, 1, 2
    steps a frame in turn. A beat worked out from the game's own time for a frame ran away (a longer step of
    the world is more work); the display's refresh measured at the page's start is wrong in a covered window.
  - As it is now: while a race runs (the game says so: PgCtl.racing, set around 0x4152E0) the page draws
    every frame, the oldest first, one an animation frame, and drops none; the game may make its next frame
    while the page draws (PgCtl.go). Each frame carries the game's tick count (PgHeader.step) and the page
    logs, every 600 frames of a race, "[glide-gpu] a race's frames: N a second; ticks of the game's clock (64 a
    second) a frame: 1: x%, 2: y%; refreshes a frame stays ...". 1 tick a frame at 64 a second is the best
    this game can look; on a 144 Hz display those frames stay 2, 2, 2, 3 refreshes.
  - The automation window's animation frames are held back unevenly (it is often covered), so its numbers say
    little: read the user's own log (out/web-porsche-browser.log).
  - The user's window with "every frame is shown" (3440x1270, 144 Hz): where the game makes a frame in under
    a tick (15.6 ms) it is 63-64 frames a second, 92-96% of them one tick, staying 2 refreshes (71%) or 3 (27%):
    as good as this game gets. In heavier parts of the track the game needs 18-19 ms: 51-56 frames a second,
    14-26% of them two ticks. What is left is the game's own speed (the lifted code's work for a frame);
    PORSCHE_PROF=1 in a race: 95,000 grDrawTriangle calls a second (0.15 s of each second in the call itself),
    20,000 critical sections a second.
- Opponents a few car lengths ahead had no wheels and no floor ("the chassis is gone"), in the wide modes. It is
  the game's level of detail. 0x439F90 picks a car's level each frame: it projects three corners of the car's
  box, adds the two edges' lengths in pixels, and counts that in 640ths of the picture's width (* 640 / the
  options' width 0x657A48: the choice is meant not to depend on the resolution). 120 and more is the full
  model; less goes down through levels 0..6 (car + 0x2C0), and 0x444E00 maps (car detail, level) to a model
  (table 0x5CDB44, rows of 7: levels 0-3 the full model, 4 model 1, 5 model 5, 6 model 6). The lower models are
  a shell without a floor, the wheels two flat discs on the side that faces the viewer. In a picture wider
  than 4:3 a car is as many pixels but fewer 640ths of the width (half as many at 2.7:1), so the shells came
  twice as near. Override 0x439F90 (porsche_hle.c): in a wide mode the width the cars are counted against is
  the one a 4:3 picture of that height has, for the time of the call. Seen side by side at 3058x1080, paused
  just after the start with the opponents 25-60 pixels wide: before, the nearest had its wheels and the others
  were shells; after, all four have their floors and wheels.
  The level is still what the game picks at 640x480 for a car of that share of the screen: at 1440 lines a
  shell is three times the pixels it was meant to be seen at. Counting in real pixels would give the full model
  far out, and a frame of a race has only 3,000-5,000 triangles now: five full cars more would cost the game
  the frames it does not have.
  Two wrong turns on the way: a 16-bit depth buffer "fixed" it in a comparison of two different moments (one
  had tyre smoke over the wheels); culling was suspected, but the game calls grCullMode once, with "off", and
  culls for itself. How it was pinned down: renderer.trace() of a paused frame showed one wheel draw of two
  quads for a far car and none for the other side; the classes' names (rtti.py R3DCarLOD) led to the code.
- The WebGPU device was lost twice in the automation window ("A valid external Instance reference no longer
  exists"; the picture goes black or white, the game runs on). No crash report of Chrome, no driver reset in
  Windows' log, the adapter is there again afterwards. The page logs the loss; it does not recover from it yet
  (the game would have to send every texture again).

## The name of the chosen tab was under its red wedge (2026-11-15)
In the options the chosen tab is a solid red wedge with its name in white; here the wedge had no name.
- The menus do not draw as they go. Every picture and text goes into a sorted list (0x65B958, a red-black tree;
  0x4D9280.. put quads in, 0x4D9B30 textured ones) and the list is drawn when a control is done (0x4DA5F0, from
  0x4DAAC0). 0x4D9450 orders two entries: depth (+0x18, farther first; the menus' depth is the global 0x65B954,
  0.99998 at the start of a frame, a layer nearer with 0x4DAA10), then the turn the entry was put in (+4, the
  counter 0x65B970; an entry can share the turn of the one before), then the address of its texture or font
  (+0xC), so entries with one texture are drawn together.
- A control's label shares the turn of the picture under it, so which came first was decided by where the heap
  had put the font and the picture: on Windows the font was higher (the label last, on top), here lower (the
  label first, under the solid wedge; under the see-through yellow of a hovered tab it only looked tinted).
  FEData/Controls/Graphic Tab Button.ctr says what was meant: state.selected parts=data,selectedbg,label.
  Override 0x4D9450 (porsche_hle.c): within a turn pictures (+0 is 0) come before texts.
- How it was found: renderer.trace() (the frame's draws: the label came before the wedge, both at depth 65536),
  ?env=GLIDE_TEXLOG=1 (the wedge's texture is solid, so it was not meant to show the label through), the
  .ctr changed in the save folder (neither the control's nor the state's order of parts moved the label), a
  backtrace at grDrawTriangle for the label's triangles (they came from another control's flush: a list, not
  immediate drawing), then reading 0x4D9450.
- The same tie decides other controls' labels over their pictures; none other was seen wrong.

## Wide screen driving (2026-11-15)
What the user asked for: a race as wide as the window with a wider view (not a stretched one), the dials in the
corners, no bars; the menus stay as they are; and the size chosen in the game's options the way nfsu2-web has
it (720p, 1080p, 1440p, the window's own size, next to the 4:3 ones). A first version widened the three 4:3
sizes behind the player's back (a page setting): the options did not say what was drawn, so it went.
- The game's modes are the thrash driver's table (voodoo2z.dll's data, 0xA140C8: 40 bytes a row = width, height,
  depth, 4, known to the driver, buffers with/without depth as Glide answers grQueryResolutions; a row is one of
  Glide's resolutions: row 1 = 640x480 (Glide 7), 2 = 800x600 (8), 3 = 1024x768 (0xC), 4 = 1280x1024 (0xD),
  5 = 1600x1200 (0xE), 6 = 512x384 (3), 9 = 640x400 (6), 11 = 856x480 (0xA)). The game reads the table in place
  ([[0x628130]+0x70]+8), lists the rows Glide has in the options (0x4BC710, a row needs >= 2 buffers and
  640x480), finds a row by its exact size (0x5376C0 -> 0x572A00 -> 0x572990) and keeps the player's choice as a
  size. 0x619780 = the row in use, then its width, height, depth; 0x657A48.. = the size a race asks for (640x480
  while in the menus).
- porsche_hle.c gives rows 4, 5, 6 and 9 other sizes (wide_refresh): 720, 1080, 1440 lines at the aspect of the
  page's view (1:1 to 4:1), and the view's own size (even, at most 8192 a side); a row that would repeat an
  earlier one, and all four while the view is unknown (the software renderer), are not offered. glide.c lists
  those Glide resolutions and opens them at those sizes (glide_mode_size). Refreshed before the options' list is
  made (override 0x4BC710) and at every setMode (override 0x467FC0), never the row in use. A size saved when the
  window had another shape no longer exists: the race's setMode call (it returns to 0x4B6CBE) then asks for the
  row with the same lines as it is now, any other unknown size for the view's own row, else 1024x768
  (wide_follow).
- The list's lines are made by sprintf("%d x %d x %d") at 0x4BC7BE: override 0x5A0FBF (sprintf) answers that
  one call for a wide row with "720p" .. or "3440 x 1270".
- Every change of the mode after the start goes through 0x467FC0 setMode(w, h, depth, buffers): 640x480 for the
  menus (from 0x4D3445), the films and loading screens (0x4DD624, 0x4DD724), the options' size at the start of
  a race (from 0x4B6CBE).
- The picture was the 4:3 one stretched: 0x466F30 (and its twin 0x4670E0) call 0x5391B0 perspective(angle across,
  aspect, near, far) with aspect = view's part of the screen * 640 / 480 (the constants 0x5B2A8C, 0x5B2A88),
  whatever the mode. Override 0x5391B0: in a mode wider than 4:3 the angle across grows by as much and the aspect
  follows, so up and down the view is what it was. The side planes for culling come from the same call.
- Bars above and below with the dials in them (the user's first complaint) are the game's own "wide screen"
  option, on for a new player: 0x657D5C (config "WIDESCREEN"; the table at 0x5D21xx is {variable, name, id}, so
  0x657D60 is the next option, not this one). The view is then the band 0.15..0.85 of the height (0x468E60).
  The value comes back from the player's config between setMode and the race, so it is taken off where the race
  runs: override 0x4152E0 (the race, from its views to its end) sets it to 0 in a mode wider than 4:3 and puts
  it back after.
- The dials, the mirror, the pause menu and the replay's buttons place themselves by the mode's width and keep
  their size in pixels: at 1440 lines they are a third of what they are at 480. 720p has them largest.
- The page (wide.ts, game.ts, glide-gpu.ts): the stage's size in device pixels goes into PgCtl.view_w/view_h at
  the start and at every resize. The canvas has the picture's aspect (--game-aspect, container units in
  style.css). The scale is cut so the picture fits one texture (fitScale). ?env=PORSCHE_VIEW=3440x1440 says the
  view instead of the page (a test).
- How it was found: the picture changed when the constant 0x5B2A88 was poked in the running game (the page can
  read and write the game's memory: __shell.running.memory, a guest address is an offset), fptan appears in
  two functions only (fngrep.sh 'tan('), a diagnostic in the setMode override showed which call starts a race,
  and nfsu2-web's runtime/com.c (modes_refresh) is where the list's shape comes from.
- Not checked: other tracks and cameras for missing scenery at the edges of a very wide view, the 3D screens of
  the career, split screen, a window narrower than 4:3.
- The renderer's device is destroyed when a game ends (glide-gpu.ts detach) and its loss is logged: after a day
  of starting games in one Chrome, WebGPU and WebGL were gone from the whole browser ("no WebGPU adapter";
  Chrome gives the graphics card up after its process crashed a few times) until Chrome was started again.
  Whether the devices left behind did it is not known.

## How to debug a freeze
1. Reproduce in the browser, wait about 20 s: the stall watchdog prints every guest thread (state, eip, guest stack,
   held critical sections) into the page log.
2. A thread "holds the GIL: running" for long = a spin loop. Disassemble with
   .venv/bin/python -I x86dis.py /mnt/c/Development/NFSPU/games/porsche/Porsche.exe START END; inspect lifted C with fnsrc.sh, fnstr.sh,
   fnof.sh, writers.sh (who writes an address), readers.sh (who names it), callers.sh, fns.sh (several small
   functions without the flag lines), fngrep.sh (functions with a line matching), strref.sh (who names a text),
   flt.sh (the float at an address), dis.sh START END, fnctx.sh (lines around a pattern in functions), fnwr.sh
   (functions with a matching line, in an address range), retof.sh (who makes the call returning to an address),
   vtab.sh (a vtable's functions), imports.sh, rtti.py CLASS (a class's vtables, through its RTTI name). In the browser: __shell.running.memory (read and write the
   game's memory), __shell.running.renderer.trace() (the next frame's draws with their boxes and depths into the
   log), ?env=GLIDE_TEXLOG=1 (each texture as it is decoded). The scratch script fshinfo.py (not in the repo)
   listed the images of an .fsh file.
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
  player" click the name box (360,169) before typing; the error box's OK (322,262). Options: graphics (420,12),
  the screen size list (297,235), its lines 640x480 (404,249), 800x600 (404,263), 1024x768 (404,277), 720p
  (404,292), 1080p (404,306), 1440p (404,319), the window's size (404,333); wide screen (297,253), on (404,281);
  back (38,467). In a race the same helper works (it clicks by the canvas's fractions), but the pause menu keeps
  its size in pixels, so where its buttons are depends on the mode: look first (at 720 lines quit (320,256), exit
  to game menu (320,245)).
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
- More spin loops of the same kind may exist elsewhere (found so far: 0x53C2E0, 0x5366E0, 0x567F70; 0x53BCB0
  waited for a window message). A loop
  inside one of the game's critical sections needs guest_unlock/guest_lock: guest_fair_yield skips it there.
- ConvertFile for custom pictures; FEData/Art/pic16.fsh uses code 0x6D (4444), not produced.
- README.md describes the build for others (own game copy, exact Porsche.exe hash): keep it in step with the
  scripts. Packaging for the user.
- Names left from NFSU2 in the shared runtime (NFSU2_* env variables and macros, gen/server for voodoo2z).
