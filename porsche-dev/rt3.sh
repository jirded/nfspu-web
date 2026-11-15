#!/bin/bash
cd /mnt/c/Development/NFSPU/porsche-web
ls runtime/web/compat
echo ===== cpu.h memory
grep -n "GUEST\|g_mem\|MEMBASE\|define MR32\|define G(\|__wasm\|NFSU2_GUEST_OBJ\|g_guest" runtime/cpu.h | head -40
echo ===== mem.c
grep -n "mmap\|__wasm\|GUEST_END\|g_mem\|^int mem_\|^void mem_\|^uint" runtime/mem.c | head -40
echo ===== compat wasm_plat.h head
sed -n 1,60p runtime/web/compat/wasm_plat.h
echo ===== null_platform.c head
sed -n 1,40p runtime/web/null_platform.c
grep -n "^[a-z].*(" runtime/web/null_platform.c | head -60
