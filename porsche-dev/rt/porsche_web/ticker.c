/* Precise sleeps in the browser.
 *
 * A wasm thread sleeps with memory.atomic.wait32 and a timeout, which Chrome
 * on Windows ends on the OS timer: a 1 ms sleep takes ~15.6 ms.  Porsche
 * sleeps for short times everywhere (its 6 ms multimedia timer, Sleep(1)
 * loops, the runtime's 1 ms polls), and ran at 3 frames a second.
 *
 * This nanosleep replaces wasi-libc's (a strong definition in an object
 * file wins over the library's): while the page runs its ticker
 * (web-porsche/src/ticker.ts: a worker that notifies `tick` every 0.5 ms
 * while anyone sleeps), a sleeper waits on `tick` without a timeout and
 * looks at the clock at every tick, so it wakes within half a millisecond of
 * its deadline.  Without the ticker: the plain WASI sleep.
 *
 * Shared block (host kind 10): i32 tick, on (1 while the ticker runs),
 * sleepers (threads sleeping now; the ticker spins only while it is not 0). */
#include <stdint.h>
#include <time.h>
#include <errno.h>
#include "host_abi.h"

#define PORSCHE_HOST_KIND_TICK 10
typedef struct { int32_t tick, on, sleepers, pad; } Ticker;
static Ticker g_tk;
int clock_nanosleep(clockid_t clk, int flags, const struct timespec *req, struct timespec *rem);

void porsche_ticker_init(void){ nfsu2_register(PORSCHE_HOST_KIND_TICK, &g_tk, sizeof g_tk); }

static double mono_ms(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec * 1e3 + (double)t.tv_nsec * 1e-6; }

int nanosleep(const struct timespec *req, struct timespec *rem){
    if (!req || req->tv_nsec < 0 || req->tv_nsec >= 1000000000L){ errno = EINVAL; return -1; }
    if (rem){ rem->tv_sec = 0; rem->tv_nsec = 0; }
    double ms = (double)req->tv_sec * 1e3 + (double)req->tv_nsec * 1e-6;
    if (ms <= 0) return 0;
    if (!__atomic_load_n(&g_tk.on, __ATOMIC_SEQ_CST)){
        int e = clock_nanosleep(CLOCK_MONOTONIC, 0, req, rem);
        if (e){ errno = e; return -1; }
        return 0;
    }
    double end = mono_ms() + ms;
    if (__atomic_add_fetch(&g_tk.sleepers, 1, __ATOMIC_SEQ_CST) == 1)
        __builtin_wasm_memory_atomic_notify((int *)&g_tk.sleepers, 1u);   /* wake the ticker */
    for (;;){
        double left = end - mono_ms();
        if (left <= 0) break;
        int32_t t = __atomic_load_n(&g_tk.tick, __ATOMIC_SEQ_CST);
        /* woken by the next tick; the timeout only matters if the ticker stops */
        __builtin_wasm_memory_atomic_wait32((int *)&g_tk.tick, t, (int64_t)((left + 20.0) * 1e6));
    }
    __atomic_sub_fetch(&g_tk.sleepers, 1, __ATOMIC_SEQ_CST);
    return 0;
}
