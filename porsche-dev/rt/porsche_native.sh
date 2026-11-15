#!/bin/bash
# Native Linux, headless build of the recompiled Porsche.exe: out/native/porsche_boot
#
#   tools/porsche_native.sh            shards (incremental) + runtime + link
#   OPT=-O2 tools/porsche_native.sh    another optimisation level (default -O1 -g)
#   FULL=1 ...                         recompile all shards
#
# Needs gen/all from tools/genall.py on Porsche.exe.  The runtime is the shared
# NFSU2 runtime's generic core (CPU, memory, dispatch, heap, Win32, files,
# Winsock, COM) plus runtime/web/null_platform.c (headless stand-ins) and
# runtime/linux (Linux stand-ins for the macOS APIs, the entry point).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
CC="${CC:-clang}"
OPT="${OPT:--O1 -g}"
J="${J:-$(nproc)}"
OUT="$ROOT/out/native"; mkdir -p "$OUT/obj" "$OUT/srv" "$OUT/rt"
COMMON="-fno-delete-null-pointer-checks -fwrapv -include runtime/linux/linux_plat.h -Iruntime/linux/compat -Iruntime -Iruntime/porsche -Igen/all"
WARN="-Wno-unused-label -Wno-parentheses-equality -Wno-unused-value -Wno-incompatible-pointer-types"

# ---- second guest module: none (server.dll is NFSU2's) -> the stub gen.sh writes
if [ ! -f gen/server/fntab.c ]; then
  mkdir -p gen/server
  printf '#include "module.h"\nconst ModInfo g_srv_modinfo = { "server.dll", "", 0x00a00000u, 0, 0, 0, 0, 0, 0 };\n' > gen/server/modinfo.c
  printf '#include "cpu.h"\ntypedef void(*guest_fn)(CPU*);\nconst uint32_t g_srv_fn_count = 0;\nconst uint32_t g_srv_fn_addr[1] = {0};\nconst guest_fn g_srv_fn_ptr[1] = {0};\n' > gen/server/fntab.c
  printf '#include <stdint.h>\ntypedef struct { uint32_t iat; const char*dll; const char*name; int nargs; } ImpEnt;\nconst uint32_t g_srv_imp_count = 0;\nconst ImpEnt g_srv_imp[1] = {{0}};\n' > gen/server/impargs.c
  printf '#ifndef DECLS_H\n#define DECLS_H\n#include "cpu.h"\n#endif\n' > gen/server/decls.h
  echo "gen/server: stub module"
fi

# ---- lifted shards (content-hash incremental)
export CC OPT COMMON WARN OUT FULL
export HDRSUM="$( (cat runtime/cpu.h runtime/linux/linux_plat.h; echo "$OPT $COMMON") | sha1sum | cut -c1-16)"
t0=$(date +%s)
{ (cd gen/all && ls shard_*.c fntab.c impargs.c | sed "s|^|all |")
  (cd gen/server && ls $(ls shard_*.c 2>/dev/null) $( [ -f stubs.c ] && echo stubs.c ) fntab.c impargs.c modinfo.c | sed "s|^|server |"); } |
  xargs -P "$J" -n 2 sh -c '
  case "$1" in all) od="$OUT/obj" ;; *) od="$OUT/srv" ;; esac
  src="gen/$1/$2"; obj="$od/$(basename "$2" .c).o"
  sum=$( (cat "$src" "gen/$1/decls.h"; echo "$HDRSUM") | sha1sum | cut -c1-40)
  if [ -z "$FULL" ] && [ -f "$obj" ] && [ "$(cat "$obj.sum" 2>/dev/null)" = "$sum" ]; then exit 0; fi
  o=$($CC $OPT $COMMON $WARN -I"gen/$1" -c -o "$obj" "$src" 2>&1); r=$?
  [ -z "$o" ] || printf "%s\n" "$o" | head -5
  [ $r -eq 0 ] || { echo "FAILED: $src" >&2; exit $r; }
  echo "$sum" > "$obj.sum"' sh
echo "shards: $(( $(date +%s) - t0 )) s"

# ---- runtime: the generic core + headless stand-ins + Linux entry point
# not here: winsock (BSD sockets of the Mac), dinput_pad (overrides NFSU2 functions
# whose addresses are unrelated Porsche code) -> runtime/linux/porsche_stubs.c
RT="${RT:-mem dispatch genexec heap watchdog win32 win32_ext com vsemu debug res fileio module modheap lifecycle keyboard dinput_kbd dikeys}"
rm -f "$OUT"/rt/*.o "$OUT"/rt/*.err
pids=""
for f in $RT; do
  $CC $OPT $COMMON $WARN -DNFS_ENHANCED=0 -c -o "$OUT/rt/$f.o" "runtime/$f.c" 2> "$OUT/rt/$f.err" & pids="$pids $!"
done
for f in ${RTWEB:-null_platform sha256}; do
  $CC $OPT $COMMON $WARN -DNFS_ENHANCED=0 -c -o "$OUT/rt/web_$f.o" "runtime/web/$f.c" 2> "$OUT/rt/web_$f.err" & pids="$pids $!"
done
for f in runtime/linux/*.c runtime/porsche/*.c; do
  b=$(basename "$f" .c); d=$(basename "$(dirname "$f")")
  $CC $OPT $COMMON $WARN -DNFS_ENHANCED=0 -c -o "$OUT/rt/${d}_$b.o" "$f" 2> "$OUT/rt/${d}_$b.err" & pids="$pids $!"
done
fail=0
for p in $pids; do wait "$p" || fail=1; done
for e in "$OUT"/rt/*.err; do
  if grep -q "error" "$e"; then echo "== $(basename "$e" .err)"; grep -E "error" "$e" | head -12; fi
done
[ $fail -eq 0 ] || { echo "runtime compile FAILED"; exit 1; }

# ---- link
rm -f "$OUT/porsche_boot"
$CC $OPT -o "$OUT/porsche_boot" "$OUT"/obj/*.o "$OUT"/srv/*.o "$OUT"/rt/*.o -lm -lpthread 2> "$OUT/link.log" || true
if [ ! -x "$OUT/porsche_boot" ]; then
  n=$(grep -c "undefined reference" "$OUT/link.log" || true)
  echo "link FAILED ($n undefined references); distinct symbols:"
  grep -oE "undefined reference to .[A-Za-z0-9_]+" "$OUT/link.log" | sed -E "s/undefined reference to .//" | sort | uniq -c | sort -rn > "$OUT/undefined.txt"
  wc -l < "$OUT/undefined.txt"; head -80 "$OUT/undefined.txt"
  grep -vE "undefined reference|ld returned|more undefined" "$OUT/link.log" | head -20
  exit 1
fi
echo "link OK: out/native/porsche_boot ($(( $(stat -c %s "$OUT/porsche_boot") / 1048576 )) MB)"
