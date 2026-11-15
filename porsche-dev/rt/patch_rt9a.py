"""com.c QueryInterface: DirectInput objects answer for their older interfaces.

Porsche.exe asks each device for IDirectInputDevice2A
{5944E682-C92E-11CF-BFC7-444553540000}; IDirectInputDevice8A's vtable starts
with the same methods in the same order, so the object itself serves.  The
same for IDirectInput(2/7)A on the IDirectInput8 object."""
NL = chr(10)
path = "runtime/com.c"
s = open(path, encoding="latin-1").read()
marker = "Porsche: DirectInput 1-7 interfaces"
if marker in s:
    print("already:", path)
else:
    old = "        if ((iface==IF_DS || iface==IF_DSBUF) && ppv){" + NL
    new = ("        if ((iface==IF_DS || iface==IF_DSBUF || iface==IF_DIDEV || iface==IF_DI8) && ppv){   /* Porsche: DirectInput 1-7 interfaces */" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
