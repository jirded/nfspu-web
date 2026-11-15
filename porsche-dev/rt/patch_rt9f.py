"""GetAsyncKeyState: the shared runtime answered 0 for every key; Porsche's
front end reads keys and the mouse buttons with it (runtime/porsche/porsche_win32.c,
porsche_key_state).  input_web.c gives the mouse buttons to it."""
NL = chr(10)

def patch(path, pairs, marker):
    s = open(path, encoding="latin-1").read()
    if marker in s:
        print("already:", path); return
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:60])
        s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)

patch("runtime/win32_ext.c", [
    ('    else if (!strcmp(n,"GetAsyncKeyState")) r=0;' + NL,
     '    else if (!strcmp(n,"GetAsyncKeyState")){ int porsche_key_state(uint32_t, int); r = (uint32_t)porsche_key_state(A(c,0), 1); }   /* Porsche: keys and mouse buttons */' + NL),
], "porsche_key_state")

s = open("runtime/web/input_web.c", encoding="latin-1").read()
if "porsche_mouse_buttons" in s:
    print("already: runtime/web/input_web.c")
else:
    s += (NL + "/* Porsche: the mouse buttons for GetAsyncKeyState (runtime/porsche/porsche_win32.c) */" + NL
          + "unsigned porsche_mouse_buttons(void){ return atomic_load(&g_mouse_btn); }" + NL)
    open("runtime/web/input_web.c", "w", encoding="latin-1").write(s)
    print("patched: runtime/web/input_web.c")
