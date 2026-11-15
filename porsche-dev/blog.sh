#!/bin/bash
# the newest page's lines from the browser log: blog.sh [N lines] [grep -v pattern]
cd /mnt/c/Development/NFSPU/porsche-web/out
P=$(tail -1 web-porsche-browser.log | cut -d' ' -f1)
echo "prefix=$P"
grep "^$P " web-porsche-browser.log | grep -v -- "${2:-CANNOT OPEN}" | tail -${1:-70}
