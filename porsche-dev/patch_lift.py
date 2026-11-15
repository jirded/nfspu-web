import sys
p = sys.argv[1]
s = open(p).read()
old = "        self.TVA,self.TSZ,self.TDATA = next((va,vs,d) for nm,va,vs,d in self.secs if nm=='.text')\n"
new = (
    "        # Code = one span over every executable section (Porsche.exe: .text + PACODE,\n"
    "        # hand-written asm right after .text). With only .text this is the old behaviour.\n"
    "        _ex = [s for s in pe.sections if s.Characteristics & 0x20000000] or \\n"
    "              [s for s in pe.sections if s.Name.rstrip(b'\x00') == b'.text']\n"
    "        _lo = min(s.VirtualAddress for s in _ex)\n"
    "        _hi = max(s.VirtualAddress + s.Misc_VirtualSize for s in _ex)\n"
    "        if len(_ex) == 1:\n"
    "            self.TVA,self.TSZ,self.TDATA = next((va,vs,d) for nm,va,vs,d in self.secs if nm=='.text')\n"
    "        else:\n"
    "            _img = pe.get_memory_mapped_image()\n"
    "            self.TVA, self.TSZ, self.TDATA = self.IB + _lo, _hi - _lo, bytes(_img[_lo:_hi + 16])\n"
)
assert s.count(old) == 1, "anchor not found"
open(p, "w").write(s.replace(old, new))
print("patched", p)
