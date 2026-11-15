#!/bin/bash
# readers.sh ADDR... : lifted functions that mention each address at all (reads and writes), with the line
cd /mnt/c/Development/NFSPU/porsche-web
for a in "$@"; do
  echo "== $a"
  grep -n "0x${a}u" gen/all/shard_*.c | while IFS=: read f n rest; do
    fn=$(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')
    echo "$fn  $(echo "$rest" | sed 's/^ *//' | cut -c1-${W:-110})"
  done | sort | uniq | head -${N:-30}
done
