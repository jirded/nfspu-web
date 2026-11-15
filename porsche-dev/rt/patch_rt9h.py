"""fileio.c: fileio_resolve_write, the host path of a file the runtime writes for the game.

Porsche's gimme.dll ConvertFile (runtime/porsche/porsche_win32.c) writes the
player's picture itself: the file goes where the game's own writes go (the
save overlay), with the same audit line and read-only check.  resolve_w's
result only says whether the file exists yet; the path is there either way."""
NL = chr(10)
path = "runtime/fileio.c"
s = open(path, encoding="latin-1").read()
body = ("    resolve_w(win, out, outsz);   /* 0: not there yet, as for any file being created */" + NL
        + "    if (!out[0] || !write_allowed(op, win, out)) return 0;" + NL)
first = "    if (!resolve_w(win, out, outsz) || !write_allowed(op, win, out)) return 0;" + NL
if body in s:
    print("already:", path)
elif first in s:
    s = s.replace(first, body)
    open(path, "w", encoding="latin-1").write(s)
    print("patched (update):", path)
else:
    old = "int fileio_open_writers(void){ return g_open_wr; }" + NL
    new = (old
           + "/* runtime/porsche (gimme.dll ConvertFile): a file the runtime writes for the game, by its" + NL
           + " * guest path: where the game's own writes go, logged and checked as they are; 0 if refused */" + NL
           + "int fileio_resolve_write(const char *op, const char *win, char *out, size_t outsz){" + NL
           + body
           + "    mkparents(out);" + NL
           + "    return 1;" + NL
           + "}" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
