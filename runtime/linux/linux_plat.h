/* Force-included (-include) in every file of the native Linux build
 * (tools/porsche_native.sh).  Linux stand-ins for the macOS-only APIs the
 * shared runtime uses; the headers in runtime/linux/compat cover the rest.
 * Modelled on runtime/web/compat/wasm_plat.h, minus the wasm-only parts
 * (pthread_exit trampoline, time zone from the page). */
#ifndef PORSCHE_LINUX_PLAT_H
#define PORSCHE_LINUX_PLAT_H
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <stdint.h>
#include <time.h>
#include <pthread.h>
#include <unistd.h>

#ifndef CLOCK_UPTIME_RAW
#define CLOCK_UPTIME_RAW CLOCK_MONOTONIC
#endif
static inline uint64_t clock_gettime_nsec_np(clockid_t id){
    struct timespec ts; clock_gettime(id, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}
/* macOS pthread_setname_np(name) names the calling thread; glibc takes the thread too */
static inline int porsche_setname_self(const char *name){
    char b[16]; int i = 0;
    for (; name && name[i] && i < 15; i++) b[i] = name[i];
    b[i] = 0;
    return pthread_setname_np(pthread_self(), b);
}
#define pthread_setname_np(n) porsche_setname_self(n)
#endif
