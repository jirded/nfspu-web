"""com.c: the mouse's IDirectInputDevice::GetObjectInfo and GetCapabilities.

GetObjectInfo(this, pdidoi, dwObj, dwHow): the shared code took the
structure from the LAST argument (dwHow, = DIPH_BYOFFSET = 1) and wrote to
guest address 1; Porsche.exe asks the mouse for its objects' names (the
controller setup).  Now: pdidoi is argument 1, and the mouse's objects in
c_dfDIMouse are reported (X, Y, wheel at 0/4/8, buttons at 12..15).
GetCapabilities: DirectInput 1-7 device type for the mouse."""
NL = chr(10)
path = "runtime/com.c"
s = open(path, encoding="latin-1").read()
marker = "Porsche: the mouse's objects"
if marker in s:
    print("already:", path)
else:
    old = ("        else if (MID(GetObjectInfo)){" + NL
           + "            uint32_t p=A(c,nargs-1);" + NL
           + "            if(p){ uint32_t sz=MR32(p); if(!sz||sz>512u) sz=32u; mem_commit(p,sz);" + NL
           + "                   memset(g_mem+p,0,sz); MR32(p)=sz; }" + NL
           + "            r=0; }" + NL)
    new = ("        else if (MID(GetObjectInfo)){   /* Porsche: the mouse's objects (this, pdidoi, dwObj, dwHow) */" + NL
           + "            uint32_t p = nargs >= 4 ? A(c,1) : 0u, obj = A(c,2), how = A(c,3);" + NL
           + "            uint32_t ofs = how == 1u ? obj : (obj >> 8) < 3u && (obj & 3u) ? (obj >> 8) * 4u : 12u + (obj >> 8);" + NL
           + "            if (!p || !mem_is_committed(p+3)) r = 0x80070057u;               /* DIERR_INVALIDPARAM */" + NL
           + "            else if (ofs > 15u || (ofs < 12u && (ofs & 3u))) r = 0x80070002u;   /* DIERR_OBJECTNOTFOUND */" + NL
           + "            else { uint32_t sz=MR32(p); if(!sz||sz>512u) sz=316u; mem_commit(p,sz);" + NL
           + "                   memset(g_mem+p,0,sz); MR32(p)=sz;" + NL
           + "                   int axis = ofs < 12u; unsigned inst = axis ? ofs / 4u : ofs - 12u;" + NL
           + "                   MR32(p+20) = ofs;                                     /* dwOfs */" + NL
           + "                   MR32(p+24) = (axis ? 0x1u : 0x4u) | inst << 8;        /* DIDFT_RELAXIS / PSHBUTTON | instance */" + NL
           + "                   if (sz >= 32u + 32u){ static const char *ax[3] = { \"X axis\", \"Y axis\", \"Wheel\" };" + NL
           + "                       if (axis) snprintf((char*)(g_mem+p+32), 32, \"%s\", ax[inst]);" + NL
           + "                       else snprintf((char*)(g_mem+p+32), 32, \"Button %u\", inst); }" + NL
           + "                   r=0; } }" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    old2 = "                   MR32(p+8)=0x00000212u;   /* DI8DEVTYPE_MOUSE */" + NL
    new2 = "                   MR32(p+8)=g_di_legacy ? 0x00000202u : 0x00000212u;   /* (DI8)DEVTYPE_MOUSE */" + NL
    assert s.count(old2) == 1, s.count(old2)
    s = s.replace(old2, new2)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
