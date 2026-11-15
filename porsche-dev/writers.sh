#!/bin/bash
# writers.sh ADDR... : lifted functions that write the dword at each address (MR32(0xADDRu) = ... or +=)
cd /mnt/c/Development/NFSPU/porsche-web
for a in "$@"; do
  echo "== $a"
  grep -n "MR32(0x${a}u) *[-+|&^]\?= " gen/all/shard_*.c | while IFS=: read f n rest; do
    fn=$(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')
    echo "$fn  $(echo "$rest" | sed 's/^ *//' | cut -c1-90)"
  done | sort | uniq | head -12
done
