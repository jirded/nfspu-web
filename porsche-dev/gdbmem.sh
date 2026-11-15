#!/bin/bash
# run under gdb; at the crash print guest globals (GDBX: extra gdb commands, ';'-separated) and host registers
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/gdbm_$(date +%H%M%S).log
ARGS=()
IFS=';' read -ra EXTRA <<< "${GDBX:-}"
for e in "${EXTRA[@]}"; do [ -n "$e" ] && ARGS+=(-ex "$e"); done
timeout ${T:-180} gdb -q -batch \
  -ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" \
  -ex "set pagination off" \
  -ex run \
  -ex "bt 6" \
  -ex "info registers rax rbx rcx rdx rsi rdi" \
  -ex 'p/x (unsigned long)g_mem' \
  -ex 'x/3i $pc' \
  "${ARGS[@]}" \
  --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "log: $LOG"
grep -A40 "received signal" "$LOG" | grep -vE '^\[|New Thread|exited'
