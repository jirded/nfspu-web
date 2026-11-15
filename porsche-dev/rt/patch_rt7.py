"""win32.c: append runtime/porsche's extra imports (glide3x.dll entry points)
to the combined import table, after the exe's and the lifted module's."""
NL = chr(10)
path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "porsche_extra_imports"
if marker in s:
    print("already:", path)
else:
    old = ("    g_nimps = g_imp_count + g_srv_imp_count;" + NL
           + "    g_imps = calloc(g_nimps ? g_nimps : 1, sizeof *g_imps);" + NL
           + "    memcpy(g_imps, g_imp, g_imp_count * sizeof *g_imps);" + NL
           + "    if (g_srv_imp_count) memcpy(g_imps + g_imp_count, g_srv_imp, g_srv_imp_count * sizeof *g_imps);" + NL)
    new = ("    uint32_t nx = 0; const ImpEnt *xi = porsche_extra_imports(&nx);   /* runtime/porsche: glide3x.dll */" + NL
           + "    g_nimps = g_imp_count + g_srv_imp_count + nx;" + NL
           + "    g_imps = calloc(g_nimps ? g_nimps : 1, sizeof *g_imps);" + NL
           + "    memcpy(g_imps, g_imp, g_imp_count * sizeof *g_imps);" + NL
           + "    if (g_srv_imp_count) memcpy(g_imps + g_imp_count, g_srv_imp, g_srv_imp_count * sizeof *g_imps);" + NL
           + "    if (nx) memcpy(g_imps + g_imp_count + g_srv_imp_count, xi, nx * sizeof *g_imps);" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    anchor = "void win32_init(void){" + NL
    assert s.count(anchor) == 1
    s = s.replace(anchor, "const ImpEnt *porsche_extra_imports(uint32_t *n);   /* runtime/porsche/porsche_win32.c */" + NL + anchor)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
