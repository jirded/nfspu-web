"""input_web.c key_down: a held modifier the key's own event says is up is let go.

Chrome on Windows now and then keeps Alt's key up for itself (its menu), and
no blur comes with it: the game saw Alt held for good, its driving keys came
as WM_SYSKEYDOWN and the car did not move.  Every key event says whether Alt,
Ctrl and Shift are down (KeyboardEvent altKey, ctrlKey, shiftKey: the flags
IKF_ALT, IKF_CTRL, IKF_SHIFT).  On the press of a key that is no modifier, a
modifier held here that the event says is up is released first."""
NL = chr(10)
path = "runtime/web/input_web.c"
s = open(path, encoding="latin-1").read()
BS = chr(92)
marker = "modifiers_from_event"
broken = "up: released" + NL + "\", mods[i].dik);"   # a first version wrote a newline in place of the escape
if broken in s:
    s = s.replace(broken, "up: released" + BS + "n\", mods[i].dik);")
    open(path, "w", encoding="latin-1").write(s)
    print("patched (repair):", path)
elif marker in s:
    print("already:", path)
else:
    old = "static void key_down(const InEv *e){" + NL + "    unsigned dik = e->dik;" + NL \
        + "    if (!dik || dik == 0xDB || dik == 0xDC) return;            /* Meta: the browser's */" + NL
    new = ("/* a held modifier whose key up the browser kept (Chrome on Windows: Alt, to its" + NL
           + " * menu, with no blur): the event of any other key says it is up, so it is let go */" + NL
           + "static void modifiers_from_event(const InEv *e){" + NL
           + "    static const struct { unsigned dik, flag; } mods[] = {" + NL
           + "        { DIK_LMENU, IKF_ALT }, { DIK_RMENU, IKF_ALT }, { 0x1D, IKF_CTRL }, { 0x9D, IKF_CTRL }," + NL
           + "        { 0x2A, IKF_SHIFT }, { 0x36, IKF_SHIFT } };" + NL
           + "    for (unsigned i = 0; i < sizeof mods / sizeof mods[0]; i++)" + NL
           + "        if (g_down[mods[i].dik].down && !(e->flags & mods[i].flag)){" + NL
           + "            fprintf(stderr, \"[key] dik=0x%02x was still held, the key event says it is up: released" + BS + "n\", mods[i].dik);" + NL
           + "            release(mods[i].dik, 0);" + NL
           + "        }" + NL
           + "}" + NL
           + old
           + "    if (!is_modifier(dik)) modifiers_from_event(e);" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
