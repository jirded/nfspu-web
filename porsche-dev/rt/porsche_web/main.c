/* Porsche Unleashed in the browser: the entry point of porsche.wasm.
 *
 * runtime/web/main_web.c (NFSU2's) without the NFSU2 game patches: memory,
 * the PE image, TEB/PEB, file roots, dispatch, win32, the page's input and
 * status, then Porsche.exe's entry point on its own thread.  The page
 * (web-porsche/src/main.ts) runs this _start on a game worker.
 *
 * Paths are the host's mounts: /data is the game folder (read-only), /save
 * the save overlay (saves, registry, logs). */
#include "cpu.h"
#include "decls.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <setjmp.h>
#include <pthread.h>

extern jmp_buf g_exit_jmp; extern int g_exit_code, g_exit_armed; extern int g_bt_on;
void dispatch_init(void); void dispatch_report(void);
void win32_init(void); void win32_report(void);
void com_set_trace(int);
void fileio_set_root(const char*);
void fileio_set_write_root(const char*);
void fileio_set_readonly_root(int);
void lifecycle_guest_exited(int code); int lifecycle_drain_writes(double max_s);
int win32_freeze_guest(int max_ms);
void guest_lock(CPU*); void guest_unlock(void);
int mem_load_pe(const char *path);
void win32_set_trace_max(uint32_t);
void glide_report(void);
extern void (*g_report_fn)(void);

/* wasm guest layout (cpu.h GUEST_END), as main_web.c */
#define TEB_BASE   0x00C00000u
#define PEB_BASE   0x00C10000u
#define STACK_LO   0x05000000u
#define STACK_HI   0x05FF0000u
#define PORSCHE_ENTRY 0x005a2d1au

static CPU cpu;

static void all_reports(void){
    static int done; if (done) return; done = 1;
    glide_report(); win32_report(); dispatch_report();
}

static void *guest_main_thread(void *unused){
    (void)unused;
    CPU *const c = &cpu;
    if (setjmp(g_exit_jmp) == 0){
        g_exit_armed = 1;
        guest_lock(&cpu);
        PUSH32(0xDEADC0DEu);
        sub_005a2d1a(&cpu);
        guest_unlock();
        fprintf(stderr, "\n*** guest entry point returned (eip=0x%08x, eax=0x%08x)\n", cpu.eip, cpu.eax);
    } else {
        fprintf(stderr, "\n*** guest exited with code %d\n", g_exit_code);
        guest_unlock();
    }
    lifecycle_guest_exited(g_exit_code);
    return 0;
}

int main(int argc, char **argv){
    const char *exe = argc > 1 ? argv[1] : "/data/Porsche.exe";
    CPU *const c = &cpu; (void)c;
    mem_init();
    if (mem_load_pe(exe)) return 1;
    mem_commit(TEB_BASE, 0x20000);
    mem_commit(STACK_LO, STACK_HI - STACK_LO);
    fileio_set_root(exe);
    { const char *sd = getenv("NFSU2_SAVEDIR"); if (sd && *sd) fileio_set_write_root(sd); }
    { const char *ro = getenv("NFSU2_READONLY_DATA");
      if (ro && *ro && *ro != '0'){ fileio_set_readonly_root(1); fprintf(stderr, "file: game folder is read-only\n"); } }
    { extern void porsche_ticker_init(void); porsche_ticker_init(); }   /* precise sleeps (ticker.c) */
    dispatch_init(); win32_init();
    { extern void status_web_start(void); status_web_start(); }   /* counters for the page */
    { extern void input_web_init(void); input_web_init(); }       /* the page's keys, mouse, focus */
    if (getenv("BT")) g_bt_on = 1;
    com_set_trace(getenv("COMTRACE") ? 1 : 0);
    g_report_fn = all_reports;
    if (getenv("TRACE_MAX")) win32_set_trace_max((uint32_t)atoi(getenv("TRACE_MAX")));

    MR32(TEB_BASE+0x00) = 0xFFFFFFFFu;
    MR32(TEB_BASE+0x04) = STACK_HI;
    MR32(TEB_BASE+0x08) = STACK_LO;
    MR32(TEB_BASE+0x18) = TEB_BASE;
    MR32(TEB_BASE+0x20) = 100;
    MR32(TEB_BASE+0x24) = 1;
    MR32(TEB_BASE+0x2C) = TEB_BASE+0x1000;
    MR32(TEB_BASE+0x30) = PEB_BASE;
    mem_commit(PEB_BASE, 0x1000);
    MR32(PEB_BASE+0x08) = 0x00400000u;
    MR32(PEB_BASE+0xA4) = 5; MR32(PEB_BASE+0xA8) = 1;

    { extern CPU *g_cur_cpu; g_cur_cpu = &cpu; }
    memset(&cpu, 0, sizeof cpu);
    cpu.esp = STACK_HI - 0x1000u;
    cpu.top = 0; cpu.fcw = 0x027f;
    cpu.fs_base = TEB_BASE;
    cpu.gs_base = TEB_BASE;

    fprintf(stderr, "\n=== Porsche.exe in the browser: entry point 0x%08x ===\n", PORSCHE_ENTRY);
    {
        pthread_attr_t at; pthread_attr_init(&at);
        pthread_attr_setstacksize(&at, 16u * 1024u * 1024u);
        pthread_t th;
        if (pthread_create(&th, &at, guest_main_thread, 0) != 0){
            fprintf(stderr, "could not start the guest main thread\n"); return 1; }
        pthread_join(th, 0);
    }
    lifecycle_drain_writes(5.0);
    if (!win32_freeze_guest(2000)) fprintf(stderr, "app: a guest thread still holds the guest lock\n");
    all_reports();
    return g_exit_code;
}
