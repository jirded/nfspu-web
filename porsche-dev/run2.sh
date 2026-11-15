#!/bin/bash
cd /mnt/c/Development/NFSPU/games/porsche
mkdir -p /mnt/c/Development/NFSPU/porsche-web/out/runs
LOG=/mnt/c/Development/NFSPU/porsche-web/out/runs/run_$(date +%H%M%S).log
TRACE_MAX=${TM:-20000} timeout -s INT ${T:-30} /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$LOG" 2>&1
echo "exit: $?   log: $LOG   lines: $(wc -l < "$LOG")"
grep -vE "CriticalSection|TlsGetValue|TlsSetValue|GetCurrentThreadId|HeapAlloc|HeapFree|HeapReAlloc|HeapSize|timeSetEvent|GetTickCount|timeGetTime|MultiByteToWide|WideCharToMulti|GetStringType|LCMapString|GetCPInfo|SetEvent|WaitForSingle|ResetEvent|Sleep|InterlockedIn|InterlockedDe|GetLastError|SetLastError" "$LOG" | sed -n "${FROM:-40},${TO:-260}p"
