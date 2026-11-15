#!/bin/bash
# lines of one page load in the test server's browser log: tloggrep.sh PREFIX PATTERN [N lines]
# (PREFIX = the 4 characters every line of that page load starts with)
cd /mnt/c/Development/NFSPU/porsche-web/out
grep -a "^$1 " test-browser.log | grep -aE -- "$2" | head -${3:-80} | cut -c1-230
