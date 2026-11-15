"""win32.c: Porsche.exe's DirectInput 1-7 factory and DirectSound capture.

DirectInputCreateA(hinst, version, ppDI, outer) hands out the runtime's
IDirectInput8 object: IDirectInput(2/7)A's methods are the first slots of
IDirectInput8A's vtable, in the same order, and so are IDirectInputDevice(2/7)A's
of IDirectInputDevice8A.  DSOUND ordinal 6 is DirectSoundCaptureCreate: no
capture device (DSERR_NODRIVER)."""
NL = chr(10)
path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "DirectInputCreateA"
if marker in s:
    print("already:", path)
else:
    old = '    else if (!strcmp(n,"DirectInput8Create")) r = com_directinput8create(ARG(c,3));' + NL
    new = (old
           + '    else if (!strcmp(n,"DirectInputCreateA")) r = com_directinput8create(ARG(c,2));   /* Porsche: DirectInput 1-7 */' + NL
           + '    else if (!strcmp(n,"#6") && !strcasecmp(e->dll,"DSOUND.dll")) r = 0x88780078u;   /* DirectSoundCaptureCreate: DSERR_NODRIVER */' + NL)
    assert s.count(old) == 1
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
