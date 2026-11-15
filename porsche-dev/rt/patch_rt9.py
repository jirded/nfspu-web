"""DirectInput 1-7 (Porsche.exe) device enumeration.

Porsche builds its input device list from IDirectInput::EnumDevices and later
reads entry 0 unconditionally (0x51f080): with no device reported it reads
through a null pointer.  NFSU2 (DirectInput 8) only enumerated with DI_ENUM.
When the object came from DirectInputCreateA (g_di_legacy), EnumDevices
reports the keyboard and the mouse with DirectInput 7's device types
(DIDEVTYPE_KEYBOARD 3 | PCENH << 8, DIDEVTYPE_MOUSE 2 | TRADITIONAL << 8)."""
NL = chr(10)

def patch(path, pairs, marker):
    s = open(path, encoding="latin-1").read()
    if marker in s:
        print("already:", path); return
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:70])
        s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)

patch("runtime/com.c", [
    ("static uint32_t make_devinst(int keyboard){" + NL + "    static uint32_t kb = 0, ms = 0;" + NL,
     "int g_di_legacy = 0;   /* Porsche: the object came from DirectInputCreateA (DirectInput 1-7) */" + NL
     + "static uint32_t make_devinst(int keyboard){" + NL + "    static uint32_t kb = 0, ms = 0;" + NL),
    ("    MR32(p+36) = keyboard ? 0x0413u : 0x0212u;" + NL,
     "    MR32(p+36) = g_di_legacy ? (keyboard ? 0x0403u : 0x0202u) : (keyboard ? 0x0413u : 0x0212u);" + NL),
    ("            if (cb && ENVC(\"DI_ENUM\")){" + NL,
     "            if (cb && (ENVC(\"DI_ENUM\") || g_di_legacy)){" + NL),
    ("                    if (devtype && (devtype & 0xFFu) != t && devtype > 4u) continue;" + NL,
     "                    if (g_di_legacy){ if (devtype && devtype != (is_kb ? 3u : 2u)) continue; }" + NL
     + "                    else if (devtype && (devtype & 0xFFu) != t && devtype > 4u) continue;" + NL),
], "g_di_legacy")

patch("runtime/win32.c", [
    ("r = com_directinput8create(ARG(c,2));   /* Porsche: DirectInput 1-7 */",
     "{ extern int g_di_legacy; g_di_legacy = 1; r = com_directinput8create(ARG(c,2)); }   /* Porsche: DirectInput 1-7 */"),
], "g_di_legacy")
