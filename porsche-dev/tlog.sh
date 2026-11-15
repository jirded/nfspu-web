#!/bin/bash
# the newest page's lines from the test server's browser log: tlog.sh [N lines] [grep -E pattern to keep]
cd /mnt/c/Development/NFSPU/porsche-web/out
P=$(tail -1 test-browser.log | cut -d' ' -f1)
echo "prefix=$P"
grep "^$P " test-browser.log | grep -v "CANNOT OPEN" | grep -E -- "${2:-.}" | tail -${1:-70}
