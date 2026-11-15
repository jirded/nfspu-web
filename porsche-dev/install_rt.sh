#!/bin/bash
# copy the Porsche files from the Windows scratchpad into the repo, apply the runtime patches
set -e
SRC="$(dirname "$0")/rt"
cd /mnt/c/Development/NFSPU/porsche-web
mkdir -p runtime/linux/compat runtime/porsche runtime/porsche_web
cp -r runtime/web/compat/mach runtime/web/compat/pthread runtime/web/compat/sys runtime/web/compat/libproc.h runtime/linux/compat/
mkdir -p runtime/linux/compat/os
cp "$SRC"/linux/compat/os/lock.h runtime/linux/compat/os/lock.h
rm -f runtime/linux/porsche_stubs.c
cp "$SRC"/linux/linux_plat.h "$SRC"/linux/*.c runtime/linux/
cp "$SRC"/porsche/*.c "$SRC"/porsche/*.h runtime/porsche/
cp "$SRC"/porsche_web/*.c "$SRC"/porsche_web/*.h runtime/porsche_web/
cp "$SRC"/porsche_native.sh tools/porsche_native.sh
cp "$SRC"/porsche_web_build.sh tools/porsche_web_build.sh
cp "$SRC"/porsche_lift.sh tools/porsche_lift.sh
cp "$SRC"/porsche_glide_lift.sh tools/porsche_glide_lift.sh
chmod +x tools/porsche_native.sh tools/porsche_web_build.sh tools/porsche_lift.sh tools/porsche_glide_lift.sh
for p in "$SRC"/patch_rt*.py; do [ -f "$p" ] && python3 -I "$p"; done
