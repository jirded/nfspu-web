#!/bin/bash
cd /mnt/c/Development/NFSPU/games/porsche
mkdir -p /mnt/c/Development/NFSPU/porsche-web/out/runs
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/run_$(date +%H%M%S).log
VERBOSE=1 timeout -s INT ${T:-60} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "exit: $?   log: $LOG   lines: $(wc -l < "$LOG")"
head -${HEADN:-60} "$LOG"
echo ......
tail -${TAILN:-60} "$LOG"
