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

/* ---- Wide screen driving: the options' "screen size" also offers pictures that fill the page ----
 *
 * The game takes its display modes from the thrash driver's table (40 bytes a row: width, height, depth, 4,
 * known to the driver, then how many buffers Glide gives it with and without a depth buffer, which the driver
 * asks Glide; the table is at [[display + 0x70] + 8], row 1 is 640x480, 2 800x600, 3 1024x768).  A row is one
 * of Glide's resolutions.  The options list the rows Glide has (0x4BC710), a row is found by its exact size
 * (0x5376C0), and the player's choice is kept as a size (0x657A48 width, 0x657A4C height).
 *
 * Four rows this game never used are given other sizes here: 720, 1080 and 1440 lines at the aspect of the
 * page's view, and the view's own size in pixels.  Glide (glide.c) lists them with those sizes.  The menus
 * stay 640x480; a race in one of the four fills the page, and 0x5391B0 below widens its view. */
#include <math.h>
#include <stdio.h>
#include <string.h>
void glide_view_size(int *w, int *h);                             /* porsche/glide.c */
void glide_mode_size(uint32_t id, int w, int h);
#define MODE_BYTES 40u
#define CUR_MODE   0x619780u                                      /* the row in use, then its width, height, depth */
#define CFG_W      0x657a48u                                      /* the size the player's options ask a race for */
#define CFG_H      0x657a4cu
/* the rows: Glide's resolution (the driver's own pairing), the size it had, the lines it gets (0: the view's own size) */
static const struct { uint32_t row, id, w0, h0, lines; } WIDE[4] = {
    { 4, 0xd, 1280, 1024, 720 }, { 5, 0xe, 1600, 1200, 1080 }, { 6, 0x3, 512, 384, 1440 }, { 9, 0x6, 640, 400, 0 },
};

/* the driver's table, 0 when it is not the one this was written for */
static uint32_t mode_table(void){
    static uint32_t at;
    static int looked;
    if (!looked){
        uint32_t disp = MR32(0x628130u), drv = disp ? MR32(disp + 0x70u) : 0, list = drv ? MR32(drv + 8u) : 0;
        if (!list) return 0;                                      /* no display yet: look again later */
        looked = 1;
        int ok = MR32(list + MODE_BYTES) == 640 && MR32(list + MODE_BYTES + 4u) == 480;
        for (int k = 0; ok && k < 4; k++){
            uint32_t e = list + WIDE[k].row * MODE_BYTES;
            ok = MR32(e) == WIDE[k].w0 && MR32(e + 4u) == WIDE[k].h0;
        }
        if (ok) at = list; else fprintf(stderr, "[wide] the driver's table of modes is not the known one: no wide modes\n");
    }
    return at;
}

/* the four rows get their sizes from the page's view as it is now.  A row in use keeps its size; a row that
 * would repeat another, and all four while the view is not known, are not offered. */
static void wide_refresh(void){
    uint32_t list = mode_table();
    if (!list) return;
    int vw = 0, vh = 0;
    glide_view_size(&vw, &vh);
    if (vw > 8192 || vh > 8192){ double k = 8192.0 / (vw > vh ? vw : vh); vw = (int)(vw * k); vh = (int)(vh * k); }
    double a = vw > 0 && vh > 0 ? (double)vw / vh : 0;
    if (a > 4.0) a = 4.0; else if (a && a < 1.0) a = 1.0;         /* the widest and the narrowest picture made */
    for (int k = 0; k < 4; k++){
        uint32_t e = list + WIDE[k].row * MODE_BYTES, w = 0, h = 0;
        if (MR32(CUR_MODE) == WIDE[k].row) continue;
        if (a){
            if (WIDE[k].lines){ h = WIDE[k].lines; w = (uint32_t)(h * a + 0.5) & ~1u; }
            else { w = (uint32_t)vw & ~1u; h = (uint32_t)vh & ~1u; if (h < 480 || w < 640) w = 0; }
        }
        for (uint32_t r = 1; w && r < WIDE[k].row; r++)           /* the same as a row before it */
            if (MR32(list + r * MODE_BYTES) == w && MR32(list + r * MODE_BYTES + 4u) == h && MR32(list + r * MODE_BYTES + 0x18u)) w = 0;
        if (w){
            MR32(e) = w; MR32(e + 4u) = h;
            MR32(e + 0x14u) = MR32(list + MODE_BYTES + 0x14u); MR32(e + 0x18u) = MR32(list + MODE_BYTES + 0x18u);   /* as 640x480 */
        } else { MR32(e + 0x14u) = 0; MR32(e + 0x18u) = 0; }
        glide_mode_size(WIDE[k].id, (int)w, (int)h);
    }
}

/* the size the options ask for may be one a wide row had when the page had another shape: it becomes what
 * that row is now (the same lines; any other size not in the table was the view's own) */
static void wide_follow(uint32_t *w, uint32_t *h){
    uint32_t list = mode_table();
    if (!list) return;
    for (uint32_t r = 1; r < 32; r++)
        if (MR32(list + r * MODE_BYTES) == *w && MR32(list + r * MODE_BYTES + 4u) == *h && MR32(list + r * MODE_BYTES + 0x18u)) return;
    int pick = -1;
    for (int k = 0; k < 4; k++) if (WIDE[k].lines == *h) pick = k;
    if (pick < 0 && *h != 480 && *h != 600 && *h != 768) pick = 3;
    uint32_t e = list + (pick < 0 ? 3u : WIDE[pick].row) * MODE_BYTES;
    if (!MR32(e + 0x18u)) e = list + 3u * MODE_BYTES;             /* not offered now: 1024x768 */
    *w = MR32(e); *h = MR32(e + 4u);
}
static void wide_follow_options(void){
    uint32_t w = MR32(CFG_W), h = MR32(CFG_H);
    wide_follow(&w, &h);
    MR32(CFG_W) = w; MR32(CFG_H) = h;
}

/* 0x467FC0 setMode(w, h, depth, buffers), __thiscall on the display (0x628130), pops 16: every change of the
 * mode after the game's start.  The menus, the films and the loading screens ask for 640x480; the start of a
 * race (the call that returns to 0x4B6CBE; 0x415633 asks the same way) asks for the options' size. */
void sub_00467fc0_orig(CPU *c);
void sub_00467fc0(CPU *c){
    uint32_t from = MR32(c->esp);
    wide_refresh();
    if (from == 0x4b6cbeu || from == 0x415633u){
        uint32_t w = MR32(c->esp + 4u), h = MR32(c->esp + 8u);
        if (w == MR32(CFG_W) && h == MR32(CFG_H)){
            wide_follow_options();
            MR32(c->esp + 4u) = MR32(CFG_W); MR32(c->esp + 8u) = MR32(CFG_H);
        }
    }
    sub_00467fc0_orig(c);
}

/* 0x4152E0 runs a race, from making its views to its end.  The game's own "wide screen" option (0x657D5C: the
 * view is a band with bars above and below it, the dials in the bars) makes a 4:3 picture look wide.  A race
 * in a picture that is wide gets no bars: the option is off while the race runs. */
void sub_004152e0_orig(CPU *c);
void sub_004152e0(CPU *c){
    uint32_t w = MR32(CUR_MODE + 4u), h = MR32(CUR_MODE + 8u), bars = MR32(0x657d5cu);
    int wide = h && w * 3u > h * 4u + 12u;
    if (wide) MR32(0x657d5cu) = 0;
    sub_004152e0_orig(c);
    if (wide) MR32(0x657d5cu) = bars;
}

/* 0x4BC710 makes the options' list of screen sizes, a line a row Glide has */
void sub_004bc710_orig(CPU *c);
void sub_004bc710(CPU *c){ wide_refresh(); wide_follow_options(); sub_004bc710_orig(c); }

/* 0x5A0FBF sprintf.  The call at 0x4BC7BE writes a line of that list, "%d x %d x %d" of width, height and
 * depth: a wide row is named by its lines ("1080p"), the view's own size without the depth. */
void sub_005a0fbf_orig(CPU *c);
void sub_005a0fbf(CPU *c){
    uint32_t list = MR32(c->esp) == 0x4bc7c3u ? mode_table() : 0;
    if (list){
        uint32_t w = MR32(c->esp + 0xcu), h = MR32(c->esp + 0x10u);
        for (int k = 0; k < 4; k++){
            uint32_t e = list + WIDE[k].row * MODE_BYTES;
            if (MR32(e) != w || MR32(e + 4u) != h || !MR32(e + 0x18u)) continue;
            char t[32];
            int n = WIDE[k].lines ? snprintf(t, sizeof t, "%up", h) : snprintf(t, sizeof t, "%u x %u", w, h);
            memcpy(&MR8(MR32(c->esp + 4u)), t, (size_t)n + 1);
            c->eax = (uint32_t)n;
            POP32(c->eip);
            return;
        }
    }
    sub_005a0fbf_orig(c);
}

/* ---- The menus' pictures and texts come out in the order the game meant ----
 *
 * The menus do not draw as they go: every picture and text is put into a sorted list (0x65B958, a tree) and the
 * list is drawn when a control is done (0x4DA5F0).  0x4D9450 orders two entries (__thiscall, one argument,
 * "does this come before that"): by depth, the farther first (+0x18, a float); then by the turn it was put in
 * (+4, a counter); and entries of one turn by the texture or font they use (+0xC, an address), so that those
 * with the same one are drawn together.  A control's label shares the turn of the picture under it, so which of
 * the two came first was a matter of where the heap had put the font and the picture.  On Windows the font was
 * the higher one: the label was drawn last and showed.  Here it was the lower one: the name of the chosen tab
 * in the options (white on the red wedge) was under the wedge.  Now, within a turn, pictures (+0 is 0) come
 * before texts whatever their addresses. */
void sub_004d9450(CPU *c){
    uint32_t a = c->ecx, b = MR32(c->esp + 4u), r;
    float az = MRF32(a + 0x18u), bz = MRF32(b + 0x18u);
    if (az > bz) r = 1;
    else if (az < bz) r = 0;
    else if (MR32(a + 4u) != MR32(b + 4u)) r = MR32(a + 4u) < MR32(b + 4u);
    else if (!MR32(a) != !MR32(b)) r = !MR32(a);
    else r = MR32(a + 0xcu) < MR32(b + 0xcu);
    c->eax = r;
    POP32(c->eip); c->esp += 4u;
}

/* 0x5391B0 perspective(angle across in degrees, aspect, near, far), __thiscall, pops 16: makes the projection
 * and the view's side planes.  A race calls it with aspect = (the view's part of the screen) * 640 / 480
 * whatever the picture's size, so a picture wider than 4:3 would be the 4:3 one stretched.  Here the angle
 * across grows by as much as the picture is wider and the aspect follows: what is seen up and down stays,
 * more is seen to the sides. */
void sub_005391b0_orig(CPU *c);
void sub_005391b0(CPU *c){
    uint32_t w = MR32(0x619784u), h = MR32(0x619788u);            /* the display mode in use */
    if (h && w * 3u > h * 4u + 12u){
        float k = ((float)w / (float)h) / (4.0f / 3.0f);
        float half = MRF32(c->esp + 4u) * 0.008726646f;           /* pi / 360: half the angle, in radians */
        MRF32(c->esp + 4u) = atanf(tanf(half) * k) / 0.008726646f;
        MRF32(c->esp + 8u) = MRF32(c->esp + 8u) * k;
    }
    sub_005391b0_orig(c);
}

/* win32.c: past 250 ms without a frame the game clock runs at real speed (a
 * load: the race's track, the timer ticks the load waits for), instead of the
 * slow creep NFSU2 needs for its busy waits on the way into a race. */
int vclock_stall_runs_real(void){ return 1; }
