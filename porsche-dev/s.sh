#!/bin/bash
# declarations of the symbols porsche.wasm's link misses
cd /mnt/c/Development/NFSPU/porsche-web
for s in $(grep -oE "undefined symbol: [A-Za-z0-9_]+" out/web/porsche-link.log | awk '{print $3}' | sort -u); do
  d=$(grep -rhoE "^[^#/]*[^A-Za-z0-9_]$s[[:space:]]*(\(|\[|;|=)[^;{]*[;{]?" runtime/*.c runtime/*.h runtime/web/*.c runtime/web/*.h 2>/dev/null \
      | grep -vE "^\s*(return|if|else|for|while)\b" | sed -E 's/^\s+//' | sort | uniq -c | sort -rn | head -1 | sed -E 's/^\s*[0-9]+ //')
  w=$(grep -lE "^[a-zA-Z].*[^a-zA-Z0-9_]$s[[:space:]]*\(" runtime/*.c runtime/web/*.c 2>/dev/null | tr '\n' ' ')
  echo "$s | $d | def: $w"
done
