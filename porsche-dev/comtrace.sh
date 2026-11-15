#!/bin/bash
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/com_$(date +%H%M%S).log
COMTRACE=1 timeout ${T:-60} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "exit $? log $LOG"
grep -iE "${PAT:-EnumDevices|QueryInterface|CreateDevice|\[DI\]|IDirectInput}" "$LOG" | head -${N:-40}
