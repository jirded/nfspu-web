/* Porsche.exe functions the runtime replaces: tools/genall.py lifts each one
 * as sub_XXXXXXXX_orig (OVERRIDE=..., tools/porsche_lift.sh) and the calls
 * come here. */
#include "cpu.h"
#include <time.h>
#include <unistd.h>

void guest_lock(CPU *c); void guest_unlock(void);                 /* win32_ext.c */

static uint64_t mono_us(void){
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000ull + (uint64_t)ts.tv_nsec / 1000ull;
}

/* 0x53C2E0 ticks(): the game's tick count [0x6B7C7C], which its multimedia
 * timer callback moves on.  The game waits on it in loops that call nothing
 * else of the system: wait(ticks) 0x53C380 and the timed loops of the race
 * load (0x4A88A0, 640 ticks for its sound).  On Windows the timer thread runs
 * beside them; here it needs the guest lock, which the waiting thread held:
 * the count never moved and the load stood still (a black screen, the sound
 * gone).  A thread that has read the same count 32 times running for more
 * than 2 ms gives the lock up for a millisecond. */
void sub_0053c2e0(CPU *c){
    static uint32_t last, same;
    static uint64_t since;
    uint32_t v = MR32(0x6b7c7cu);
    if (v != last){ last = v; same = 0; }
    else if (++same == 32) since = mono_us();
    else if (same > 32 && (same & 15u) == 0 && mono_us() - since > 2000u){
        guest_unlock(); usleep(1000); guest_lock(c);
        v = MR32(0x6b7c7cu);
    }
    c->eax = v;
    POP32(c->eip);
}

/* 0x5366E0 jobs(): runs the game's scheduled jobs.  Every wait loop of the
 * game calls it on each pass (wait(ticks) 0x53C380, the race load 0x4A88A0,
 * the race loop's 0x4B0FA0), and those loops wait on what the other guest
 * threads do: the race clock moves on in the jobs of the game's tick thread.
 * The runtime hands the guest lock to a queued thread at Win32 calls
 * (guest_fair_yield, every 1024th); a loop that makes none got the same here. */
void sub_005366e0_orig(CPU *c);
void guest_fair_yield(void);                                     /* win32_ext.c */
void sub_005366e0(CPU *c){ guest_fair_yield(); sub_005366e0_orig(c); }

/* 0x567F70 poll(request): looks whether a request to the game's file thread is done.  The read-and-wait
 * around 0x533CA1 calls it in a loop until it is, with one of the game's critical sections held.  The
 * file thread (tid 102) needs the guest lock to do the request, and the runtime never hands the lock
 * over inside a critical section (guest_fair_yield): the loop span for good and the race load stood
 * still on a black screen, two times in three (the third time the file thread had got the lock before
 * the loop began).  On Windows the file thread runs beside the loop.  Here each poll lets the threads
 * that queue for the lock have it first. */
void sub_00567f70_orig(CPU *c);
void sub_00567f70(CPU *c){ guest_unlock(); guest_lock(c); sub_00567f70_orig(c); }

/* win32.c: past 250 ms without a frame the game clock runs at real speed (a
 * load: the race's track, the timer ticks the load waits for), instead of the
 * slow creep NFSU2 needs for its busy waits on the way into a race. */
int vclock_stall_runs_real(void){ return 1; }
