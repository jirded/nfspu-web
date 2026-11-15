#!/bin/bash
# fnsrc.sh FUNC [grep pattern] : the lifted C of sub_FUNC (gen/all), optionally only lines matching the pattern (with context)
cd /mnt/c/Development/NFSPU/porsche-web
f=$(grep -l "^void sub_$1(CPU" gen/all/*.c | head -1)
echo "file: $f"
if [ -n "$2" ]; then awk "/^void sub_$1\(CPU/,/^}/" "$f" | grep -n -B${B:-6} -A${A:-3} -- "$2" | head -${N:-80}
else awk "/^void sub_$1\(CPU/,/^}/" "$f" | head -${N:-200}; fi
