"""win32.c: PORSCHE_PROF=1, wall time per import (who waits where), the top 12 every 10 s."""
NL = chr(10)
path = "runtime/win32.c"
s = open(path, encoding="latin-1").read()
marker = "PORSCHE_PROF"
if marker in s:
    print("already:", path)
else:
    old1 = "typedef struct { uint32_t calls; uint32_t unimpl; } ImpStat;" + NL
    new1 = ("typedef struct { uint32_t calls; uint32_t unimpl; uint64_t ns; uint32_t pcalls; } ImpStat;" + NL
            + "static int g_prof = -1; static uint64_t g_prof_t0;   /* PORSCHE_PROF=1 */" + NL
            + "static uint64_t prof_now(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint64_t)t.tv_sec * 1000000000ull + (uint64_t)t.tv_nsec; }" + NL)
    assert s.count(old1) == 1
    s = s.replace(old1, new1)
    old2 = "    stat_[idx].calls++; g_win32_calls++;" + NL
    new2 = (old2
            + "    if (g_prof < 0){ const char *pe = getenv(\"PORSCHE_PROF\"); g_prof = pe && *pe == '1'; g_prof_t0 = prof_now(); }" + NL
            + "    uint64_t prof_t = g_prof ? prof_now() : 0;" + NL)
    assert s.count(old2) == 1
    s = s.replace(old2, new2)
    old3 = "    c->eax = r;" + NL + "    c->esp += 4u * (uint32_t)e->nargs;      /* stdcall: the callee cleans up the arguments */" + NL
    new3 = ("    if (g_prof){" + NL
            + "        uint64_t pn = prof_now(); stat_[idx].ns += pn - prof_t; stat_[idx].pcalls++;" + NL
            + "        static uint64_t last; if (!last) last = pn;" + NL
            + "        if (pn - last > 10000000000ull){" + NL
            + "            last = pn;" + NL
            + "            fprintf(stderr, \"[prof] import wall time in the last 10 s (all threads):\\n\");" + NL
            + "            for (int k = 0; k < 12; k++){" + NL
            + "                uint32_t bi = 0xffffffffu; uint64_t bv = 0;" + NL
            + "                for (uint32_t i = 0; i < g_nimps; i++) if (stat_[i].ns > bv){ bv = stat_[i].ns; bi = i; }" + NL
            + "                if (bi == 0xffffffffu) break;" + NL
            + "                fprintf(stderr, \"[prof]   %-28s %8.1f ms in %6u calls\\n\", g_imps[bi].name, (double)bv / 1e6, stat_[bi].pcalls);" + NL
            + "                stat_[bi].ns = 0; stat_[bi].pcalls = 0;" + NL
            + "            }" + NL
            + "            for (uint32_t i = 0; i < g_nimps; i++){ stat_[i].ns = 0; stat_[i].pcalls = 0; }" + NL
            + "        }" + NL
            + "    }" + NL
            + old3)
    assert s.count(old3) == 1, s.count(old3)
    s = s.replace(old3, new3)
    open(path, "w", encoding="latin-1").write(s)
    print("patched:", path)
