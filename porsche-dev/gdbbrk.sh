#!/bin/bash
# break on a lifted function ($FN, e.g. sub_00a07248) $HITS times; print the guest stack and the strings it points at
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
OUT=/mnt/c/Development/NFSPU/porsche-web/out/runs/brk_$(date +%H%M%S).txt
CMDS=(-ex "handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass" -ex "set pagination off" -ex "break ${FN:-sub_00a07248}" -ex run)
for i in $(seq 1 ${HITS:-3}); do
  CMDS+=(-ex 'p/x c->esp' -ex 'p/x *(unsigned(*)[8])(g_mem + c->esp)'
         -ex 'p (char*)(g_mem + ((unsigned*)(g_mem + c->esp))[2])'
         -ex 'p (char*)(g_mem + ((unsigned*)(g_mem + c->esp))[3])'
         -ex 'p (char*)(g_mem + ((unsigned*)(g_mem + c->esp))[4])'
         -ex "bt 3" -ex continue)
done
timeout ${T:-120} gdb -q -batch "${CMDS[@]}" --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$OUT" 2>&1
echo "out: $OUT"
grep -E '^\$|^#|^Thread .* hit|signal' "$OUT" | head -${N:-60}
