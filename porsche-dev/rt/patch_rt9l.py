"""win32.c, win32_ext.c: the calls a race makes by the tens of thousands a second go by the import's number.

win32_call finds what an import does by its name: one chain of string compares through win32.c, winsock.c,
fileio.c and win32_ext.c (several hundred compares), and glide3x.dll's calls came after all of them, in
runtime/porsche.  A race draws its triangles one grDrawTriangle each (95,000 a second), sets the Glide state
some 40,000 times a second and enters and leaves a critical section 20,000 times a second: every one of those
walked the whole chain.

1. win32.c: before the chain, win32_call asks porsche_fast_call (runtime/porsche/porsche_win32.c), which
   knows by the import's number whether the call is one of those and does it.
2. win32_ext.c: Enter/LeaveCriticalSection's code becomes two functions (the chain calls them too), so that
   the fast call can reach them."""
NL = chr(10)

path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "porsche_fast_call"
if marker in s:
    print("already:", path)
else:
    old = ("    int handled = 1;" + NL
           + "    const char *n = e->name;" + NL
           + "    uint32_t r = 0;" + NL)
    new = (old + NL
           + "    /* Porsche: the calls a race makes by the tens of thousands a second (glide3x.dll's, the critical" + NL
           + "     * sections) are done by the import's number, past the chain of names below */" + NL
           + "    { int porsche_fast_call(CPU *c, uint32_t idx, const char *dll, const char *name, uint32_t *out);" + NL
           + "      if (porsche_fast_call(c, idx, e->dll, n, &r)) goto fast_done; }" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    old = ("    if (g_prof){" + NL
           + "        uint64_t pn = prof_now(); stat_[idx].ns += pn - prof_t; stat_[idx].pcalls++;" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, "fast_done:" + NL + old)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)

path = "runtime/win32_ext.c"
s = open(path, encoding="latin-1").read()
marker = "win32_cs_enter"
if marker in s:
    print("already:", path)
else:
    enter = ("        pthread_mutex_t *m = cs_for(A(c,0));" + NL
             + "        if (m){" + NL
             + "            g_cs_enter++;" + NL
             + "            if (pthread_mutex_trylock(m) != 0){" + NL
             + "                g_cs_contended++;" + NL
             + "                ts_set(TS_CS, A(c,0));" + NL
             + "                guest_yield_begin();          /* release the GIL while waiting */" + NL
             + "                pthread_mutex_lock(m);" + NL
             + "                guest_yield_end();" + NL
             + "            }" + NL
             + "            tl_cs_depth++;" + NL
             + "            cs_owned(m, cur_tid(c), +1);" + NL
             + "        }" + NL)
    leave = ("        pthread_mutex_t *m = cs_for(A(c,0));" + NL
             + "        if (m && tl_cs_depth > 0){ tl_cs_depth--; cs_owned(m, 0, -1); pthread_mutex_unlock(m); }" + NL)
    old1 = "    else if (!strcmp(n,\"EnterCriticalSection\")){" + NL + enter + "        r=1; }" + NL
    old2 = "    else if (!strcmp(n,\"LeaveCriticalSection\")){" + NL + leave + "        r=1; }" + NL
    assert s.count(old1) == 1, s.count(old1)
    assert s.count(old2) == 1, s.count(old2)
    s = s.replace(old1, "    else if (!strcmp(n,\"EnterCriticalSection\")){ win32_cs_enter(c); r=1; }" + NL)
    s = s.replace(old2, "    else if (!strcmp(n,\"LeaveCriticalSection\")){ win32_cs_leave(c); r=1; }" + NL)
    head = "int win32_ext_call(CPU *c, const char *n, uint32_t *out){" + NL
    assert s.count(head) == 1, s.count(head)
    fns = ("/* Enter/LeaveCriticalSection(lpCriticalSection): by themselves, so that win32.c can call them by the" + NL
           + " * import's number (Porsche: 20,000 times a second in a race) */" + NL
           + "void win32_cs_enter(CPU *c){" + NL + enter.replace(NL + "    ", NL).replace("        pthread_mutex_t", "    pthread_mutex_t", 1) + "}" + NL
           + "void win32_cs_leave(CPU *c){" + NL + leave.replace(NL + "    ", NL).replace("        pthread_mutex_t", "    pthread_mutex_t", 1) + "}" + NL)
    s = s.replace(head, fns + head)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
