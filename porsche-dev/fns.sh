#!/bin/bash
# fns.sh FUNC... : the lifted C of each sub_FUNC without the flag and goto lines (a quick read of small functions)
cd /mnt/c/Development/NFSPU/porsche-web/porsche-dev
for f in "$@"; do echo "== $f"; N=${N:-60} bash fnsrc.sh "$f" | grep -v 'FLAGS_\|goto \|^file\|^L_' | cut -c1-${W:-170}; done
