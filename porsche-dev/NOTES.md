# NFS Porsche Unleashed in the browser: project notes (state 2026-10-31)

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
  9i virtual clock at real speed in long stalls | 9j release stuck modifiers (Alt).
- web-porsche/ -> repo web-porsche/: index.html; src/main.ts (page: startProcess, audio, input, ticker worker,
  WebGPU or software; URL options ?env=K=V, ?wasm=, ?trace=, ?scale=; log POST /log); src/glide-gpu.ts (WebGPU
  renderer, WGSL uber-shader, pipeline cache); src/ticker.ts; build.mjs (esbuild); server.mjs (Node server).

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
- Page: webpage.sh (copies web-porsche into the repo, runs node web-porsche/build.mjs).
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
- Tabs share the OPFS save folder porsche-save: do not run two games at once. The user may be playing in another tab.
- Do not take the user's own play for a test result: verify with controlled input and the key log.

## Open items / ideas
- The user's profile OGD is broken (SaveData/4OGD.sav truncated to 56 KB by the earlier freeze): remove it in the game
  and create a new one. Test profile TEST exists in OPFS (can be removed).
- Not tested: a race to the finish, other tracks and modes (career, knockout, factory driver), replays, options,
  gamepad/wheel, multiplayer (Winsock), long sessions, weaker machines, Firefox/Safari.
- More spin loops of the same kind may exist elsewhere.
- ConvertFile for custom pictures; FEData/Art/pic16.fsh uses code 0x6D (4444), not produced.
- README.md describes the build for others (own game copy, exact Porsche.exe hash): keep it in step with the
  scripts. Packaging for the user.
- Names left from NFSU2 in the shared runtime (NFSU2_* env variables and macros, gen/server for voodoo2z).
