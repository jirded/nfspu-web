#!/bin/bash
# copy the page sources into the repo and build them (web-porsche/dist)
#   webpage.sh        copy and build
#   webpage.sh copy   copy only (pagetest.sh)
set -e
SRC="$(dirname "$0")/web-porsche"
DST=/mnt/c/Development/NFSPU/porsche-web/web-porsche
export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"
mkdir -p "$DST/src" "$DST/test"
cp "$SRC"/index.html "$SRC"/build.mjs "$SRC"/server.mjs "$DST"/
[ -f "$SRC/style.css" ] && cp "$SRC/style.css" "$DST"/
[ -f "$SRC/mouse-latency.js" ] && cp "$SRC/mouse-latency.js" "$DST"/
rm -f "$DST"/src/*.ts "$DST"/test/*.mjs
cp "$SRC"/src/*.ts "$DST"/src/
ls "$SRC"/test/*.mjs > /dev/null 2>&1 && cp "$SRC"/test/*.mjs "$DST"/test/
[ "$1" = copy ] && exit 0
cd /mnt/c/Development/NFSPU/porsche-web && node web-porsche/build.mjs 2>&1 | tail -12
ls -la web-porsche/dist web-porsche/dist/host web-porsche/dist/audio | grep -v '^total'
