#!/bin/bash
# fnstr.sh FUNC : string constants a lifted function pushes (PUSH32 / mov of an address in .rdata/.data that holds text)
cd /mnt/c/Development/NFSPU/porsche-web
f=$(grep -l "^void sub_$1(CPU" gen/all/*.c | head -1)
awk "/^void sub_$1\(CPU/,/^}/" "$f" | grep -oE '0x5[cdef][0-9a-f]{4}u' | sort -u | tr -d u | while read a; do
  s=$(/mnt/c/Development/NFSPU/porsche-web/.venv/bin/python - "$a" <<'PY'
import sys, pefile
pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe', fast_load=True)
a = int(sys.argv[1], 16) - pe.OPTIONAL_HEADER.ImageBase
try:
    b = pe.get_data(a, 80)
    t = b.split(b'\0')[0]
    if len(t) >= 3 and all(32 <= c < 127 for c in t): print(t.decode())
except Exception: pass
PY
)
  [ -n "$s" ] && echo "$a  $s"
done
