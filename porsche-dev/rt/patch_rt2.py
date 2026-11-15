"""argcount.py: stdcall argument counts of the imports Porsche.exe adds (Win32 API docs)."""
NL = chr(10)
path = "tools/argcount.py"
s = open(path, encoding="latin-1").read()
marker = "# Porsche.exe imports"
if marker in s:
    print("already:", path)
else:
    add = {
        "#6": 3,  # DSOUND ordinal 6: DirectSoundCaptureCreate(guid, out, outer)
        "AdjustWindowRectEx": 4, "CallNextHookEx": 4, "CharUpperA": 1, "CreateProcessA": 10,
        "DirectDrawEnumerateA": 2, "DirectInputCreateA": 4, "DisableThreadLibraryCalls": 1,
        "FindWindowA": 2, "FormatMessageA": 7, "GetCommModemStatus": 2, "GetCommProperties": 2,
        "GetFileVersionInfoA": 4, "GetFileVersionInfoSizeA": 2, "GetKeyState": 1, "GetKeyboardType": 1,
        "GetLogicalDriveStringsA": 2, "GetVolumeInformationA": 8, "GetWindowDC": 1,
        "OpenFileMappingA": 3, "OpenMutexA": 3, "OpenSemaphoreA": 3, "PulseEvent": 1,
        "RegisterClassA": 1, "ReleaseDC": 2, "SendNotifyMessageA": 4, "SetEnvironmentVariableW": 2,
        "SetWindowsHookExA": 4, "SystemParametersInfoA": 4, "UnhookWindowsHookEx": 1,
        "VerQueryValueA": 4, "WaitForMultipleObjectsEx": 5, "__WSAFDIsSet": 2, "keybd_event": 4,
    }
    line = "KNOWN={" + NL
    assert s.count(line) == 1, s.count(line)
    body = "  " + marker + " (stdcall argument counts from the Win32 API)" + NL
    for k, v in add.items():
        body += "  " + repr(k) + ":" + str(v) + "," + NL
    s = s.replace(line, line + body)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
