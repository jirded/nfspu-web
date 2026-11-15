"""keyboard.c kbd_pump: a release comes to the game at least two frames after its press.

Porsche's front end sees the mouse buttons and keys through its window
messages, once a frame: a press and its release posted together (a quick tap,
a synthesized click) fell between two frames and the menu never saw them.
The release (WM_xBUTTONUP, WM_KEYUP, WM_SYSKEYUP) and what follows it stay
in the host queue until the renderer's frame count (metal_frames) has moved
on twice since the last press."""
NL = chr(10)
path = "runtime/keyboard.c"
s = open(path, encoding="latin-1").read()
marker = "Porsche: a release"
if marker in s:
    print("already:", path)
else:
    old = ("void kbd_pump(void){" + NL
           + "    int room = win32_msg_room();" + NL
           + "    for (;;){" + NL
           + "        uint32_t m, wp, lp;" + NL
           + "        pthread_mutex_lock(&g_mmx);" + NL
           + "        if (g_mq_h == g_mq_t || room <= 8){ pthread_mutex_unlock(&g_mmx); break; }" + NL
           + "        m = g_mq[g_mq_h].m; wp = g_mq[g_mq_h].wp; lp = g_mq[g_mq_h].lp;" + NL)
    new = ("long metal_frames(void);" + NL
           + "static long g_down_frame = -100;   /* Porsche: a release waits two frames after its press */" + NL
           + "static int msg_is_up(uint32_t m){ return m == 0x0202u || m == 0x0205u || m == 0x0208u || m == 0x0101u || m == 0x0105u; }" + NL
           + "static int msg_is_down(uint32_t m){ return m == 0x0201u || m == 0x0204u || m == 0x0207u || m == 0x0100u || m == 0x0104u; }" + NL
           + old
           + "        if (msg_is_up(m) && metal_frames() - g_down_frame < 2){ pthread_mutex_unlock(&g_mmx); break; }" + NL
           + "        if (msg_is_down(m)) g_down_frame = metal_frames();" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
