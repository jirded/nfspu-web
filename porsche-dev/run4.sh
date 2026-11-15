#!/bin/bash
# headless run with the Glide (Voodoo2) thrash driver; frames as PNG into out/frames
cd /mnt/c/Development/NFSPU/games/porsche
mkdir -p /mnt/c/Development/NFSPU/porsche-web/out/runs
REG=/mnt/c/Development/NFSPU/games/porsche.registry
if [ -n "$RESEED" ] || [ ! -f "$REG" ]; then
  printf 's Thrash Driver=Voodoo2\ns Group=Glide\n' > "$REG"
fi
export PORSCHE_DUMP_DIR=/mnt/c/Development/NFSPU/porsche-web/out/frames
rm -rf "$PORSCHE_DUMP_DIR"; mkdir -p "$PORSCHE_DUMP_DIR"
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/glide_$(date +%H%M%S).log
NFSU2_REGFILE=$REG PORSCHE_DUMP=${DUMP:-30} TRACE_MAX=${TM:-0} timeout -s INT ${T:-40} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "exit: $?   log: $LOG   lines: $(wc -l < "$LOG")"
echo "registry:"; cat "$REG"
grep -E "\[glide|\[module|MESSAGEBOX|title:|text :|\[dbg\]|\[guest\]|STUB|not implemented|trap|unsupported|\*\*\*" "$LOG" | grep -v "^\[glide-sw\] wrote" | head -${N:-60}
echo "frames: $(ls $PORSCHE_DUMP_DIR | wc -l)"; ls $PORSCHE_DUMP_DIR | tail -3
