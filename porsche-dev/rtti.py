"""rtti.py CLASS... : the vtables of a class of Porsche.exe, found through its MSVC RTTI name (as in
.?AVR3DCarLOD@@: give R3DCarLOD), with the first functions of each.
   .venv/bin/python -I porsche-dev/rtti.py R3DCarLOD"""
import sys, struct, pefile

pe = pefile.PE('/mnt/c/Development/NFSPU/games/porsche/Porsche.exe', fast_load=True)
ib = pe.OPTIONAL_HEADER.ImageBase
img = pe.get_memory_mapped_image()


def finds(b):
    out, i = [], img.find(b)
    while i >= 0:
        out.append(ib + i); i = img.find(b, i + 1)
    return out


text = next(s for s in pe.sections if s.Name.startswith(b'.text'))
t0, t1 = ib + text.VirtualAddress, ib + text.VirtualAddress + text.Misc_VirtualSize
for name in sys.argv[1:]:
    for s in finds(b'.?AV' + name.encode() + b'@@\0'):
        td = s - 8
        for ref in finds(struct.pack('<I', td)):
            col = ref - 12                                   # the complete object locator has the type descriptor at +12
            if struct.unpack_from('<I', img, col - ib)[0] != 0: continue
            for v in finds(struct.pack('<I', col)):
                vt = v + 4; fns = []
                for k in range(40):
                    f = struct.unpack_from('<I', img, vt - ib + 4 * k)[0]
                    if not (t0 <= f < t1): break
                    fns.append('%d:%x' % (k, f))
                print('%s: type 0x%x, vtable 0x%x (offset %d): %s' % (name, td, vt, struct.unpack_from('<I', img, col - ib + 4)[0], ' '.join(fns)))
