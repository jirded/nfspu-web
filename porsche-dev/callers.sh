#!/bin/bash
# callers.sh FUNC... : the lifted functions that call sub_FUNC (gen/all), with the return address pushed
cd /mnt/c/Development/NFSPU/porsche-web
for a in "$@"; do
  echo "== $a"
  grep -n "sub_$a(c)" gen/all/shard_*.c | grep -v '^[^:]*:[0-9]*:void ' | while IFS=: read f n rest; do
    fn=$(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')
    echo "$fn  $(echo "$rest" | grep -o 'PUSH32(0x[0-9a-f]*u)' | head -1)"
  done | sort | uniq | head -${N:-30}
done
