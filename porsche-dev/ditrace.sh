#!/bin/bash
# which DirectInput methods the game calls in the menu (native, COMTRACE)
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/di_$(date +%H%M%S).log
COMTRACE=1 timeout ${T:-90} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "log $LOG"
grep -oE "IDirectInput[A-Za-z0-9]*::[A-Za-z]+ +\([0-9] arg\) -> 0x[0-9a-f]+" "$LOG" | sort | uniq -c | sort -rn | head -30
grep -n "\[input\]\|\[DI\]\|\[kbd\]" "$LOG" | head -20
