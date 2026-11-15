#!/bin/bash
cd /mnt/c/Development/NFSPU/porsche-web/out/runs
L=$(ls -t *.log | head -1)
echo "log: $L"
grep -vE 'CriticalSection|TlsGetValue|TlsSetValue|GetCurrentThreadId|HeapAlloc|HeapFree|HeapReAlloc|HeapSize|timeSetEvent|WaitForMultipleObjectsEx|GetFullPathNameA|CharUpperA|VirtualAlloc|VirtualFree|GetDiskFreeSpaceA' "$L" | tail -${N:-45}
echo
echo "stubbed imports:"
grep -oE '[A-Za-z0-9_#]+ +\([0-9] arg\) \[STUB\]' "$L" | sort | uniq -c | sort -rn
