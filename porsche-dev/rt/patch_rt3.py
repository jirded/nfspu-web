"""win32_ext.c: WaitForMultipleObjectsEx, and the wait honours its timeout
(NFSU2's version gave up after ~200 ms even for INFINITE; Porsche's timer
thread waits INFINITE on its events and took WAIT_OBJECT_0 from the stub)."""
NL = chr(10)
path = "runtime/win32_ext.c"
s = open(path, encoding="latin-1").read()
marker = "WaitForMultipleObjectsEx"
if marker in s:
    print("already:", path)
else:
    old1 = '    else if (!strcmp(n,"WaitForMultipleObjects")){' + NL
    new1 = '    else if (!strcmp(n,"WaitForMultipleObjects") || !strcmp(n,"WaitForMultipleObjectsEx")){' + NL
    assert s.count(old1) == 1
    s = s.replace(old1, new1)
    old2 = ("        for (int spin=0; spin<200; spin++){" + NL)
    new2 = ("        uint64_t wfm_t0 = clock_gettime_nsec_np(CLOCK_MONOTONIC);   /* Porsche: the timeout, INFINITE too */" + NL
            + "        for (;;){" + NL)
    assert s.count(old2) == 1
    s = s.replace(old2, new2)
    old3 = ("            if (got!=0x102u || ms==0) break;" + NL
            + "            struct timespec ts={0,1000000L}; nanosleep(&ts,0);" + NL)
    new3 = ("            if (got!=0x102u || ms==0) break;" + NL
            + "            if (ms!=0xFFFFFFFFu && clock_gettime_nsec_np(CLOCK_MONOTONIC) - wfm_t0 >= (uint64_t)ms * 1000000ull) break;" + NL
            + "            struct timespec ts={0,1000000L}; nanosleep(&ts,0);" + NL)
    assert s.count(old3) == 1
    s = s.replace(old3, new3)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
