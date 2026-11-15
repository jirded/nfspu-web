#!/bin/bash
# imports.sh [PATTERN] : the functions Porsche.exe imports (dll!name), optionally those matching the pattern
cd /mnt/c/Development/NFSPU/porsche-web
.venv/bin/python -I - "${1:-}" <<'PY'
import sys, re, pefile
pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe')
for d in pe.DIRECTORY_ENTRY_IMPORT:
    for i in d.imports:
        n = '%s!%s' % (d.dll.decode(), i.name.decode() if i.name else '#%d' % i.ordinal)
        if not sys.argv[1] or re.search(sys.argv[1], n, re.I): print(n)
PY
