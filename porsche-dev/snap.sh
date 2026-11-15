#!/bin/bash
# run the game under gdb; after $AT seconds interrupt it and print every thread's backtrace
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_DUMP=${DUMP:-0} PORSCHE_DUMP_DIR=/mnt/c/Development/NFSPU/porsche-web/out/frames
OUT=/mnt/c/Development/NFSPU/porsche-web/out/runs/snap_$(date +%H%M%S).txt
( sleep ${AT:-45}; kill -INT $(pgrep -n -x porsche_boot) 2>/dev/null ) &
timeout $(( ${AT:-45} + 60 )) gdb -q -batch \
  -ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" \
  -ex "set pagination off" \
  -ex run \
  -ex "thread apply all bt ${DEPTH:-10}" \
  -ex kill \
  --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$OUT" 2>&1
echo "out: $OUT"
grep -E "^Thread|^#" "$OUT" | grep -vE " (__futex|futex_|__GI___|syscall|clock_nanosleep|__lll_|___pthread_cond|pthread_cond|start_thread|clone3|__libc_|__pthread_clockjoin|__nanosleep|__GI_)" | head -${N:-80}
