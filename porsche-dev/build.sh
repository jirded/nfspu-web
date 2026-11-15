#!/bin/bash
"$(dirname "$0")/install_rt.sh" | grep -v "^runtime/linux"
cd /mnt/c/Development/NFSPU/porsche-web
.venv/bin/python tools/argcount.py /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > out/argcount.log 2>&1 || { tail -3 out/argcount.log; exit 1; }
tools/porsche_native.sh 2>&1 | tail -${TAILN:-120}
