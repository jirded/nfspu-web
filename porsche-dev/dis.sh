#!/bin/bash
# dis.sh START END : Porsche.exe disassembled between two addresses (hex)
cd /mnt/c/Development/NFSPU/porsche-web
X=x86dis.py; [ -f $X ] || X=tools/x86dis.py; [ -f $X ] || X=porsche-dev/x86dis.py
.venv/bin/python -I $X /mnt/c/Development/NFSPU/games/porsche/Porsche.exe "$1" "$2"
