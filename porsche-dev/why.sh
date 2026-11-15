#!/bin/bash
cd /mnt/c/Development/NFSPU/porsche-web/out/runs
L=$(ls -t *.log | head -1)
n=$(grep -nE 'MESSAGEBOX|ExitProcess|exited with|guest entry point returned' "$L" | head -1 | cut -d: -f1)
echo "first exit marker at line $n of $(wc -l < "$L")"
grep -vE 'CriticalSection|TlsGetValue|TlsSetValue|GetCurrentThreadId|HeapAlloc|HeapFree|HeapReAlloc|HeapSize|timeSetEvent|WaitForMultipleObjectsEx|GetFullPathNameA|CharUpperA|VirtualAlloc|VirtualFree|GetDiskFreeSpaceA|SetLastError|GetLastError' <(sed -n "$((n-${B:-400})),$((n+12))p" "$L") | tail -${N:-60}
