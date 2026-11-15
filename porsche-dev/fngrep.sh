#!/bin/bash
# fngrep.sh PATTERN : the lifted functions (gen/all) with a line matching the pattern, and how many such lines
cd /mnt/c/Development/NFSPU/porsche-web
grep -n -- "$1" gen/all/shard_*.c | while IFS=: read f n rest; do
  head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*'
done | sort | uniq -c | head -${N:-60}
