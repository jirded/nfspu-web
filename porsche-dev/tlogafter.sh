#!/bin/bash
# the newest test page's log lines from the first one matching a pattern: tlogafter.sh PATTERN [N lines]
cd /mnt/c/Development/NFSPU/porsche-web/out
P=$(tail -1 test-browser.log | cut -d' ' -f1)
grep "^$P " test-browser.log | awk -v pat="$1" 'f || $0 ~ pat { f = 1; print }' | head -${2:-60} | cut -c1-230
