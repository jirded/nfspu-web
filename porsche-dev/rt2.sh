#!/bin/bash
cd /mnt/c/Development/NFSPU/porsche-web
cat runtime/web/main_web.c
echo =====
grep -n "imp_\|IMP(\|resolve\|g_imp\|ImpEnt" runtime/win32.c | head -40
echo =====
grep -rn "ImpEnt\|g_imp_count\|g_imp\[" runtime/*.c runtime/web/*.c | grep -v "^runtime/win32.c" | head -20
