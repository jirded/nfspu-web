"""win32_ext.c RegQueryValueExA: Porsche's renderer choice by default.

Without "Thrash Driver" the game stops with "Run 3D Setup before running the
game"; the Glide driver (Drivers/voodoo2z.dll, lifted, runtime/porsche/glide.c)
is the one this port renders with.  A stored value still wins."""
NL = chr(10)
path = "runtime/win32_ext.c"
s = open(path, encoding="latin-1").read()
marker = "Porsche: the Glide thrash driver"
if marker in s:
    print("already:", path)
else:
    old = '        else if (!strcasecmp(vn,"~MHz")){' + NL
    new = ('        else if (!strcasecmp(vn,"Thrash Driver")) sval="Voodoo2";   /* Porsche: the Glide thrash driver */' + NL
           + '        else if (!strcasecmp(vn,"Group"))         sval="Glide";' + NL
           + old)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
