#!/bin/bash
cd /mnt/c/Development/NFSPU/games/porsche
for f in FEData/Art/ALLdrivr.fsh FEData/Art/pic16.fsh GameData/DashHud/pic16.fsh SaveData/pic16.fsh; do
  echo "== $f $(stat -c %s "$f")"
  /mnt/c/Development/NFSPU/porsche-web/.venv/bin/python -I /mnt/c/Development/NFSPU/porsche-web/porsche-dev/fsh_info.py "$f" | head -14
done
