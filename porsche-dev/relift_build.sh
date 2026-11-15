#!/bin/bash
# install the runtime files, lift Porsche.exe again (relocs, overrides, argcount), then the wasm build
set -e
D="$(dirname "$0")"
bash "$D/install_rt.sh" | grep -v '^already\|^runtime/linux' || true
cd /mnt/c/Development/NFSPU/porsche-web
rm -rf gen/all_test
tools/porsche_lift.sh /mnt/c/Development/NFSPU/games/porsche/Porsche.exe
grep -c '_orig' gen/all/decls.h
t0=$(date +%s)
tools/porsche_web_build.sh 2>&1 | tail -6
echo "web build: $(( $(date +%s) - t0 )) s"
