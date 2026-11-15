#!/bin/bash
# vtab.sh ADDR [N] : N dwords (default 40) of Porsche.exe from an address (a vtable's functions)
cd /mnt/c/Development/NFSPU/porsche-web
.venv/bin/python -I - "$1" "${2:-40}" <<'PY'
import sys, pefile, struct
pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe', fast_load=True)
ib = pe.OPTIONAL_HEADER.ImageBase
a = int(sys.argv[1], 16); n = int(sys.argv[2])
d = pe.get_data(a - ib, 4 * n)
print(' '.join('%d:%x' % (i, struct.unpack_from('<I', d, 4 * i)[0]) for i in range(n)))
PY
