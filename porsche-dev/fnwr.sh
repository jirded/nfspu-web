#!/bin/bash
# fnwr.sh PATTERN [FROM TO] : lifted functions with a line matching the pattern (a grep -E), optionally only
# functions whose address is between FROM and TO (hex)
cd /mnt/c/Development/NFSPU/porsche-web
grep -n -E -- "$1" gen/all/shard_*.c | while IFS=: read f n rest; do
  fn=$(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')
  a=$((16#${fn#sub_}))
  if [ -z "$2" ] || { [ $a -ge $((16#$2)) ] && [ $a -le $((16#$3)) ]; }; then echo "$fn  $(echo "$rest" | sed 's/^ *//' | cut -c1-120)"; fi
done | sort | uniq | head -${N:-30}
