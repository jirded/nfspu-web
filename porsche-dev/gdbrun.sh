#!/bin/bash
# run under gdb, print the crashing thread's backtrace and guest registers
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_DUMP=${DUMP:-0} PORSCHE_DUMP_DIR=/mnt/c/Development/NFSPU/porsche-web/out/frames
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/gdb_$(date +%H%M%S).log
timeout ${T:-180} gdb -q -batch \
  -ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" \
  -ex "set pagination off" \
  -ex run \
  -ex "bt 25" \
  -ex "info registers rip" \
  -ex "x/6i \$pc" \
  -ex "frame 1" -ex "info locals" \
  --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "log: $LOG"
grep -v "^\[write\]\|^\[guest\] using track\|New Thread\|Thread 0x.* exited" "$LOG" | tail -${N:-60}
