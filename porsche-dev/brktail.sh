#!/bin/bash
F=$(ls -t /mnt/c/Development/NFSPU/porsche-web/out/runs/brk_*.txt | head -1)
echo "$F: $(grep -c 'hit Breakpoint' "$F") hits"
grep -E 'SIGSEGV|exited|^\$|^#0|^#1' "$F" | tail -${N:-16}
