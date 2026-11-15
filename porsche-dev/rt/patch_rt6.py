"""argcount.py: stdcall argument counts of voodoo2z.dll's imports (Win32 API docs)."""
NL = chr(10)
path = "tools/argcount.py"
s = open(path, encoding="latin-1").read()
marker = "# voodoo2z.dll imports"
if marker in s:
    print("already:", path)
else:
    add = {"GetWindowThreadProcessId": 2}
    line = "KNOWN={" + NL
    assert s.count(line) == 1, s.count(line)
    body = "  " + marker + NL
    for k, v in add.items():
        body += "  " + repr(k) + ":" + str(v) + "," + NL
    s = s.replace(line, line + body)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
