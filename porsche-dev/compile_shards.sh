#!/bin/bash
# Compile only the lifted shards with the web build's flags (web/build.sh), no runtime/link.
set -e
cd /mnt/c/Development/NFSPU/porsche-web
WASI=$(ls -d deps/wasi-sdk-*-x86_64-linux | tail -1)
export CC="$WASI/bin/clang"
TARGET="--target=wasm32-wasip1-threads -pthread"
FEAT="-msimd128 -mbulk-memory -mnontrapping-fptoint -mtail-call -mexception-handling -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh=false"
DEFS="-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS"
export CFLAGS="$TARGET ${OPT:--O3} $FEAT $DEFS -fno-delete-null-pointer-checks -include runtime/web/compat/wasm_plat.h -Iruntime/web/compat -Iruntime -Igen/all -DNFSU2_GUEST_OBJ -Wno-unused-label -Wno-parentheses-equality"
mkdir -p out/web/obj
rm -f out/web/obj/*.o out/web/obj/*.err
start=$(date +%s)
ls gen/all/*.c | xargs -P "$(nproc)" -n 1 sh -c 'f="$1"; b=$(basename "$f" .c); $CC $CFLAGS -c -o out/web/obj/$b.o "$f" 2> out/web/obj/$b.err || echo "FAILED $f"' sh
end=$(date +%s)
echo "time: $((end-start)) s"
echo "objects: $(ls out/web/obj/*.o 2>/dev/null | wc -l) of $(ls gen/all/*.c | wc -l)"
du -ch out/web/obj/*.o | tail -1
for e in out/web/obj/*.err; do [ -s "$e" ] && { echo "== $e"; head -8 "$e"; }; done | head -60
