#!/bin/bash
# Lift Drivers/voodoo2z.dll (the game's Glide "thrash" driver) to C as the second guest module,
# at 0x00A00000: gen/server, symbol prefix srv_ (the slot NFSU2's server.dll had).
#
#   tools/porsche_glide_lift.sh [path/to/Drivers/voodoo2z.dll]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
DLL="${1:-$ROOT/../games/porsche/Drivers/voodoo2z.dll}"
[ -f "$DLL" ] || { echo "voodoo2z.dll not found: $DLL"; exit 1; }
mkdir -p out/server gen/server
find gen/server/ -mindepth 1 -delete
.venv/bin/python tools/prepare_module.py "$DLL" 0x00A00000 out/server gen/server srv_
GENOUT=gen/server RELOCS=out/server/relocs.txt SEEDS=out/server/seeds.txt SYMPFX=srv_ OVERRIDE= HOOKS= X87PC=1 \
  .venv/bin/python tools/genall.py out/server/image.dll 8 > out/server/genall.log 2>&1 || { tail -20 out/server/genall.log; exit 1; }
sed -n '/GENERATION SUMMARY/,$p' out/server/genall.log
grep -ho 'unsupported_insn(c, *0x[0-9a-f]*u*, *"[^"]*"' gen/server/shard_*.c | sort -u | head -20
RELOCS=out/server/relocs.txt IMPOUT=gen/server/impargs.c SYMPFX=srv_ STRICT=${STRICT:-1} IMPDLL="$DLL" \
  .venv/bin/python tools/argcount.py out/server/image.dll > out/server/argcount.log 2>&1 || { tail -3 out/server/argcount.log; exit 1; }
tail -2 out/server/argcount.log
