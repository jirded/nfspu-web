#!/usr/bin/env python3
"""Relocations from a normal PE base-relocation directory.

Porsche.exe has one; NFSU2's SPEED2.EXE needed tools/reloc2.py because its
directory entry was zeroed. Writes out/relocs.txt in reloc2.py's format:
one fixup slot address per line.
"""
import sys, os, struct, collections
import pefile

pe = pefile.PE(sys.argv[1])
IB = pe.OPTIONAL_HEADER.ImageBase
img = pe.get_memory_mapped_image()
types = collections.Counter()
addrs = []
for blk in pe.DIRECTORY_ENTRY_BASERELOC:
    for e in blk.entries:
        types[e.type] += 1
        if e.type == 3:
            addrs.append(IB + e.rva)
print(f"entries: {sum(types.values())}  types: {dict(types)}")
lo, hi = IB, IB + pe.OPTIONAL_HEADER.SizeOfImage
ok = sum(1 for a in addrs if lo <= struct.unpack_from("<I", img, a - IB)[0] < hi)
print(f"CHECK: {ok}/{len(addrs)} slots point into the image = {100.0 * ok / max(len(addrs), 1):.2f}%")


def sec(a):
    for s in pe.sections:
        if s.VirtualAddress <= a - IB < s.VirtualAddress + s.Misc_VirtualSize:
            return s.Name.rstrip(b"\0").decode()
    return "?"


print("slots by section:", collections.Counter(map(sec, addrs)).most_common())
os.makedirs("out", exist_ok=True)
open("out/relocs.txt", "w").write("\n".join(f"{a:08x}" for a in sorted(addrs)))
print(f"-> out/relocs.txt ({len(addrs)})")
