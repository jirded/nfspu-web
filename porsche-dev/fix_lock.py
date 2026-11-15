import sys

p = sys.argv[1]
s = open(p, encoding="latin-1").read()
NL = chr(10)
anchor = "    def insn(self, i, targets):" + NL + "        m=i.mnemonic; ops=i.operands; o=ops" + NL
assert s.count(anchor) == 1, s.count(anchor)
add = (
    "        # 'lock inc [x]' etc. (Porsche.exe's CRT locale lock): guest threads run one at a" + NL
    + "        # time under the runtime's GIL, so the plain instruction is already atomic." + NL
    + "        if m.startswith('lock '): m = m[5:]" + NL
)
s = s.replace(anchor, anchor + add)
assert chr(0) not in s
open(p, "w", encoding="latin-1").write(s)
print("patched", p)
