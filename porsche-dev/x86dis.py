# dis.py FILE START END : x86 disassembly of a PE's range (virtual addresses), strings annotated
import sys, pefile, capstone
pe = pefile.PE(sys.argv[1]); base = pe.OPTIONAL_HEADER.ImageBase
a0, a1 = int(sys.argv[2], 16), int(sys.argv[3], 16)
code = pe.get_data(a0 - base, a1 - a0)
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
def s_at(v):
    try:
        b = pe.get_data(v - base, 64).split(b'\0')[0]
        if len(b) >= 3 and all(32 <= c < 127 for c in b): return '"' + b.decode() + '"'
    except Exception: pass
    return ''
import re
for i in md.disasm(code, a0):
    note = ''
    for m in re.findall(r'0x[0-9a-f]{6,8}', i.op_str):
        v = int(m, 16); t = s_at(v)
        if t: note += ' ; ' + t
    print('%08x  %-8s %s%s' % (i.address, i.mnemonic, i.op_str, note))
