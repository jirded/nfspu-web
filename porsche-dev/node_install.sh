#!/bin/bash
# Node.js 22 LTS into /mnt/c/Development/NFSPU/tools/node (official tarball, checksum verified), then the page's tools (npm ci in web/)
set -e
V=v22.20.0
if [ ! -x /mnt/c/Development/NFSPU/tools/node/bin/node ]; then
  mkdir -p ~/.local
  cd /tmp
  curl -sSLO https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz
  curl -sSL https://nodejs.org/dist/$V/SHASUMS256.txt | grep " node-$V-linux-x64.tar.xz\$" | sha256sum -c -
  tar xJf node-$V-linux-x64.tar.xz
  rm -rf /mnt/c/Development/NFSPU/tools/node && mv node-$V-linux-x64 /mnt/c/Development/NFSPU/tools/node && rm node-$V-linux-x64.tar.xz
fi
grep -q '.local/node/bin' ~/.bashrc || echo 'export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"' >> ~/.bashrc
export PATH="/mnt/c/Development/NFSPU/tools/node/bin:$PATH"
node --version; npm --version
cd /mnt/c/Development/NFSPU/porsche-web/web && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund 2>&1 | tail -3
ls node_modules/.bin | head
