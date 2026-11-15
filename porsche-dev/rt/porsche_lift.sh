#!/bin/bash
# Lift Porsche.exe (NFS Porsche Unleashed v3.5) to C: gen/all, one C function per guest function.
#
#   tools/porsche_lift.sh [path/to/Porsche.exe]
#
# 1. tools/reloc_dir.py: out/relocs.txt from the exe's base-relocation directory.
# 2. tools/genall.py: gen/all. OVERRIDE: the guest functions the runtime replaces
#    (runtime/porsche/porsche_hle.c); the lifted original of each is sub_XXXXXXXX_orig.
# 3. tools/argcount.py: gen/all/impargs.c (the argument count of every import).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
EXE="${1:-$ROOT/../games/porsche/Porsche.exe}"
[ -f "$EXE" ] || { echo "Porsche.exe not found: $EXE"; exit 1; }
mkdir -p out
.venv/bin/python tools/reloc_dir.py "$EXE" > out/reloc_dir.log 2>&1 || { tail -5 out/reloc_dir.log; exit 1; }
OVERRIDE=53c2e0,5366e0,567f70,5391b0,467fc0,4bc710,5a0fbf,4152e0,4d9450,53bcb0,439f90 X87PC=1 .venv/bin/python tools/genall.py "$EXE" 64 > out/genall.log 2>&1 || { tail -20 out/genall.log; exit 1; }
sed -n '/GENERATION SUMMARY/,/^$/p' out/genall.log
grep 'override' out/genall.log || true
.venv/bin/python tools/argcount.py "$EXE" > out/argcount.log 2>&1 || { tail -3 out/argcount.log; exit 1; }
tail -1 out/argcount.log
