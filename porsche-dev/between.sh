#!/bin/bash
# lines of the latest log ($LOGPAT) between two markers, matching $PAT
L=$(ls -t /mnt/c/Development/NFSPU/porsche-web/out/runs/${LOGPAT:-glog_}*.log | head -1)
awk -v a="$A" -v b="$B" 'index($0, a){f=1} f && b != "" && index($0, b){f=0} f' "$L" | grep -E "${PAT:-.}" | head -${N:-40}
