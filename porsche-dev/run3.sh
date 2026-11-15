#!/bin/bash
# run with a Porsche registry file (seeded like Drivers/Enable Direct3D 7 Renderer.reg)
cd /mnt/c/Development/NFSPU/games/porsche
mkdir -p /mnt/c/Development/NFSPU/porsche-web/out/runs
REG=/mnt/c/Development/NFSPU/games/porsche.registry
if [ -n "$RESEED" ] || [ ! -f "$REG" ]; then
  printf 's Thrash Driver=%s\ns Group=%s\n' "${DRV:-DX7}" "${GRP:-D3D}" > "$REG"
fi
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/run_$(date +%H%M%S).log
NFSU2_REGFILE=$REG REGLOG=1 TRACE_MAX=${TM:-20000} timeout -s INT ${T:-30} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "exit: $?   log: $LOG   lines: $(wc -l < "$LOG")"
echo "registry now:"; cat "$REG"
grep -nE "registry|\[guest\]|MESSAGEBOX|title:|text :|LoadLibrary|GetProcAddress|THRASH|thrash|Drivers|\.dll" "$LOG" | tail -${N:-40}
