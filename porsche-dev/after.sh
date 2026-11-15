#!/bin/bash
# lines of the latest glog after a marker, without the noisy calls
L=$(ls -t /mnt/c/Development/NFSPU/porsche-web/out/runs/glog_*.log | head -1)
awk -v m="${MARK:-Voodoo2z}" 'index($0, m){f=1} f' "$L" \
 | grep -vE "CriticalSection|TlsGetValue|TlsSetValue|GetCurrentThreadId|HeapAlloc|HeapFree|HeapReAlloc|HeapSize|timeSetEvent|QueryPerformanceCounter|GetTickCount|CharUpperA|GetFullPathName|VirtualAlloc|VirtualFree|GetDiskFree|SetEvent|SleepEx|WaitForMultiple|ReadFile|SetFilePointer|PulseEvent|InterlockedIn|InterlockedDe|GetLastError|SetLastError|grTexMipMapMode|grRenderBuffer|grFinish|grDitherMode|grTexLodBias|\[write\]" \
 | head -${N:-120}
