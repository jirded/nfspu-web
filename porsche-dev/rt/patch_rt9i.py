"""win32.c host_us: with vclock_stall_runs_real() the clock runs at real speed in a long stall.

NFSU2's virtual clock only creeps (1 us a read) once a frame has taken longer
than 200 ms, for its busy waits on the way into a race.  Porsche loads its
race without a frame for seconds and waits on its timer's ticks meanwhile,
which come at game-clock speed: the load never ended.  With the hook (weak, 0;
runtime/porsche/porsche_hle.c answers 1) the clock runs at real speed past
250 ms without a frame: base + d + creep = base + the real time since the last
frame.  vclock_tick adds the creep to the base, so the clock stays monotonic."""
NL = chr(10)
path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "vclock_stall_runs_real"
if marker in s:
    print("already:", path)
else:
    old = ("    if (stalled > 60000ull){" + NL
           + "        if (atomic_load(&g_vclock_creep) < 200000ull){" + NL)
    new = ("    if (stalled > 250000ull && vclock_stall_runs_real()){" + NL
           + "        uint64_t want = stalled - d, cur = atomic_load(&g_vclock_creep);" + NL
           + "        while (cur < want && !atomic_compare_exchange_weak(&g_vclock_creep, &cur, want)) {}" + NL
           + "    }" + NL
           + "    else if (stalled > 60000ull){" + NL
           + "        if (atomic_load(&g_vclock_creep) < 200000ull){" + NL)
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new)
    old2 = "_Atomic uint64_t g_vclock_freeze = 0;" + NL + "uint64_t host_us(void){" + NL
    new2 = ("_Atomic uint64_t g_vclock_freeze = 0;" + NL
            + "/* Porsche (runtime/porsche/porsche_hle.c): 1 = the clock runs at real speed in a long stall */" + NL
            + "__attribute__((weak)) int vclock_stall_runs_real(void){ return 0; }" + NL
            + "uint64_t host_us(void){" + NL)
    assert s.count(old2) == 1, s.count(old2)
    s = s.replace(old2, new2)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
