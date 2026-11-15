"""win32_ext.c: three waits Porsche.exe needs.

1. PulseEvent (not implemented before: a stub).  Porsche's async request
   queue (0x568b90) wakes its worker thread with it, and the main thread then
   waits for the request (0x567f70): with the stub nothing ever ran.  Pulse:
   the event is set and waiters wake; an auto-reset event is taken by the
   first waiter; a manual-reset one is reset again after the waiters ran.
2. WaitForMultipleObjects(Ex) took a semaphore's whole count; it takes one.
3. GetMessageA blocks while the queue is empty also while the game is
   active: Porsche runs its window message loop on a thread of its own
   (0x53b8d0), which otherwise spun through the guest lock all the time."""
NL = chr(10)
path = "runtime/win32_ext.c"
s = open(path, encoding="latin-1").read()
marker = "Porsche: PulseEvent"
if marker in s:
    print("already:", path)
else:
    old1 = '    else if (!strcmp(n,"CreateSemaphoreA")){'
    new1 = ('    else if (!strcmp(n,"PulseEvent")){ Obj*o=obj_get(A(c,0));   /* Porsche: PulseEvent */' + NL
            + '        if(o){ pthread_mutex_lock(&o->mtx); o->signaled=1; pthread_cond_broadcast(&o->cv); pthread_mutex_unlock(&o->mtx);' + NL
            + '               if (o->manual){ guest_yield_begin(); { struct timespec ts={0,2000000L}; nanosleep(&ts,0); } guest_yield_end();' + NL
            + '                               pthread_mutex_lock(&o->mtx); o->signaled=0; pthread_mutex_unlock(&o->mtx); } }' + NL
            + '        r=1; }' + NL
            + old1)
    assert s.count(old1) == 1, s.count(old1)
    s = s.replace(old1, new1)

    old2 = "                       if(sig && !o->manual) o->signaled=0;" + NL
    new2 = "                       if(sig && o->kind == OB_SEM) o->signaled--; else if(sig && !o->manual) o->signaled=0;" + NL
    assert s.count(old2) == 1, s.count(old2)
    s = s.replace(old2, new2)

    old3 = "        if (g_wmq_head != g_wmq_tail){" + NL + "            if (remove) wm_pop(&m,&wp,&lp);" + NL
    new3 = ("        /* Porsche: a message loop on its own thread blocks in GetMessageA while the queue is empty */" + NL
            + "        if (remove && !strcmp(n,\"GetMessageA\") && g_wmq_head == g_wmq_tail){" + NL
            + "            guest_yield_begin();" + NL
            + "            for (;;){" + NL
            + "                struct timespec ts = { 0, 5000000L }; nanosleep(&ts, 0);" + NL
            + "                guest_yield_end();" + NL
            + "                if (g_wm_activated){ kbd_pump(); lifecycle_pump(); }" + NL
            + "                if (g_wmq_head != g_wmq_tail) break;" + NL
            + "                guest_yield_begin();" + NL
            + "            }" + NL
            + "        }" + NL
            + old3)
    assert s.count(old3) == 1, s.count(old3)
    s = s.replace(old3, new3)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
