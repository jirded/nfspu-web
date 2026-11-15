#!/bin/bash
# short run with GLIDE_LOG=1: the first Glide calls
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/glog_$(date +%H%M%S).log
GLIDE_LOG=1 VERBOSE=1 TRACE_MAX=${TM:-400} timeout ${T:-25} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "log $LOG"
grep -E "${PAT:-\[glide\]|glide3x|GetProcAddress|LoadLibrary|DDRAW|STUB}" "$LOG" | head -${N:-60}
