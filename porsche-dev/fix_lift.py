import sys

p = sys.argv[1]
lines = open(p, encoding="latin-1").read().split(chr(10))
out = []
fixed = 0
for ln in lines:
    if ln.lstrip().startswith("_ex = [s for s in pe.sections if s.Characteristics"):
        ind = " " * 8
        out.append(ind + "_ex = [s for s in pe.sections if s.Characteristics & 0x20000000]")
        out.append(ind + "if not _ex: _ex = [s for s in pe.sections if s.Name.startswith(b'.text')]")
        fixed += 1
    else:
        out.append(ln)
assert fixed == 1, fixed
data = chr(10).join(out)
assert chr(0) not in data
open(p, "w", encoding="latin-1").write(data)
print("fixed", p)
