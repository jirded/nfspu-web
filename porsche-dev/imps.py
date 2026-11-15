import re, sys
rows = re.findall(r'\{0x([0-9a-f]+)u,"([^"]+)","([^"]+)",(\d+)\}', open(sys.argv[1]).read())
want = set(int(x) for x in sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else set()
pat = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None
for i, (iat, dll, name, n) in enumerate(rows):
    if i in want or (pat and pat.search(name)):
        print(i, dll, name, n)
