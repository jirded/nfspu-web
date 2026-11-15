"""module.c: Porsche's thrash drivers live in the game's Drivers folder."""
NL = chr(10)
path = "runtime/module.c"
s = open(path, encoding="latin-1").read()
marker = "Drivers\\\\%s"
if marker in s:
    print("already:", path)
else:
    old = "    if (!fileio_resolve_game(mi->name, host, sizeof host)){" + NL
    new = ("    char alt[300]; snprintf(alt, sizeof alt, \"Drivers\\\\%s\", mi->name);   /* Porsche: Drivers\\voodoo2z.dll */" + NL
           + "    if (!fileio_resolve_game(mi->name, host, sizeof host) && !fileio_resolve_game(alt, host, sizeof host)){" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
