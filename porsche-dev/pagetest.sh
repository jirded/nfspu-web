#!/bin/bash
# the page's unit tests: copy the page sources into the repo (webpage.sh copy), then
# node --test web-porsche/test/*.test.mjs.  Arguments go to node --test.
set -e
bash "$(dirname "$0")/webpage.sh" copy
export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"
cd /mnt/c/Development/NFSPU/porsche-web
node --test "$@" web-porsche/test/*.test.mjs
