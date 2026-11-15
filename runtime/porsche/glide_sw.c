/* Software Glide backend for the native, headless Porsche build: a
 * Voodoo-style rasterizer (window-coordinate triangles, linear colour and Z,
 * perspective-correct textures, the colour/alpha/texture combine units,
 * chroma key, alpha test, table fog, blending, depth buffer) into a 32-bit
 * frame buffer.  Frames can be written as PNG files:
 *
 *   PORSCHE_DUMP=N          every N-th frame (and the last one at exit)
 *   PORSCHE_DUMP_DIR=dir    where (default ./frames)
 *   PORSCHE_FPS=0           do not pace grBufferSwap to 60 per second
 *
 * The browser build has a WebGPU backend with the same entry points. */
#include "glide.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <sys/stat.h>

static int W, H;
static uint32_t *g_back, *g_front;
static float *g_depth;
static uint64_t g_nframe;

/* ------------------------------------------------------------- textures */
typedef struct { int w, h; uint32_t *px; } Tex;
#define NTEX 8192
static Tex g_tex[NTEX];
static int g_free[NTEX], g_nfree, g_next = 1;

int glb_tex_new(int w, int h, const uint32_t *argb){
    int id = g_nfree ? g_free[--g_nfree] : (g_next < NTEX ? g_next++ : 0);
    if (!id) return 0;
    g_tex[id].w = w; g_tex[id].h = h;
    g_tex[id].px = malloc((size_t)w * h * 4);
    memcpy(g_tex[id].px, argb, (size_t)w * h * 4);
    return id;
}
void glb_tex_free(int id){
    if (id <= 0 || id >= NTEX || !g_tex[id].px) return;
    free(g_tex[id].px); g_tex[id].px = 0; g_free[g_nfree++] = id;
}

/* ------------------------------------------------------------ PNG output */
static uint32_t crc_tab[256];
static uint32_t crc32_(uint32_t c, const uint8_t *p, size_t n){
    if (!crc_tab[1]) for (uint32_t i = 0; i < 256; i++){ uint32_t x = i; for (int k = 0; k < 8; k++) x = x & 1 ? 0xedb88320u ^ (x >> 1) : x >> 1; crc_tab[i] = x; }
    c = ~c; while (n--) c = crc_tab[(c ^ *p++) & 0xff] ^ (c >> 8); return ~c;
}
static void be32(uint8_t *p, uint32_t v){ p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v; }
static void chunk(FILE *f, const char *type, const uint8_t *d, uint32_t n){
    uint8_t h[8]; be32(h, n); memcpy(h + 4, type, 4); fwrite(h, 1, 8, f);
    if (n) fwrite(d, 1, n, f);
    uint32_t c = crc32_(0, (const uint8_t *)type, 4); c = crc32_(c, d, n);
    uint8_t t[4]; be32(t, c); fwrite(t, 1, 4, f);
}
static void write_png(const char *path, const uint32_t *px, int w, int h){
    size_t raw_n = (size_t)h * (1 + 3 * (size_t)w);
    uint8_t *raw = malloc(raw_n), *q = raw;
    for (int y = 0; y < h; y++){ *q++ = 0; for (int x = 0; x < w; x++){ uint32_t c = px[y * w + x];
        *q++ = (uint8_t)(c >> 16); *q++ = (uint8_t)(c >> 8); *q++ = (uint8_t)c; } }
    size_t nblk = (raw_n + 65534) / 65535, z_n = 2 + raw_n + nblk * 5 + 4;
    uint8_t *z = malloc(z_n), *o = z;
    *o++ = 0x78; *o++ = 0x01;
    uint32_t a1 = 1, a2 = 0;
    for (size_t i = 0; i < raw_n; i++){ a1 = (a1 + raw[i]) % 65521; a2 = (a2 + a1) % 65521; }
    for (size_t off = 0; off < raw_n; off += 65535){
        uint32_t len = (uint32_t)(raw_n - off < 65535 ? raw_n - off : 65535);
        *o++ = off + len >= raw_n ? 1 : 0;
        *o++ = (uint8_t)len; *o++ = (uint8_t)(len >> 8); *o++ = (uint8_t)~len; *o++ = (uint8_t)(~len >> 8);
        memcpy(o, raw + off, len); o += len;
    }
    be32(o, a2 << 16 | a1); o += 4;
    FILE *f = fopen(path, "wb");
    if (f){
        static const uint8_t sig[8] = { 0x89, 'P', 'N', 'G', 13, 10, 26, 10 };
        fwrite(sig, 1, 8, f);
        uint8_t ih[13]; be32(ih, (uint32_t)w); be32(ih + 4, (uint32_t)h); ih[8] = 8; ih[9] = 2; ih[10] = ih[11] = ih[12] = 0;
        chunk(f, "IHDR", ih, 13); chunk(f, "IDAT", z, (uint32_t)(o - z)); chunk(f, "IEND", 0, 0);
        fclose(f);
    }
    free(raw); free(z);
}
static void dump_frame(const char *tag){
    const char *dir = getenv("PORSCHE_DUMP_DIR"); if (!dir || !*dir) dir = "frames";
    mkdir(dir, 0755);
    char path[512]; snprintf(path, sizeof path, "%s/%s%06llu.png", dir, tag, (unsigned long long)g_nframe);
    write_png(path, g_front, W, H);
    fprintf(stderr, "[glide-sw] wrote %s\n", path);
}
static void at_exit_dump(void){ if (g_front && getenv("PORSCHE_DUMP")) dump_frame("last_"); }

void glb_view_size(int *w, int *h){ *w = 0; *h = 0; }   /* no page to fill */
void glb_racing(int on){ (void)on; }
void glb_step(uint32_t step){ (void)step; }
void glb_open(int w, int h){
    if (w == W && h == H && g_back) return;
    W = w; H = h;
    free(g_back); free(g_front); free(g_depth);
    g_back = calloc((size_t)W * H, 4); g_front = calloc((size_t)W * H, 4); g_depth = calloc((size_t)W * H, sizeof(float));
    static int reg; if (!reg){ reg = 1; atexit(at_exit_dump); }
}

/* --------------------------------------------------------------- pixels */
typedef struct { float r, g, b, a; } C4;
static float clamp01(float v){ return v < 0.f ? 0.f : v > 1.f ? 1.f : v; }
static int cmp(int func, float a, float b){
    switch (func){ case 0: return 0; case 1: return a < b; case 2: return a == b; case 3: return a <= b;
                   case 4: return a > b; case 5: return a != b; case 6: return a >= b; default: return 1; }
}
static C4 sample(const GlState *s, const Tex *t, float u, float v){
    float fu = u * (float)t->w, fv = v * (float)t->h;
    int bil = s->tex_filter_mag == 1;
    if (bil){ fu -= 0.5f; fv -= 0.5f; }
    int x0 = (int)floorf(fu), y0 = (int)floorf(fv);
    float ax = fu - (float)x0, ay = fv - (float)y0;
    C4 out = {0, 0, 0, 0};
    for (int k = 0; k < (bil ? 4 : 1); k++){
        int x = x0 + (k & 1), y = y0 + (k >> 1);
        if (s->tex_clamp_s == 1) x = x < 0 ? 0 : x >= t->w ? t->w - 1 : x;
        else if (s->tex_clamp_s == 2){ int p = t->w * 2; x = ((x % p) + p) % p; if (x >= t->w) x = p - 1 - x; }
        else x = ((x % t->w) + t->w) % t->w;
        if (s->tex_clamp_t == 1) y = y < 0 ? 0 : y >= t->h ? t->h - 1 : y;
        else if (s->tex_clamp_t == 2){ int p = t->h * 2; y = ((y % p) + p) % p; if (y >= t->h) y = p - 1 - y; }
        else y = ((y % t->h) + t->h) % t->h;
        uint32_t c = t->px[y * t->w + x];
        float wgt = bil ? ((k & 1) ? ax : 1.f - ax) * ((k >> 1) ? ay : 1.f - ay) : 1.f;
        out.r += wgt * (float)((c >> 16) & 0xff); out.g += wgt * (float)((c >> 8) & 0xff);
        out.b += wgt * (float)(c & 0xff); out.a += wgt * (float)(c >> 24);
    }
    out.r /= 255.f; out.g /= 255.f; out.b /= 255.f; out.a /= 255.f;
    return out;
}
/* Glide combine function on one channel: f = factor, l = local, o = other, la = local alpha */
static float comb(int func, float f, float l, float o, float la){
    switch (func){
    case 0x0: return 0.f;
    case 0x1: return l;
    case 0x2: return la;
    case 0x3: return f * o;
    case 0x4: return f * o + l;
    case 0x5: return f * o + la;
    case 0x6: return f * (o - l);
    case 0x7: return f * (o - l) + l;
    case 0x8: return f * (o - l) + la;
    case 0x9: return -f * l + l;
    case 0x10: return -f * l + la;
    default: return l;
    }
}
/* factor for one channel: lc = local channel, la/oa = local/other alpha, tc/ta = texture channel/alpha */
static float factor(int fac, float lc, float la, float oa, float tc, float ta){
    switch (fac){
    case 0x0: return 0.f; case 0x1: return lc; case 0x2: return oa; case 0x3: return la;
    case 0x4: return ta;  case 0x5: return tc; case 0x8: return 1.f; case 0x9: return 1.f - lc;
    case 0xa: return 1.f - oa; case 0xb: return 1.f - la; case 0xc: return 1.f - ta; case 0xd: return 1.f - tc;
    default: return 0.f;
    }
}
static float bfac(int f, int is_src, float sc, float sa, float dc, float da){
    switch (f){
    case 0x0: return 0.f; case 0x1: return sa; case 0x2: return is_src ? dc : sc; case 0x3: return da;
    case 0x4: return 1.f; case 0x5: return 1.f - sa; case 0x6: return 1.f - (is_src ? dc : sc); case 0x7: return 1.f - da;
    case 0xf: return is_src ? (sa < 1.f - da ? sa : 1.f - da) : 1.f;
    default: return 1.f;
    }
}
static float fogw[64];
static float fog_from_w(const GlState *s, float w){
    if (!fogw[1]) for (int i = 0; i < 64; i++) fogw[i] = (float)(pow(2.0, 3.0 + (double)(i >> 2)) / (double)(8 - (i & 3)));
    if (w <= fogw[0]) return (float)s->fog_table[0] / 255.f;
    for (int i = 0; i < 63; i++) if (w < fogw[i + 1]){
        float t = (w - fogw[i]) / (fogw[i + 1] - fogw[i]);
        return ((float)s->fog_table[i] + t * ((float)s->fog_table[i + 1] - (float)s->fog_table[i])) / 255.f;
    }
    return (float)s->fog_table[63] / 255.f;
}
static float wdepth(float oow){       /* the W buffer's 4.12 floating point value of w = 1/oow */
    if (oow <= 0.f) return 65535.f;
    float w = 1.f / oow; if (w < 1.f) return 0.f;
    int e; float m = frexpf(w, &e);   /* w = m * 2^e, m in [0.5, 1) */
    float v = (float)((e - 1) << 12) + (m * 2.f - 1.f) * 4096.f;
    return v > 65535.f ? 65535.f : v;
}

static void shade(const GlState *s, const Tex *t, int x, int y, const float *at){
    /* at: ooz, oow, r, g, b, a, sow, tow, qow */
    size_t i = (size_t)y * W + x;
    float ooz = at[0], oow = at[1];
    float dz = 0.f;
    if (s->depth_mode){
        dz = (s->depth_mode == 2 || s->depth_mode == 4) ? wdepth(oow) : ooz;
        dz += (float)s->depth_bias;
        /* the Voodoo clamps depth to its 16 bits: the menu's 2D overlays come at ooz 65536 with LEQUAL against a
         * buffer cleared to 65535, and are drawn (the WebGPU backend clamps the same way) */
        dz = dz < 0.f ? 0.f : dz > 65535.f ? 65535.f : dz;
        if (!cmp(s->depth_func, dz, g_depth[i])) return;
    }
    C4 it = { at[2] / 255.f, at[3] / 255.f, at[4] / 255.f, at[5] / 255.f };
    C4 tx = {0, 0, 0, 0};
    if (t){
        float q = at[8] != 0.f ? at[8] : 1.f;
        C4 tl = sample(s, t, at[6] / q, at[7] / q);
        /* TMU 0: local = its texel, other = nothing upstream */
        float fr = factor(s->tc_rgb_factor, tl.r, tl.a, 0.f, tl.r, tl.a), fa = factor(s->tc_a_factor, tl.a, tl.a, 0.f, tl.a, tl.a);
        tx.r = clamp01(comb(s->tc_rgb_func, fr, tl.r, 0.f, tl.a));
        tx.g = clamp01(comb(s->tc_rgb_func, factor(s->tc_rgb_factor, tl.g, tl.a, 0.f, tl.g, tl.a), tl.g, 0.f, tl.a));
        tx.b = clamp01(comb(s->tc_rgb_func, factor(s->tc_rgb_factor, tl.b, tl.a, 0.f, tl.b, tl.a), tl.b, 0.f, tl.a));
        tx.a = clamp01(comb(s->tc_a_func, fa, tl.a, 0.f, tl.a));
        if (s->tc_rgb_invert){ tx.r = 1.f - tx.r; tx.g = 1.f - tx.g; tx.b = 1.f - tx.b; }
        if (s->tc_a_invert) tx.a = 1.f - tx.a;
    }
    C4 cst = { (float)((s->constant_color >> 16) & 0xff) / 255.f, (float)((s->constant_color >> 8) & 0xff) / 255.f,
               (float)(s->constant_color & 0xff) / 255.f, (float)(s->constant_color >> 24) / 255.f };
    float dep = ooz / 65535.f;
    /* colour combine */
    C4 cl = s->cc_local == 1 ? cst : s->cc_local == 2 ? (C4){dep, dep, dep, dep} : it;
    C4 co = s->cc_other == 1 ? tx : s->cc_other == 2 ? cst : it;
    /* alpha combine */
    float al = s->ac_local == 1 ? cst.a : s->ac_local == 2 ? dep : it.a;
    float ao = s->ac_other == 1 ? tx.a : s->ac_other == 2 ? cst.a : it.a;
    float outa = clamp01(comb(s->ac_func, factor(s->ac_factor, al, al, ao, tx.a, tx.a), al, ao, al));
    if (s->ac_invert) outa = 1.f - outa;
    C4 o;
    o.r = clamp01(comb(s->cc_func, factor(s->cc_factor, cl.r, al, ao, tx.r, tx.a), cl.r, co.r, al));
    o.g = clamp01(comb(s->cc_func, factor(s->cc_factor, cl.g, al, ao, tx.g, tx.a), cl.g, co.g, al));
    o.b = clamp01(comb(s->cc_func, factor(s->cc_factor, cl.b, al, ao, tx.b, tx.a), cl.b, co.b, al));
    if (s->cc_invert){ o.r = 1.f - o.r; o.g = 1.f - o.g; o.b = 1.f - o.b; }
    o.a = outa;
    if (s->chroma_on){
        uint32_t rgb = (uint32_t)(o.r * 255.f + .5f) << 16 | (uint32_t)(o.g * 255.f + .5f) << 8 | (uint32_t)(o.b * 255.f + .5f);
        if (rgb == (s->chroma_color & 0xffffffu)) return;
    }
    if (!cmp(s->alpha_func, (float)(int)(o.a * 255.f + .5f), (float)s->alpha_ref)) return;
    if (s->fog_mode){
        float f = s->fog_mode == 3 ? ooz / 65535.f : fog_from_w(s, oow > 0.f ? 1.f / oow : 65535.f);
        float fr = (float)((s->fog_color >> 16) & 0xff) / 255.f, fg = (float)((s->fog_color >> 8) & 0xff) / 255.f, fb = (float)(s->fog_color & 0xff) / 255.f;
        o.r += f * (fr - o.r); o.g += f * (fg - o.g); o.b += f * (fb - o.b);
    }
    uint32_t d = g_back[i];
    float dr = (float)((d >> 16) & 0xff) / 255.f, dg = (float)((d >> 8) & 0xff) / 255.f, db = (float)(d & 0xff) / 255.f, da = (float)(d >> 24) / 255.f;
    if (!(s->blend_rgb_src == 4 && s->blend_rgb_dst == 0)){
        o.r = clamp01(o.r * bfac(s->blend_rgb_src, 1, o.r, o.a, dr, da) + dr * bfac(s->blend_rgb_dst, 0, o.r, o.a, dr, da));
        o.g = clamp01(o.g * bfac(s->blend_rgb_src, 1, o.g, o.a, dg, da) + dg * bfac(s->blend_rgb_dst, 0, o.g, o.a, dg, da));
        o.b = clamp01(o.b * bfac(s->blend_rgb_src, 1, o.b, o.a, db, da) + db * bfac(s->blend_rgb_dst, 0, o.b, o.a, db, da));
    }
    if (!(s->blend_a_src == 4 && s->blend_a_dst == 0))
        o.a = clamp01(o.a * bfac(s->blend_a_src, 1, o.a, o.a, da, da) + da * bfac(s->blend_a_dst, 0, o.a, o.a, da, da));
    uint32_t nr = s->mask_rgb ? (uint32_t)(o.r * 255.f + .5f) : (d >> 16) & 0xff;
    uint32_t ng = s->mask_rgb ? (uint32_t)(o.g * 255.f + .5f) : (d >> 8) & 0xff;
    uint32_t nb = s->mask_rgb ? (uint32_t)(o.b * 255.f + .5f) : d & 0xff;
    uint32_t na = s->mask_a ? (uint32_t)(o.a * 255.f + .5f) : d >> 24;
    g_back[i] = na << 24 | nr << 16 | ng << 8 | nb;
    if (s->depth_mode && s->depth_mask) g_depth[i] = dz;
}

/* ------------------------------------------------------------ primitives */
static void attrs(const GlVert *v, float *a){
    a[0] = v->ooz; a[1] = v->oow; a[2] = v->r; a[3] = v->g; a[4] = v->b; a[5] = v->a;
    a[6] = v->sow; a[7] = v->tow; a[8] = v->qow;   /* s/w, t/w and 1/w interpolate linearly; s = (s/w)/(1/w) per pixel */
}
static void tri(const GlState *s, const GlVert *a, const GlVert *b, const GlVert *c){
    float area = (b->x - a->x) * (c->y - a->y) - (c->x - a->x) * (b->y - a->y);
    if (area == 0.f || !isfinite(area)) return;
    if (area < 0.f){ const GlVert *t = b; b = c; c = t; area = -area; }
    const Tex *tx = s->tex > 0 && s->tex < NTEX && g_tex[s->tex].px ? &g_tex[s->tex] : 0;
    float A0[9], A1[9], A2[9]; attrs(a, A0); attrs(b, A1); attrs(c, A2);
    int x0 = (int)floorf(fminf(a->x, fminf(b->x, c->x))), x1 = (int)ceilf(fmaxf(a->x, fmaxf(b->x, c->x)));
    int y0 = (int)floorf(fminf(a->y, fminf(b->y, c->y))), y1 = (int)ceilf(fmaxf(a->y, fmaxf(b->y, c->y)));
    int cx0 = s->clip_x0 > 0 ? s->clip_x0 : 0, cy0 = s->clip_y0 > 0 ? s->clip_y0 : 0;
    int cx1 = s->clip_x1 < W ? s->clip_x1 : W, cy1 = s->clip_y1 < H ? s->clip_y1 : H;
    if (x0 < cx0) x0 = cx0; if (y0 < cy0) y0 = cy0; if (x1 > cx1) x1 = cx1; if (y1 > cy1) y1 = cy1;
    /* edges: e(p) = (q.x-p0.x)*(p1.y-p0.y) - (q.y-p0.y)*(p1.x-p0.x), inside >= 0 with the top-left tie rule */
    const GlVert *P[3][2] = { {b, c}, {c, a}, {a, b} };
    float inv = 1.f / area, at[9];
    for (int y = y0; y < y1; y++){
        float py = (float)y + .5f;
        for (int x = x0; x < x1; x++){
            float px = (float)x + .5f, l[3]; int in = 1;
            for (int e = 0; e < 3 && in; e++){
                const GlVert *p0 = P[e][0], *p1 = P[e][1];
                float dx = p1->x - p0->x, dy = p1->y - p0->y;
                float w = (px - p0->x) * dy - (py - p0->y) * dx;
                w = -w;   /* positive inside for area > 0 in this orientation */
                if (w < 0.f || (w == 0.f && !(dy < 0.f || (dy == 0.f && dx > 0.f)))) in = 0;
                l[e] = w * inv;
            }
            if (!in) continue;
            for (int k = 0; k < 9; k++) at[k] = l[0] * A0[k] + l[1] * A1[k] + l[2] * A2[k];
            shade(s, tx, x, y, at);
        }
    }
}
void glb_tris(const GlState *s, const GlVert *v, int ntri){ for (int i = 0; i < ntri; i++) tri(s, &v[3*i], &v[3*i+1], &v[3*i+2]); }
void glb_lines(const GlState *s, const GlVert *v, int n){
    const Tex *tx = s->tex > 0 && s->tex < NTEX && g_tex[s->tex].px ? &g_tex[s->tex] : 0;
    for (int i = 0; i < n; i++){
        const GlVert *a = &v[2*i], *b = &v[2*i+1];
        float A0[9], A1[9], at[9]; attrs(a, A0); attrs(b, A1);
        int steps = (int)fmaxf(fabsf(b->x - a->x), fabsf(b->y - a->y)) + 1;
        for (int k = 0; k < steps; k++){
            float t = steps > 1 ? (float)k / (float)(steps - 1) : 0.f;
            int x = (int)(a->x + t * (b->x - a->x)), y = (int)(a->y + t * (b->y - a->y));
            if (x < s->clip_x0 || y < s->clip_y0 || x >= s->clip_x1 || y >= s->clip_y1 || x < 0 || y < 0 || x >= W || y >= H) continue;
            for (int j = 0; j < 9; j++) at[j] = A0[j] + t * (A1[j] - A0[j]);
            shade(s, tx, x, y, at);
        }
    }
}
void glb_points(const GlState *s, const GlVert *v, int n){
    const Tex *tx = s->tex > 0 && s->tex < NTEX && g_tex[s->tex].px ? &g_tex[s->tex] : 0;
    for (int i = 0; i < n; i++){
        int x = (int)v[i].x, y = (int)v[i].y; float at[9]; attrs(&v[i], at);
        if (x >= 0 && y >= 0 && x < W && y < H) shade(s, tx, x, y, at);
    }
}
void glb_clear(const GlState *s, uint32_t argb, uint8_t alpha, uint32_t depth){
    int x0 = s->clip_x0 > 0 ? s->clip_x0 : 0, y0 = s->clip_y0 > 0 ? s->clip_y0 : 0;
    int x1 = s->clip_x1 < W ? s->clip_x1 : W, y1 = s->clip_y1 < H ? s->clip_y1 : H;
    uint32_t c = (uint32_t)alpha << 24 | (argb & 0xffffffu);
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++){
        size_t i = (size_t)y * W + x;
        if (s->mask_rgb) g_back[i] = c;
        if (s->depth_mode && s->depth_mask) g_depth[i] = (float)(depth & 0xffff);
    }
}
static double now_s(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec + t.tv_nsec * 1e-9; }
/* the finished frame for whoever shows it: the browser build's runtime/porsche_web/fb_web.c; nothing natively */
__attribute__((weak)) void glb_present(const uint32_t *argb, int w, int h){ (void)argb; (void)w; (void)h; }
void glb_swap(void){
    memcpy(g_front, g_back, (size_t)W * H * 4);
    g_nframe++;
    glb_present(g_front, W, H);
    const char *d = getenv("PORSCHE_DUMP");
    if (d && *d){ long n = atol(d); if (n > 0 && g_nframe % (unsigned long)n == 0) dump_frame("f"); }
    const char *fps = getenv("PORSCHE_FPS");
    double hz = fps && *fps ? atof(fps) : 60.0;
    if (hz > 0){
        static double next; double t = now_s();
        if (next == 0 || t > next + 0.1) next = t;
        next += 1.0 / hz;
        if (next > t){ struct timespec ts = { 0, (long)((next - t) * 1e9) }; nanosleep(&ts, 0); }
    }
}
void glb_read_rgb(int x, int y, int w, int h, uint32_t *argb, int stride){
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++){
        int sx = x + i, sy = y + j;
        argb[j * stride + i] = sx >= 0 && sy >= 0 && sx < W && sy < H ? g_back[(size_t)sy * W + sx] : 0;
    }
}
void glb_write_rgb(int x, int y, int w, int h, const uint32_t *argb, int stride, const uint8_t *written){
    for (int j = 0; j < h; j++) for (int i = 0; i < w; i++){
        int sx = x + i, sy = y + j;
        if (written && !written[j * stride + i]) continue;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) g_back[(size_t)sy * W + sx] = argb[j * stride + i];
    }
}
