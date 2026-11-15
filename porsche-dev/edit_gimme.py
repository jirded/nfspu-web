import sys
p = sys.argv[1]; code = open(sys.argv[2]).read()
s = open(p, encoding='latin-1').read()
if 'gimme_convert_file' in s: print('already'); sys.exit(0)
def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)
rep('#define NGLIDE ((int)(sizeof glide_names / sizeof glide_names[0]))\nstatic ImpEnt g_extra[NGLIDE];\n',
    '#define NGLIDE ((int)(sizeof glide_names / sizeof glide_names[0]))\nstatic ImpEnt g_extra[NGLIDE + 1];\n')
rep('    *n = NGLIDE;\n',
    '    g_extra[NGLIDE] = (ImpEnt){ 0, "gimme.dll", "ConvertFile", 0 };   /* cdecl: the caller pops */\n    *n = NGLIDE + 1;\n')
rep('int porsche_win32_call(CPU *c, const char *dll, const char *n, uint32_t *out){\n    uint32_t r = 0;\n    if (dll && !strcasecmp(dll, "glide3x.dll")) return glide_call(c, n, out);\n',
    code + 'int porsche_win32_call(CPU *c, const char *dll, const char *n, uint32_t *out){\n    uint32_t r = 0;\n    if (dll && !strcasecmp(dll, "glide3x.dll")) return glide_call(c, n, out);\n'
    '    if (dll && !strcasecmp(dll, "gimme.dll") && !strcmp(n, "ConvertFile")){ *out = gimme_convert_file(c); return 1; }\n')
open(p, 'w', encoding='latin-1').write(s); print('ok')
