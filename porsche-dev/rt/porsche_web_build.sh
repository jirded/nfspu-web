#!/bin/bash
# Build Porsche Unleashed for the browser: out/web/porsche.wasm
#
#   tools/porsche_web_build.sh          lifted shards (incremental) + runtime + link
#   FULL=1 tools/porsche_web_build.sh   recompile all shards
#
# Needs gen/all (Porsche.exe) and gen/server (Drivers/voodoo2z.dll, porsche-dev/gen_glide.sh) and
# wasi-sdk in deps/.  Flags as web/build.sh (NFSU2's browser build); the runtime is the shared core,
# runtime/porsche (Glide, Porsche's Win32 extras), runtime/porsche_web (entry point, frame for the page)
# and the browser parts of runtime/web (audio, input, status) minus NFSU2's renderer and network.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
WASI="${WASI:-$(ls -d "$ROOT"/deps/wasi-sdk-*-x86_64-linux 2>/dev/null | tail -1)}"
[ -x "$WASI/bin/clang" ] || { echo "wasi-sdk not found in deps/"; exit 1; }
CC="$WASI/bin/clang"; OBJDUMP="$WASI/bin/llvm-objdump"
J="${J:-$(nproc)}"
OPT="${OPT:--O3}"
OUT="$ROOT/out/web"; mkdir -p "$OUT/pobj" "$OUT/psrv" "$OUT/prt"
GUEST_END=671088640   # 0x28000000
INITIAL_MB="${INITIAL_MB:-1024}"
TARGET="--target=wasm32-wasip1-threads -pthread"
FEAT="-msimd128 -mbulk-memory -mnontrapping-fptoint -mtail-call -mexception-handling -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh=false"
DEFS="-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS"
CFLAGS="$TARGET $OPT $FEAT $DEFS -fno-delete-null-pointer-checks -include runtime/web/compat/wasm_plat.h -Iruntime/web/compat -Iruntime -Iruntime/web -Iruntime/porsche -Igen/all"
SHARDFLAGS="-DNFSU2_GUEST_OBJ"
WARN="-Wno-unused-label -Wno-parentheses-equality"
export CC OBJDUMP CFLAGS SHARDFLAGS WARN OUT FULL
export HDRSUM="$( (cat runtime/cpu.h runtime/web/compat/wasm_plat.h; echo "$CFLAGS $SHARDFLAGS") | sha1sum | cut -c1-16)"

# ---- lifted shards: content-hash incremental; a shard with a lookup table of guest addresses in its
# data (g_guest + K, which wasm-ld resolves to 0) is compiled again without jump tables (web/build.sh)
t0=$(date +%s)
{ (cd gen/all && ls shard_*.c fntab.c impargs.c | sed "s|^|all |")
  (cd gen/server && ls shard_*.c fntab.c impargs.c modinfo.c | sed "s|^|server |"); } |
  xargs -P "$J" -n 2 sh -c '
  case "$1" in all) od="$OUT/pobj" ;; *) od="$OUT/psrv" ;; esac
  src="gen/$1/$2"; obj="$od/$(basename "$2" .c).o"
  sum=$( (cat "$src" "gen/$1/decls.h"; echo "$HDRSUM") | sha1sum | cut -c1-40)
  if [ -z "$FULL" ] && [ -f "$obj" ] && [ "$(cat "$obj.sum" 2>/dev/null)" = "$sum" ]; then exit 0; fi
  o=$($CC $CFLAGS $SHARDFLAGS $WARN -I"gen/$1" -c -o "$obj" "$src" 2>&1); r=$?
  [ -z "$o" ] || printf "%s\n" "$o" | head -5
  [ $r -eq 0 ] || { echo "FAILED: $src" >&2; exit $r; }
  guestdata() { "$OBJDUMP" -r "$obj" | awk "/^RELOCATION RECORDS FOR \\[DATA\\]/ { d = 1; next } /^RELOCATION RECORDS/ { d = 0 }
    d && \$3 ~ /^g_guest[+-]/ && \$3 != \"g_guest+0\" { f = 1 } END { exit !f }"; }
  if guestdata; then
    $CC $CFLAGS $SHARDFLAGS $WARN -fno-jump-tables -I"gen/$1" -c -o "$obj" "$src" || { echo "FAILED: $src" >&2; exit 1; }
    if guestdata; then echo "FAILED: $src has guest addresses in data, without jump tables too" >&2; exit 1; fi
    echo "  $src: without jump tables (a lookup table of guest addresses)"
  fi
  echo "$sum" > "$obj.sum"' sh
echo "shards: $(( $(date +%s) - t0 )) s"

# ---- runtime
RT="mem dispatch genexec heap watchdog win32 win32_ext com vsemu debug res fileio module modheap lifecycle keyboard dinput_kbd dikeys"
WEB="audio_web gcpu input_web memchk memcmp null_platform sha256 shader_dump stackprobe status_web tz"
rm -f "$OUT"/prt/*.o "$OUT"/prt/*.err
pids=""
for f in $RT; do $CC $CFLAGS $WARN -DNFS_ENHANCED=0 -c -o "$OUT/prt/$f.o" "runtime/$f.c" 2> "$OUT/prt/$f.err" & pids="$pids $!"; done
for f in $WEB; do $CC $CFLAGS $WARN -DNFS_ENHANCED=0 -c -o "$OUT/prt/web_$f.o" "runtime/web/$f.c" 2> "$OUT/prt/web_$f.err" & pids="$pids $!"; done
$CC $TARGET $OPT $FEAT -c -o "$OUT/prt/web_thread_exit.o" runtime/web/thread_exit.c 2> "$OUT/prt/web_thread_exit.err" & pids="$pids $!"
# the Glide backend: RENDERER=gpu (default: glide_gpu.c, the page draws with WebGPU) or sw
# (glide_sw.c + fb_web.c: software, the page copies the frames onto a canvas)
RENDERER="${RENDERER:-gpu}"
case "$RENDERER" in gpu) SKIP="glide_sw fb_web"; WASMNAME=porsche.wasm ;; sw) SKIP="glide_gpu"; WASMNAME=porsche-sw.wasm ;;
  *) echo "RENDERER is gpu or sw"; exit 2 ;; esac
for f in runtime/porsche/*.c runtime/porsche_web/*.c; do
  b=$(basename "$f" .c); d=$(basename "$(dirname "$f")")
  case " $SKIP " in *" $b "*) continue ;; esac
  $CC $CFLAGS $WARN -DNFS_ENHANCED=0 -c -o "$OUT/prt/${d}_$b.o" "$f" 2> "$OUT/prt/${d}_$b.err" & pids="$pids $!"
done
fail=0
for p in $pids; do wait "$p" || fail=1; done
for e in "$OUT"/prt/*.err; do if grep -q "error" "$e"; then echo "== $(basename "$e" .err)"; grep -E "error" "$e" | head -10; fi; done
[ $fail -eq 0 ] || { echo "runtime compile FAILED"; exit 1; }

# ---- link
rm -f "$OUT/$WASMNAME"
$CC $TARGET $OPT $FEAT -o "$OUT/$WASMNAME" "$OUT"/pobj/*.o "$OUT"/psrv/*.o "$OUT"/prt/*.o \
  -Wl,--import-memory,--export-memory,--shared-memory,--max-memory=4294967296 \
  -Wl,--initial-memory=$(( INITIAL_MB * 1048576 )),--global-base=$GUEST_END \
  -Wl,-z,stack-size=$(( 8 * 1048576 )) -Wl,--no-stack-first \
  -Wl,--error-limit=0 -lsetjmp -lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks > "$OUT/porsche-link.log" 2>&1 || true
if [ ! -f "$OUT/$WASMNAME" ]; then
  echo "link FAILED ($(grep -c "undefined symbol" "$OUT/porsche-link.log") undefined symbols):"
  grep -oE "undefined symbol: [A-Za-z0-9_]+" "$OUT/porsche-link.log" | sort | uniq -c | sort -rn | head -120
  grep -E "error" "$OUT/porsche-link.log" | grep -v "undefined symbol" | head -10
  exit 1
fi
echo "link OK: out/web/$WASMNAME ($(( $(stat -c %s "$OUT/$WASMNAME") / 1048576 )) MB, $RENDERER renderer)"
grep -A2 "signature mismatch" "$OUT/porsche-link.log" | head -20 || true
