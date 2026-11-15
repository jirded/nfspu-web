#!/bin/bash
# Lift Drivers/voodoo2z.dll (the game's Glide "thrash" driver) as the second guest module (gen/server).
set -e
cd /mnt/c/Development/NFSPU/porsche-web
tools/porsche_glide_lift.sh /mnt/c/Development/NFSPU/games/porsche/Drivers/voodoo2z.dll
