#!/bin/bash
# copy the page sources into the repo and build them (web-porsche/dist)
set -e
SRC="$(dirname "$0")/web-porsche"
export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"
mkdir -p /mnt/c/Development/NFSPU/porsche-web/web-porsche/src
cp "$SRC"/index.html "$SRC"/build.mjs "$SRC"/server.mjs /mnt/c/Development/NFSPU/porsche-web/web-porsche/
cp "$SRC"/src/*.ts /mnt/c/Development/NFSPU/porsche-web/web-porsche/src/
cd /mnt/c/Development/NFSPU/porsche-web && node web-porsche/build.mjs 2>&1 | tail -12
ls -la web-porsche/dist web-porsche/dist/host web-porsche/dist/audio | grep -v '^total'
