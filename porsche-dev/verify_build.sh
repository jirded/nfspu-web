#!/bin/bash
# Rebuilds everything from scratch (lift Porsche.exe and voodoo2z.dll, full wasm build, full native
# build, the page) and compares the outputs with a snapshot.
#   verify_build.sh snap     record checksums of gen/, porsche.wasm and the page into out/verify_*.txt
#   verify_build.sh check    rebuild all, then compare with the snapshot
set -eo pipefail
cd /mnt/c/Development/NFSPU/porsche-web
export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"
EXE=/mnt/c/Development/NFSPU/games/porsche/Porsche.exe
sums() {
  (cd gen && find all server -type f | sort | xargs -d '\n' sha1sum) > "out/verify_$1_gen.txt"
  sha256sum out/web/porsche.wasm web-porsche/dist/*.js web-porsche/dist/*/*.js > "out/verify_$1_out.txt"
}
case "$1" in
  snap) sums before; wc -l out/verify_before_gen.txt; cat out/verify_before_out.txt ;;
  check)
    t0=$(date +%s)
    echo "== install_rt"; bash porsche-dev/install_rt.sh
    echo "== lift Porsche.exe (relocs, genall, argcount)"; rm -f out/relocs.txt; tools/porsche_lift.sh "$EXE"
    sha256sum out/relocs.txt | diff - out/verify_before_relocs.txt && echo "relocs identical" || echo "relocs DIFFER"
    echo "== lift voodoo2z.dll"; bash porsche-dev/gen_glide.sh | tail -3
    echo "== wasm (full)"; FULL=1 tools/porsche_web_build.sh 2>&1 | tail -4
    echo "== native (full)"; FULL=1 tools/porsche_native.sh 2>&1 | tail -3
    echo "== page"; node web-porsche/build.mjs 2>&1 | tail -2
    sums after
    echo "== gen diff"; diff out/verify_before_gen.txt out/verify_after_gen.txt && echo "gen identical ($(wc -l < out/verify_after_gen.txt) files)" || echo "gen DIFFERS"
    echo "== outputs diff"; diff out/verify_before_out.txt out/verify_after_out.txt && echo "wasm and page identical" || echo "outputs DIFFER"
    echo "total $(( $(date +%s) - t0 )) s" ;;
  *) echo "snap | check"; exit 2 ;;
esac
