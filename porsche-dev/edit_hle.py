import sys
p = sys.argv[1]; s = open(p).read()
old = "/* win32.c: past 250 ms without a frame"
new = ("/* 0x5366E0 jobs(): runs the game's scheduled jobs.  Every wait loop of the\n"
       " * game calls it on each pass (wait(ticks) 0x53C380, the race load 0x4A88A0,\n"
       " * the race loop's 0x4B0FA0), and those loops wait on what the other guest\n"
       " * threads do: the race clock moves on in the jobs of the game's tick thread.\n"
       " * The runtime hands the guest lock to a queued thread at Win32 calls\n"
       " * (guest_fair_yield, every 1024th); a loop that makes none got the same here. */\n"
       "void sub_005366e0_orig(CPU *c);\n"
       "void guest_fair_yield(void);                                     /* win32_ext.c */\n"
       "void sub_005366e0(CPU *c){ guest_fair_yield(); sub_005366e0_orig(c); }\n\n"
       + old)
assert s.count(old) == 1 and 'sub_005366e0_orig' not in s
open(p, 'w').write(s.replace(old, new)); print('ok')
