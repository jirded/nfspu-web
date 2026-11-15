#!/bin/bash
# esp before and after a lifted function ($FN)
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
OUT=/mnt/c/Development/NFSPU/porsche-web/out/runs/fin_$(date +%H%M%S).txt
timeout ${T:-120} gdb -q -batch -ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" -ex "set pagination off" \
  -ex "break ${FN:-sub_00a066d0}" -ex run -ex 'p/x c->esp' -ex 'p/x *(unsigned*)(g_mem + c->esp)' -ex finish -ex 'p/x c->esp' -ex 'p/x c->eip' \
  --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$OUT" 2>&1
grep -E '^\$|Run till|Value' "$OUT"
