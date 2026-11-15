"""fileio.c DeleteFileA: a file that is only in the read-only game folder counts as deleted.

With the save overlay, DeleteFileA goes to the write root.  A file the game has
never written is not there, only in the game folder below it, and unlink said
"no such file".  Porsche's "create player" copies SaveData\\XXhud1XX.hud to
<NAME>1.hud, deletes XXhud1XX.hud and writes it again; on a fresh save folder
the delete failed and the game stopped with "there was an error trying to
create that player" (the second try worked: by then the game had written its
own XXhud1XX.hud into the save folder).  On Windows that file is in SaveData
and the delete succeeds, so it succeeds here too.  There are no whiteouts: the
game folder's copy is still read until the game writes the file again, which
is what it does next."""
NL = chr(10)
path = "runtime/fileio.c"
s = open(path, encoding="latin-1").read()
marker = "only in the read-only game folder: deleted as far as the game goes"
if marker in s:
    print("already:", path)
else:
    old = ("        else { r = (unlink(real)==0); if (!r) set_err(c, errno_to_win(errno));" + NL
           + "               else if (is_profile(real)) garage_profile_deleted(real); }" + NL)
    new = ("        else { r = (unlink(real)==0);" + NL
           + "               if (!r && errno == ENOENT && g_wroot[0]){" + NL
           + "                   /* " + marker + " (no whiteout: its" + NL
           + "                    * copy there is read until the game writes the file again) */" + NL
           + "                   char ro[1024];" + NL
           + "                   if (resolve_in(g_root, GS(A(c,0)), ro, sizeof ro) && strcmp(ro, g_root) != 0){" + NL
           + "                       fprintf(stderr, \"[write] DeleteFileA \\\"%s\\\": only in the game folder, taken as deleted\\n\", GS(A(c,0)));" + NL
           + "                       r = 1; }" + NL
           + "                   else errno = ENOENT;" + NL
           + "               }" + NL
           + "               if (!r) set_err(c, errno_to_win(errno));" + NL
           + "               else if (is_profile(real)) garage_profile_deleted(real); }" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
