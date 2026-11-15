/* Native Linux, headless entry point for the recompiled Porsche.exe
 * (NFS Porsche Unleashed v3.5).  Modelled on tests/boot.c (the Mac) and
 * runtime/web/main_web.c: memory, the PE image, TEB/PEB, file root, dispatch,
 * win32; then the guest's entry point on its own thread.  No window, no GPU:
 * the graphics/audio/input stand-ins are runtime/web/null_platform.c.
 *
 *   porsche_boot /path/to/Porsche.exe
 */
#include "cpu.h"
#include "decls.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <setjmp.h>
#include <pthread.h>

#define PORSCHE_ENTRY 0x005a2d1au

extern jmp_buf g_exit_jmp; extern int g_exit_code, g_exit_armed; extern int g_bt_on;
void dispatch_init(void); void dispatch_report(void);
void win32_init(void); void win32_report(void);
void com_report(void);
void fileio_set_root(const char*);
void fileio_set_write_root(const char*);
void guest_lock(CPU*); void guest_unlock(void);
int mem_load_pe(const char *path);
void win32_set_trace_max(uint32_t);
extern void (*g_report_fn)(void);

/* Native guest layout (tests/boot.c) */
#define TEB_BASE   0x00C00000u
#define PEB_BASE   0x00C10000u
#define STACK_LO   0x7F000000u
#define STACK_HI   0x7FF00000u

static CPU cpu;

static void all_reports(void){
    static int done; if (done) return; done = 1;
    { void glide_report(void); glide_report(); }
    win32_report();
    dispatch_report();
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
    return 0;
}

int main(int argc, char **argv){
    const char *exe = argc > 1 ? argv[1] : "Porsche.exe";
    CPU *const c = &cpu; (void)c;

    mem_init();
    if (mem_load_pe(exe)) return 1;
    mem_commit(TEB_BASE, 0x20000);
    mem_commit(STACK_LO, STACK_HI - STACK_LO);
    fileio_set_root(exe);
    { const char *sd = getenv("PORSCHE_SAVEDIR"); if (sd && *sd) fileio_set_write_root(sd); }
    dispatch_init(); win32_init();
    if (getenv("BT")) g_bt_on = 1;
    { void com_set_trace(int); com_set_trace(getenv("COMTRACE") ? 1 : 0); }
    g_report_fn = all_reports;
    if (getenv("TRACE_MAX")) win32_set_trace_max((uint32_t)atoi(getenv("TRACE_MAX")));
    else if (getenv("VERBOSE")) win32_set_trace_max(400u);

    /* TEB (fs:) */
    MR32(TEB_BASE+0x00) = 0xFFFFFFFFu;      /* end of the SEH chain */
    MR32(TEB_BASE+0x04) = STACK_HI;         /* StackBase  */
    MR32(TEB_BASE+0x08) = STACK_LO;         /* StackLimit */
    MR32(TEB_BASE+0x18) = TEB_BASE;         /* Self       */
    MR32(TEB_BASE+0x20) = 100;              /* ProcessId  */
    MR32(TEB_BASE+0x24) = 1;                /* ThreadId   */
    MR32(TEB_BASE+0x2C) = TEB_BASE+0x1000;  /* TLS array  */
    MR32(TEB_BASE+0x30) = PEB_BASE;         /* PEB        */
    mem_commit(PEB_BASE, 0x1000);
    MR32(PEB_BASE+0x08) = 0x00400000u;      /* ImageBaseAddress */
    MR32(PEB_BASE+0xA4) = 5; MR32(PEB_BASE+0xA8) = 1;

    { extern CPU *g_cur_cpu; g_cur_cpu = &cpu; }
    memset(&cpu, 0, sizeof cpu);
    cpu.esp = STACK_HI - 0x1000u;
    cpu.top = 0; cpu.fcw = 0x027f;   /* Windows default: PC=53, RC near, masked */
    cpu.fs_base = TEB_BASE;
    cpu.gs_base = TEB_BASE;

    fprintf(stderr, "\n=== Porsche.exe: running the entry point 0x%08x ===\n", PORSCHE_ENTRY);
    fprintf(stderr, "    TEB=0x%08x  stack=0x%08x..0x%08x  esp=0x%08x\n\n", TEB_BASE, STACK_LO, STACK_HI, cpu.esp);
    {
        pthread_attr_t at; pthread_attr_init(&at);
        pthread_attr_setstacksize(&at, 64u * 1024u * 1024u);
        pthread_t th;
        if (pthread_create(&th, &at, guest_main_thread, 0) != 0){
            fprintf(stderr, "could not start the guest main thread\n"); return 1; }
        pthread_join(th, 0);
    }
    all_reports();
    return g_exit_code;
}
