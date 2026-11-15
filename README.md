# Need for Speed: Porsche Unleashed in the browser

A fan project that runs the PC game *Need for Speed: Porsche Unleashed* (2000, v3.5) in Google Chrome. The game's
x86 code is translated to C ahead of time and compiled to WebAssembly. The game's 3dfx Glide 3 renderer runs on
WebGPU, the sound on Web Audio. You bring your own copy of the game.

> Not affiliated with or endorsed by Electronic Arts. This repository contains none of the game's code or data.

## Status

Work in progress. Boot, intro, profiles, menus, the 3D garage and a quick race (Cote d'Azur, with opponents, HUD and
sound) run at about 60 fps in Chrome. Keyboard and mouse work. Not tested yet: a race to the finish, the other tracks
and modes (career, knockout, factory driver), replays, options, gamepads and wheels, multiplayer, Firefox and Safari.

## What you need

- **The game:** your own PC copy, version 3.5, with this exact `Porsche.exe` (other versions will not work):
  2,129,965 bytes, SHA-256 `96af10308b12840c7a0770ff87443a8516c3b756f34d2bc276988cc64f56b98c`,
  and `Drivers/voodoo2z.dll` (the Glide driver): 135,168 bytes,
  SHA-256 `ddf9e6a6fa7b0c783d993e2a7b82ed3cde43ff818790fe671b3a108041ff01db`.
- **To build:** Linux or WSL 2 on Windows, Python 3, Node.js 20 or newer, and
  [wasi-sdk](https://github.com/WebAssembly/wasi-sdk/releases) 34 for x86_64 Linux unpacked into `deps/`.
  The optional native headless build also needs clang.
- **To play:** the latest Google Chrome (WebGPU).

## Build

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm ci)                                               # esbuild for the page

tools/porsche_lift.sh "/path/to/Porsche Unleashed/Porsche.exe"   # the game's code to C (gen/all)
tools/porsche_glide_lift.sh "/path/to/Porsche Unleashed/Drivers/voodoo2z.dll"   # the Glide driver (gen/server)
tools/porsche_web_build.sh                                       # out/web/porsche.wasm
node web-porsche/build.mjs                                       # the page (web-porsche/dist)
```

The generated C and the compiled module are made from the game, so they are never committed (`.gitignore`).
`RENDERER=sw tools/porsche_web_build.sh` builds a software-rendered module instead (`out/web/porsche-sw.wasm`,
open the page with `?wasm=/porsche-sw.wasm`). `tools/porsche_native.sh` builds a native headless Linux binary
(`out/native/porsche_boot`) for debugging.

## Play

```sh
node web-porsche/server.mjs --data "/path/to/Porsche Unleashed" --port 8080
```

Open **http://localhost:8080/** in Chrome and press **Play**. Saves are kept in the browser (OPFS). The game pauses
while its tab is in the background.

Page options (URL query): `?env=NAME=value` sets a runtime variable, for example `PORSCHE_PROF=1` (an import
profile every 10 s), `NFSU2_KEY_LOG=1` (a key log) or `NFSU2_WATCHDOG=20` (a stall report after 20 s);
`?scale=N` draws at N times the game's resolution (by default as fits the window, up to 4).

## How it works

- **`tools/`:** a Python lifter (Capstone) turns every function of `Porsche.exe` and `voodoo2z.dll` into C.
- **`runtime/`:** Windows, DirectSound and DirectInput, reimplemented. `runtime/porsche/` holds Glide 3 (state,
  texture memory, LFB, a software rasterizer), the game's extra Win32 calls, `gimme.dll`'s image converter and the
  overrides of a few game functions. `runtime/porsche_web/` is the browser entry point and the WebGPU command
  recorder, `runtime/web/` the browser audio and input, `runtime/linux/` the native headless entry point.
- **`web-porsche/`:** the page. It runs the game's threads as workers on one shared memory, draws the Glide
  commands with WebGPU (one WGSL uber-shader) and plays sound through an AudioWorklet. `web/src/` holds the shared
  host workers, audio and input it uses. `server.mjs` serves the page, the module and your game folder.
- **`porsche-dev/`:** the development scripts (build, debugging with gdb, disassembly, log tools), the runtime
  patches (`rt/patch_rt*.py`) and the notes (`NOTES.md`): root causes fixed so far, how to debug a freeze.

## Credits

Built on [nfsu2-web](https://github.com/th0mk/nfsu2-web) by th0mk (Need for Speed: Underground 2 in the browser),
itself built on the recompiler and runtime of Talha Müderrisoğlu (NFSU2Recomp). MIT licence, see [LICENSE](LICENSE).
