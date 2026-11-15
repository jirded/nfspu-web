#!/bin/bash
# fnctx.sh PATTERN FUNC... : in each sub_FUNC, the lines around the ones matching the pattern (flag lines left out)
cd /mnt/c/Development/NFSPU/porsche-web/porsche-dev
p="$1"; shift
for f in "$@"; do echo "== $f"; B=${B:-4} A=${A:-14} N=${N:-40} bash fnsrc.sh "$f" "$p" | grep -v 'FLAGS_\|goto \|^file\|L_.*:;' | cut -c1-${W:-150}; done
