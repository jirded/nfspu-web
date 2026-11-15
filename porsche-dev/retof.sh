#!/bin/bash
# retof.sh ADDR... : the lifted function that makes the call returning to each address (PUSH32(0xADDRu) before a call)
cd /mnt/c/Development/NFSPU/porsche-web
for a in "$@"; do
  f=$(grep -l "PUSH32(0x${a}u)" gen/all/shard_*.c | head -1)
  [ -z "$f" ] && { echo "$a: not found"; continue; }
  n=$(grep -n "PUSH32(0x${a}u)" "$f" | head -1 | cut -d: -f1)
  echo "$a: $(head -n "$n" "$f" | grep '^void sub_' | tail -1 | grep -o 'sub_[0-9a-f]*')"
done
