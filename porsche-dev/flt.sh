#!/bin/bash
# flt.sh ADDR... : the float (and dword) Porsche.exe holds at each address (hex, no 0x)
cd /mnt/c/Development/NFSPU/porsche-web
.venv/bin/python -I - "$@" <<'PY'
import sys, pefile, struct
pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe', fast_load=True)
ib = pe.OPTIONAL_HEADER.ImageBase
for a in sys.argv[1:]:
    d = pe.get_data(int(a, 16) - ib, 8)
    print(a, 'f32', struct.unpack('<f', d[:4])[0], 'u32', hex(struct.unpack('<I', d[:4])[0]), 'f64', struct.unpack('<d', d)[0])
PY
