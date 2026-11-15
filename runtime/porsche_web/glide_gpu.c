/* Glide backend for the browser's WebGPU renderer: records each frame into
 * a packet in shared memory for web-porsche/src/glide-gpu.ts (layout in
 * glide_gpu.h).  Implements the glb_* interface of runtime/porsche/glide.h,
 * as glide_sw.c does natively.
 *
 * Frames: the game records into slot (frame % PG_NSLOT); grBufferSwap
 * publishes it (ready) and moves to the next slot once the page is done with
 * the frame that used it before (at most PG_NSLOT - 1 frames ahead of the
 * page; with no page attached frames are simply overwritten).  Texture and
 * frame buffer pixels go in buffers of their own, freed when the page has
 * drawn the frame that uploaded them. */
#include "glide.h"
#include "glide_gpu.h"
#include "host_abi.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

void guest_wait_begin(void); void guest_wait_end(void);   /* win32_ext.c: release the guest lock around a host wait */
static inline int32_t ald(int32_t *p){ return __atomic_load_n(p, __ATOMIC_SEQ_CST); }
static inline void ast(int32_t *p, int32_t v){ __atomic_store_n(p, v, __ATOMIC_SEQ_CST); }
static inline int wait32(int32_t *p, int32_t v, double ms){
    return __builtin_wasm_memory_atomic_wait32((int *)p, v, ms < 0 ? -1 : (int64_t)(ms * 1e6));
}
static double now_ms(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec * 1e-6; }

static PgCtl g_ctl = { PG_MAGIC, 1, 640, 480, 0, 0, PG_NSLOT, PG_SLOT_BYTES, { 0 }, 0 };
static uint8_t *g_slot[PG_NSLOT];
static int g_registered, W = 640, H = 480;
static int32_t g_frame = 1;            /* the frame being recorded */
static uint8_t *P;                     /* its packet */
static uint32_t g_cmd_end, g_nvert, g_ncmd;
static uint32_t *g_last_draw;          /* the open DRAW, extended while the state and primitive stay the same */
static uint64_t g_overflow, g_frames, g_waits; static double g_wait_ms;

/* pixel buffers the page has not uploaded yet: freed once `done` reaches their frame */
typedef struct { void *p; int32_t frame; } Pend;
static Pend *g_pend; static int g_npend, g_cappend;
static void pend_add(void *p){
    if (g_npend == g_cappend){ g_cappend = g_cappend ? g_cappend * 2 : 256; g_pend = realloc(g_pend, sizeof *g_pend * (size_t)g_cappend); }
    g_pend[g_npend++] = (Pend){ p, g_frame };
}
static void pend_collect(void){
    int32_t done = ald(&g_ctl.done), att = ald(&g_ctl.attached);
    int k = 0;
    for (int i = 0; i < g_npend; i++){
        if (g_pend[i].frame <= done || (!att && g_pend[i].frame < g_frame - PG_NSLOT)) free(g_pend[i].p);
        else g_pend[k++] = g_pend[i];
    }
    g_npend = k;
}

static void slot_begin(void){
    P = g_slot[g_frame % PG_NSLOT];
    g_cmd_end = PG_CMD_OFF; g_nvert = 0; g_ncmd = 0; g_last_draw = 0;
}
static void ensure_init(void){
    if (P) return;
    for (int i = 0; i < PG_NSLOT; i++){
        g_slot[i] = malloc(PG_SLOT_BYTES);
        g_ctl.slot[i] = (uint32_t)(uintptr_t)g_slot[i];
    }
    slot_begin();
}
static uint32_t *cmd(uint32_t op, uint32_t words){
    uint32_t bytes = 8u + 4u * words;
    if (g_cmd_end + bytes > PG_VERT_OFF){ g_overflow++; return 0; }
    uint32_t *c = (uint32_t *)(P + g_cmd_end);
    c[0] = op; c[1] = bytes;
    g_cmd_end += bytes; g_ncmd++;
    if (op != PG_OP_DRAW) g_last_draw = 0;
    return c + 2;
}

/* ---------------------------------------------------------------- state */
static void pack_state(const GlState *s, uint32_t *o){
    memset(o, 0, 4u * S_COUNT);
    o[S_CC_FUNC] = s->cc_func; o[S_CC_FACTOR] = s->cc_factor; o[S_CC_LOCAL] = s->cc_local; o[S_CC_OTHER] = s->cc_other; o[S_CC_INVERT] = s->cc_invert;
    o[S_AC_FUNC] = s->ac_func; o[S_AC_FACTOR] = s->ac_factor; o[S_AC_LOCAL] = s->ac_local; o[S_AC_OTHER] = s->ac_other; o[S_AC_INVERT] = s->ac_invert;
    o[S_TC_RGB_FUNC] = s->tc_rgb_func; o[S_TC_RGB_FACTOR] = s->tc_rgb_factor; o[S_TC_A_FUNC] = s->tc_a_func; o[S_TC_A_FACTOR] = s->tc_a_factor;
    o[S_TC_RGB_INVERT] = s->tc_rgb_invert; o[S_TC_A_INVERT] = s->tc_a_invert;
    o[S_CONSTANT] = s->constant_color; o[S_TEX] = (uint32_t)s->tex;
    o[S_FILTER_MIN] = s->tex_filter_min; o[S_FILTER_MAG] = s->tex_filter_mag; o[S_CLAMP_S] = s->tex_clamp_s; o[S_CLAMP_T] = s->tex_clamp_t;
    o[S_BLEND_RGB_SRC] = s->blend_rgb_src; o[S_BLEND_RGB_DST] = s->blend_rgb_dst; o[S_BLEND_A_SRC] = s->blend_a_src; o[S_BLEND_A_DST] = s->blend_a_dst;
    o[S_ALPHA_FUNC] = s->alpha_func; o[S_ALPHA_REF] = s->alpha_ref;
    o[S_DEPTH_MODE] = s->depth_mode; o[S_DEPTH_FUNC] = s->depth_func; o[S_DEPTH_MASK] = s->depth_mask; o[S_DEPTH_BIAS] = (uint32_t)(int32_t)s->depth_bias;
    o[S_CHROMA_ON] = s->chroma_on; o[S_CHROMA] = s->chroma_color; o[S_MASK_RGB] = s->mask_rgb; o[S_MASK_A] = s->mask_a;
    o[S_FOG_MODE] = s->fog_mode; o[S_FOG_COLOR] = s->fog_color;
    if (s->fog_mode) memcpy(&o[S_FOG_TABLE], s->fog_table, 64);
    int x0 = s->clip_x0 > 0 ? s->clip_x0 : 0, y0 = s->clip_y0 > 0 ? s->clip_y0 : 0;
    int x1 = s->clip_x1 < W ? s->clip_x1 : W, y1 = s->clip_y1 < H ? s->clip_y1 : H;
    o[S_CLIP] = (uint32_t)x0; o[S_CLIP + 1] = (uint32_t)y0; o[S_CLIP + 2] = (uint32_t)x1; o[S_CLIP + 3] = (uint32_t)y1;
    o[S_SCREEN_W] = (uint32_t)W; o[S_SCREEN_H] = (uint32_t)H;
}
static void prims(const GlState *s, const GlVert *v, int nv, uint32_t prim){
    ensure_init();
    if (PG_VERT_OFF + 4u * PG_VERT_FLOATS * (g_nvert + (uint32_t)nv) > PG_SLOT_BYTES){ g_overflow++; return; }
    /* the draw before had this very state (glide.h glide_state_serial): its command takes these vertices too.
     * Otherwise the state is packed and compared, and a new command begins when it differs. */
    static uint32_t serial;
    if (!(g_last_draw && g_last_draw[0] == prim && serial == glide_state_serial)){
        uint32_t st[S_COUNT]; pack_state(s, st);
        if (!(g_last_draw && g_last_draw[0] == prim && !memcmp(g_last_draw + 3, st, sizeof st))){
            uint32_t *d = cmd(PG_OP_DRAW, 3 + S_COUNT);
            if (!d) return;
            d[0] = prim; d[1] = g_nvert; d[2] = 0;
            memcpy(d + 3, st, sizeof st);
            g_last_draw = d;
        }
        serial = glide_state_serial;
    }
    float *o = (float *)(P + PG_VERT_OFF) + (size_t)g_nvert * PG_VERT_FLOATS;
    for (int i = 0; i < nv; i++, o += PG_VERT_FLOATS){
        o[0] = v[i].x; o[1] = v[i].y; o[2] = v[i].ooz; o[3] = v[i].oow;
        o[4] = v[i].r; o[5] = v[i].g; o[6] = v[i].b; o[7] = v[i].a;
        o[8] = v[i].sow; o[9] = v[i].tow; o[10] = v[i].qow; o[11] = 0.f;
    }
    g_nvert += (uint32_t)nv; g_last_draw[2] += (uint32_t)nv;
}

/* ---------------------------------------------------------- glb_* entry points */
void glb_view_size(int *w, int *h){ *w = ald(&g_ctl.view_w); *h = ald(&g_ctl.view_h); }
void glb_racing(int on){ ast(&g_ctl.racing, on); }
static uint32_t g_step;
void glb_step(uint32_t step){ g_step = step; }
static void shadow_drop(void);
void glb_open(int w, int h){
    W = w; H = h; g_ctl.w = (uint32_t)w; g_ctl.h = (uint32_t)h;
    shadow_drop();
    ensure_init();
}
void glb_clear(const GlState *s, uint32_t argb, uint8_t alpha, uint32_t depth){
    ensure_init();
    uint32_t *c = cmd(PG_OP_CLEAR, 9);
    if (!c) return;
    int x0 = s->clip_x0 > 0 ? s->clip_x0 : 0, y0 = s->clip_y0 > 0 ? s->clip_y0 : 0;
    int x1 = s->clip_x1 < W ? s->clip_x1 : W, y1 = s->clip_y1 < H ? s->clip_y1 : H;
    c[0] = (uint32_t)x0; c[1] = (uint32_t)y0; c[2] = (uint32_t)x1; c[3] = (uint32_t)y1;
    c[4] = argb; c[5] = alpha; c[6] = depth & 0xffffu; c[7] = s->mask_rgb; c[8] = s->depth_mode && s->depth_mask;
}
void glb_tris(const GlState *s, const GlVert *v, int ntri){ prims(s, v, 3 * ntri, 0); }
void glb_lines(const GlState *s, const GlVert *v, int nline){ prims(s, v, 2 * nline, 1); }
void glb_points(const GlState *s, const GlVert *v, int n){ prims(s, v, n, 2); }

static int g_next_id = 1, *g_free_ids, g_nfree, g_capfree;
static uint8_t *rgba_copy(const uint32_t *argb, size_t n){
    uint8_t *p = malloc(n * 4);
    if (!p) return 0;
    for (size_t i = 0; i < n; i++){ uint32_t c = argb[i];
        p[4*i] = (uint8_t)(c >> 16); p[4*i+1] = (uint8_t)(c >> 8); p[4*i+2] = (uint8_t)c; p[4*i+3] = (uint8_t)(c >> 24); }
    return p;
}
int glb_tex_new(int w, int h, const uint32_t *argb){
    ensure_init();
    int id = g_nfree ? g_free_ids[--g_nfree] : g_next_id++;
    uint8_t *px = rgba_copy(argb, (size_t)w * h);
    uint32_t *c = px ? cmd(PG_OP_TEXNEW, 4) : 0;
    if (!c){ free(px); return id; }
    c[0] = (uint32_t)id; c[1] = (uint32_t)w; c[2] = (uint32_t)h; c[3] = (uint32_t)(uintptr_t)px;
    pend_add(px);
    return id;
}
void glb_tex_free(int id){
    if (id <= 0) return;
    ensure_init();
    uint32_t *c = cmd(PG_OP_TEXFREE, 1);
    if (c) c[0] = (uint32_t)id;
    if (g_nfree == g_capfree){ g_capfree = g_capfree ? g_capfree * 2 : 256; g_free_ids = realloc(g_free_ids, sizeof *g_free_ids * (size_t)g_capfree); }
    g_free_ids[g_nfree++] = id;
}

/* The linear frame buffer: what the game wrote through it (loading screens,
 * movies) is kept here too, so a read lock gets it back; nothing is read
 * back from the GPU. */
static uint32_t *g_shadow; static int g_sw, g_sh;
/* a new display mode starts black: what was written through the frame buffer in the mode before (the game's
 * first loading picture, 640x480) is not in it.  It used to come back in the corner of a larger mode, when the
 * race's loading screen locked the buffer. */
static void shadow_drop(void){ free(g_shadow); g_shadow = 0; g_sw = g_sh = 0; }
void glb_read_rgb(int x, int y, int w, int h, uint32_t *argb, int stride){
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++){
        int sx = x + i, sy = y + j;
        argb[j * stride + i] = g_shadow && sx >= 0 && sy >= 0 && sx < g_sw && sy < g_sh ? g_shadow[sy * g_sw + sx] : 0xff000000u;
    }
}
void glb_write_rgb(int x, int y, int w, int h, const uint32_t *argb, int stride, const uint8_t *written){
    ensure_init();
    if (g_sw != W || g_sh != H){ free(g_shadow); g_shadow = calloc((size_t)W * H, 4); g_sw = W; g_sh = H; }
    if (x < 0 || y < 0 || x + w > W || y + h > H || w <= 0 || h <= 0) return;
    uint32_t *tmp = malloc((size_t)w * h * 4);
    if (!tmp) return;
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++){
        uint32_t c = argb[j * stride + i];
        if (written && !written[j * stride + i]) c = g_shadow[(y + j) * W + x + i];
        tmp[j * w + i] = c; g_shadow[(y + j) * W + x + i] = c;
    }
    uint8_t *px = rgba_copy(tmp, (size_t)w * h);
    free(tmp);
    uint32_t *c = px ? cmd(PG_OP_LFB, 5) : 0;
    if (!c){ free(px); return; }
    c[0] = (uint32_t)x; c[1] = (uint32_t)y; c[2] = (uint32_t)w; c[3] = (uint32_t)h; c[4] = (uint32_t)(uintptr_t)px;
    pend_add(px);
}

void glb_swap(void){
    ensure_init();
    PgHeader *hd = (PgHeader *)P;
    hd->frame = (uint32_t)g_frame; hd->ncmd = g_ncmd; hd->cmd_bytes = g_cmd_end - PG_CMD_OFF; hd->nvert = g_nvert; hd->step = g_step;
    if (!g_registered){ g_registered = 1; nfsu2_register(PG_HOST_KIND, &g_ctl, sizeof g_ctl); }
    ast(&g_ctl.ready, g_frame);
    __builtin_wasm_memory_atomic_notify((int *)&g_ctl.ready, 0xFFFFFFFFu);
    g_frames++;
    /* wait for the page: until it has drawn all but `ahead` of the frames published (glide_gpu.h).  At the most
     * PG_NSLOT - 1, because the next frame's slot was frame (next - PG_NSLOT)'s and the page must be done with it. */
    int32_t ahead = ald(&g_ctl.ahead);
    if (ahead < 0) ahead = 0; else if (ahead > PG_NSLOT - 1) ahead = PG_NSLOT - 1;
    int32_t next = g_frame + 1, need = g_frame - ahead;
    double t0 = now_ms(); int unlocked = 0;
    /* how long the game took to make this frame (from the end of the swap before to this one), for the log; a
     * frame after a stall does not count */
    static double work_from, work_sum, work_max; static int work_n;
    static uint16_t work_hist[400];                               /* 0.1 ms a bucket, to 40 ms */
    if (work_from > 0){
        double wk = t0 - work_from;
        if (wk < 250.0){ work_sum += wk; work_n++; if (wk > work_max) work_max = wk;
                         int b = (int)(wk * 10.0); work_hist[b < 399 ? b : 399]++; }
    }
    /* the page must see every frame (textures are uploaded once): at the start, wait for it to attach */
    static int waited_attach;
    if (!waited_attach){
        waited_attach = 1;
        while (!ald(&g_ctl.attached) && now_ms() - t0 < 20000.0){
            if (!unlocked){ guest_wait_begin(); unlocked = 1; }
            wait32(&g_ctl.attached, 0, 100.0);
        }
        if (!ald(&g_ctl.attached)) fprintf(stderr, "[glide-gpu] no page renderer attached after 20 s: frames are not shown\n");
    }
    while (ald(&g_ctl.attached) && ald(&g_ctl.go) < need){
        if (!unlocked){ guest_wait_begin(); unlocked = 1; g_waits++; }
        int32_t d = ald(&g_ctl.go);
        if (d >= need) break;
        wait32(&g_ctl.go, d, 100.0);
        if (now_ms() - t0 > 2000.0) break;   /* a page that stopped drawing: go on, overwriting */
    }
    if (unlocked) guest_wait_end();
    g_wait_ms += now_ms() - t0;
    g_frame = next;
    pend_collect();
    slot_begin();
    if (g_frames % 600 == 1){
        fprintf(stderr, "[glide-gpu] frame %d: %u commands, %u vertices; waited for the page %llu times, %.0f ms in all; %llu overflows, %d pixel buffers pending\n",
                (int)hd->frame, hd->ncmd, hd->nvert, (unsigned long long)g_waits, g_wait_ms, (unsigned long long)g_overflow, g_npend);
        if (work_n){
            /* the middle frame says more than the average: a frame the system held back counts once, not by its length */
            int half = 0, mid = 0;
            for (; mid < 400 && half + work_hist[mid] <= work_n / 2; mid++) half += work_hist[mid];
            fprintf(stderr, "[glide-gpu] the game's work a frame: %.1f ms the middle one, %.1f on average, %.1f at most%s\n",
                    mid / 10.0, work_sum / work_n, work_max, ald(&g_ctl.racing) ? " (a race)" : "");
        }
        work_sum = work_max = 0; work_n = 0; memset(work_hist, 0, sizeof work_hist);
    }
    work_from = now_ms();
}
