#!/bin/bash
# install the runtime files and patches, then build porsche.wasm
"$(dirname "$0")/install_rt.sh" | grep -v "^already"
cd /mnt/c/Development/NFSPU/porsche-web && tools/porsche_web_build.sh 2>&1 | tail -${TAILN:-80}
