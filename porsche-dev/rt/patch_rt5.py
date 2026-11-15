"""win32.c: ask runtime/porsche/porsche_win32.c before reporting a stub."""
NL = chr(10)
path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "porsche_win32_call"
if marker in s:
    print("already:", path)
else:
    old = "    else if (win32_ext_call(c, n, &r)) { /* second-round layer */ }" + NL
    new = (old
           + "    else if (porsche_win32_call(c, e->dll, n, &r)) { /* Porsche.exe's extra APIs: runtime/porsche */ }" + NL)
    assert s.count(old) == 1
    s = s.replace(old, new)
    decl_anchor = "static uint32_t ARG(CPU*c,int i)"
    assert s.count(decl_anchor) == 1
    s = s.replace(decl_anchor,
                  "int porsche_win32_call(CPU *c, const char *dll, const char *n, uint32_t *out);   /* runtime/porsche */" + NL
                  + decl_anchor)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
