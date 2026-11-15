#!/bin/bash
# strref.sh TEXT : where the text is in Porsche.exe (every address it starts at) and the lifted functions that
# name one of those addresses (gen/all)
cd /mnt/c/Development/NFSPU/porsche-web
.venv/bin/python -I - "$1" <<'PY' > out/strref.tmp
import sys, pefile
pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe', fast_load=True)
t = sys.argv[1].encode()
ib = pe.OPTIONAL_HEADER.ImageBase
for s in pe.sections:
    d = s.get_data(); i = d.find(t)
    while i >= 0:
        print('%x' % (ib + s.VirtualAddress + i))
        i = d.find(t, i + 1)
PY
for a in $(cat out/strref.tmp); do
  echo "== \"$1\" at 0x$a"
  grep -n "0x00${a}u\|0x${a}u" gen/all/shard_*.c | while IFS=: read f n rest; do
    fn=$(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')
    echo "$fn  $(echo "$rest" | sed 's/^ *//' | cut -c1-110)"
  done | sort | uniq | head -${N:-12}
done
