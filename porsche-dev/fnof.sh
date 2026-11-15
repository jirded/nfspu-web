#!/bin/bash
# fnof.sh ADDR : the lifted function whose body has the label L_ADDR (8 hex digits, no 0x)
cd /mnt/c/Development/NFSPU/porsche-web
f=$(grep -l "L_$1:" gen/all/shard_*.c | head -1)
[ -z "$f" ] && { echo "no label L_$1"; exit 1; }
n=$(grep -n "L_$1:" "$f" | head -1 | cut -d: -f1)
echo "$f: $(head -n "$n" "$f" | grep '^void sub_' | tail -1)"
