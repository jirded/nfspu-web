#!/bin/bash
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/gdbr_$(date +%H%M%S).log
timeout ${T:-180} gdb -q -batch \
  -ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" \
  -ex "set pagination off" \
  -ex run \
  -ex "p/x c->eax" -ex "p/x c->ebx" -ex "p/x c->ecx" -ex "p/x c->edx" -ex "p/x c->esi" -ex "p/x c->edi" -ex "p/x c->ebp" -ex "p/x c->esp" \
  -ex "p/x *(unsigned int(*)[12])(g_mem + c->esp)" \
  -ex "list" \
  --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
grep -A40 "received signal" "$LOG" | grep -v "^\[" | head -60
