#!/bin/bash
cd /mnt/c/Development/NFSPU/porsche-web/runtime
for f in *.c *.m *.h web/*.c web/*.h; do
  n=$(grep -cE 'GA\(0x|sub_[0-9a-f]{8}|0x00[4-9a-f][0-9a-f]{5}u?' "$f")
  l=$(wc -l < "$f")
  printf '%5d %6d %s\n' "$n" "$l" "$f"
done | sort -n
