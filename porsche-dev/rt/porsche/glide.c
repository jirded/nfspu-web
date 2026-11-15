/* Glide 3 front end (glide3x.dll) for Porsche.exe's lifted Glide driver,
 * Drivers/voodoo2z.dll.  See glide.h.
 *
 * The driver gets every entry point with GetProcAddress("_grXxx@N");
 * runtime/porsche/porsche_win32.c registers those names as extra imports,
 * so a call lands in glide_call() with the stdcall arguments on the guest
 * stack (argument i at esp + 4*i; win32.c pops them).
 *
 * Constants are Glide 3's (glide.h of the 3dfx Glide 3 SDK). */
#include "cpu.h"
#include "glide.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

uint32_t gheap_alloc(int heap, uint32_t n, int zero);
static uint32_t A(CPU *c, int i){ return MR32(c->esp + 4u * (uint32_t)i); }
static float AF(CPU *c, int i){ uint32_t u = A(c, i); float f; memcpy(&f, &u, 4); return f; }
static int g_log = -1;
#define GLOG(...) do { if (g_log) fprintf(stderr, "[glide] " __VA_ARGS__); } while (0)

/* ------------------------------------------------------------------ state */
static GlState g_st;
uint32_t glide_state_serial = 1;        /* glide.h */
static int g_w = 640, g_h = 480, g_origin_ll = 0, g_open = 0;
static uint32_t g_cformat = 0;          /* GR_COLORFORMAT_ARGB */
static int g_coord_space = 0;           /* GR_WINDOW_COORDS */
static int g_cull = 0;                  /* GR_CULL_DISABLE / NEGATIVE / POSITIVE */
static uint64_t g_frames, g_tris, g_calls, g_unknown;

/* vertex layout: byte offsets into the guest's vertex struct, -1 = off */
enum { P_XY, P_Z, P_W, P_Q, P_FOG, P_A, P_RGB, P_PARGB, P_ST0, P_ST1, P_Q0, P_Q1, P_N };
static int g_off[P_N];

static uint32_t to_argb(uint32_t c){
    switch (g_cformat){
    case 1: return (c & 0xff00ff00u) | ((c >> 16) & 0xffu) | ((c & 0xffu) << 16);   /* ABGR */
    case 2: return (c >> 8) | (c << 24);                                             /* RGBA */
    case 3: { uint32_t b = c >> 24, g = (c >> 16) & 0xff, r = (c >> 8) & 0xff, a = c & 0xff;   /* BGRA */
              return a << 24 | r << 16 | g << 8 | b; }
    default: return c;                                                               /* ARGB */
    }
}

static void state_defaults(void){
    memset(&g_st, 0, sizeof g_st);
    g_st.cc_func = 3; g_st.cc_factor = 8; g_st.cc_local = 0; g_st.cc_other = 0;   /* SCALE_OTHER, ONE, ITERATED */
    g_st.ac_func = 3; g_st.ac_factor = 8; g_st.ac_local = 0; g_st.ac_other = 0;
    g_st.tc_rgb_func = 1; g_st.tc_a_func = 1;                                   /* LOCAL */
    g_st.constant_color = 0xffffffffu;
    g_st.blend_rgb_src = 4; g_st.blend_rgb_dst = 0; g_st.blend_a_src = 4; g_st.blend_a_dst = 0;   /* ONE, ZERO */
    g_st.alpha_func = 7;                                                        /* ALWAYS */
    g_st.depth_func = 1;                                                        /* LESS */
    g_st.depth_mask = 1; g_st.mask_rgb = 1; g_st.mask_a = 1;
    g_st.clip_x0 = 0; g_st.clip_y0 = 0; g_st.clip_x1 = g_w; g_st.clip_y1 = g_h;
    for (int i = 0; i < P_N; i++) g_off[i] = -1;
}

/* ---------------------------------------------------------- texture memory */
#define TMU_MEM   (4u << 20)
#define PAGE_SH   12
static uint8_t  g_tmu[TMU_MEM];
static uint64_t g_page_gen[TMU_MEM >> PAGE_SH], g_wgen = 1;
static uint32_t g_pal[256]; static uint64_t g_pal_gen = 1;

typedef struct { int set; uint32_t start; int small, large, aspect, fmt; } TexSrc;
static TexSrc g_src;
static int g_tex_w, g_tex_h;              /* the current source's level 0 */

static void lod_dims(int lod, int aspect, int *w, int *h){
    int a = aspect >= 0 ? aspect : -aspect;
    int big = 1 << lod, small = big >> a; if (small < 1) small = 1;
    if (aspect >= 0){ *w = big; *h = small; } else { *w = small; *h = big; }
}
static int fmt_bpp(int fmt){ return fmt >= 8 ? 2 : 1; }
static uint32_t level_bytes(int lod, int aspect, int fmt){
    int w, h; lod_dims(lod, aspect, &w, &h); return (uint32_t)(w * h * fmt_bpp(fmt));
}
/* bytes of the levels larger than `lod` (they come first, as Glide packs them) */
static uint32_t level_offset(int lod, int large, int aspect, int fmt){
    uint32_t o = 0; for (int l = large; l > lod; l--) o += level_bytes(l, aspect, fmt); return o;
}
static uint32_t mip_bytes(int small, int large, int aspect, int fmt){
    uint32_t n = level_offset(small - 1, large, aspect, fmt);   /* every level down to `small` */
    return (n + 7u) & ~7u;
}
static void tmu_write(uint32_t dst, uint32_t src_guest, uint32_t n){
    if (dst >= TMU_MEM) return;
    if (n > TMU_MEM - dst) n = TMU_MEM - dst;
    memcpy(g_tmu + dst, g_mem + src_guest, n);
    g_wgen++;
    for (uint32_t p = dst >> PAGE_SH; p <= (dst + n - 1) >> PAGE_SH && p < (TMU_MEM >> PAGE_SH); p++) g_page_gen[p] = g_wgen;
}

/* decoded textures, keyed by what they were made from */
typedef struct { uint32_t start; int fmt, large, aspect, id, w, h; uint64_t stamp, pal_gen; } TexEnt;
#define NTEXC 4096
static TexEnt g_tc[NTEXC];
static int g_ntc;
static uint64_t g_tex_decodes;

static uint32_t c332(uint8_t v){ uint32_t r = (v >> 5) & 7, g = (v >> 2) & 7, b = v & 3;
    return (r * 255 / 7) << 16 | (g * 255 / 7) << 8 | (b * 255 / 3); }
static uint32_t decode_texel(int fmt, const uint8_t *p){
    uint32_t v = fmt >= 8 ? (uint32_t)(p[0] | p[1] << 8) : p[0];
    switch (fmt){
    case 0:  return 0xff000000u | c332((uint8_t)v);                          /* RGB_332 */
    case 2:  return v << 24 | v << 16 | v << 8 | v;                          /* ALPHA_8 */
    case 3:  return 0xff000000u | v << 16 | v << 8 | v;                      /* INTENSITY_8 */
    case 4:  { uint32_t a = (v >> 4) * 17, i = (v & 15) * 17; return a << 24 | i << 16 | i << 8 | i; }
    case 5:  return 0xff000000u | (g_pal[v] & 0xffffffu);                    /* P_8 */
    case 8:  return (v >> 8) << 24 | c332((uint8_t)v);                       /* ARGB_8332 */
    case 0xa:{ uint32_t r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;   /* RGB_565 */
               return 0xff000000u | (r * 255 / 31) << 16 | (g * 255 / 63) << 8 | (b * 255 / 31); }
    case 0xb:{ uint32_t a = v >> 15 ? 255u : 0u, r = (v >> 10) & 31, g = (v >> 5) & 31, b = v & 31;   /* ARGB_1555 */
               return a << 24 | (r * 255 / 31) << 16 | (g * 255 / 31) << 8 | (b * 255 / 31); }
    case 0xc:{ uint32_t a = (v >> 12) * 17, r = ((v >> 8) & 15) * 17, g = ((v >> 4) & 15) * 17, b = (v & 15) * 17;   /* ARGB_4444 */
               return a << 24 | r << 16 | g << 8 | b; }
    case 0xd:{ uint32_t a = v >> 8, i = v & 0xff; return a << 24 | i << 16 | i << 8 | i; }   /* ALPHA_INTENSITY_88 */
    case 0xe: return (v >> 8) << 24 | (g_pal[v & 0xff] & 0xffffffu);         /* AP_88 */
    default: return 0xffff00ffu;                                             /* YIQ, unknown: magenta */
    }
}
static int tex_current(void){
    if (!g_src.set) return 0;
    const TexSrc *s = &g_src;
    int paletted = s->fmt == 5 || s->fmt == 0xe;
    uint32_t bytes = level_bytes(s->large, s->aspect, s->fmt);
    if (s->start >= TMU_MEM || bytes > TMU_MEM - s->start) return 0;
    uint64_t newest = 0;
    for (uint32_t p = s->start >> PAGE_SH; p <= (s->start + bytes - 1) >> PAGE_SH; p++)
        if (g_page_gen[p] > newest) newest = g_page_gen[p];
    int slot = -1;
    for (int i = 0; i < g_ntc; i++){
        TexEnt *e = &g_tc[i];
        if (e->start == s->start && e->fmt == s->fmt && e->large == s->large && e->aspect == s->aspect){
            if (e->stamp >= newest && (!paletted || e->pal_gen == g_pal_gen)){ g_tex_w = e->w; g_tex_h = e->h; return e->id; }
            glb_tex_free(e->id); slot = i; break;
        }
    }
    if (slot < 0){
        if (g_ntc < NTEXC) slot = g_ntc++;
        else { slot = (int)(g_tex_decodes % NTEXC); glb_tex_free(g_tc[slot].id); }
    }
    int w, h; lod_dims(s->large, s->aspect, &w, &h);
    uint32_t *px = malloc((size_t)w * h * 4);
    const uint8_t *src = g_tmu + s->start; int bpp = fmt_bpp(s->fmt);
    for (int i = 0; i < w * h; i++) px[i] = decode_texel(s->fmt, src + (size_t)i * bpp);
    int id = glb_tex_new(w, h, px);
    {   /* GLIDE_TEXLOG=1: each texture as it is decoded, with how much of it is clear, see-through and solid */
        static int on = -1;
        if (on < 0){ const char *e = getenv("GLIDE_TEXLOG"); on = e && *e && *e != '0'; }
        if (on){
            int clear = 0, part = 0; uint32_t amin = 255, amax = 0;
            for (int i = 0; i < w * h; i++){ uint32_t a = px[i] >> 24; if (!a) clear++; else if (a < 255){ part++; if (a < amin) amin = a; if (a > amax) amax = a; } }
            fprintf(stderr, "[glide] texture %d: format 0x%x %dx%d at 0x%x, clear %d, see-through %d (alpha %u..%u), solid %d\n",
                    id, s->fmt, w, h, s->start, clear, part, part ? amin : 0, part ? amax : 0, w * h - clear - part);
        }
    }
    free(px);
    g_tc[slot] = (TexEnt){ s->start, s->fmt, s->large, s->aspect, id, w, h, g_wgen, g_pal_gen };
    g_tex_decodes++;
    g_tex_w = w; g_tex_h = h;
    return id;
}

/* tex_current()'s answer for as long as only draws are called (glide_call_id); -1: ask again.  Asking walks
 * the texture's pages and the cache of decoded ones: too much for each of a frame's thousands of triangles. */
static int g_tex_now = -1;
static int tex_now(void){ if (g_tex_now < 0) g_tex_now = tex_current(); return g_tex_now; }

/* ---------------------------------------------------------------- vertices */
static void fetch(uint32_t p, GlVert *v){
    memset(v, 0, sizeof *v);
    if (g_off[P_XY] >= 0){ v->x = MRF32(p + g_off[P_XY]); v->y = MRF32(p + g_off[P_XY] + 4); }
    if (g_origin_ll) v->y = (float)g_h - v->y;
    v->ooz = g_off[P_Z] >= 0 ? MRF32(p + g_off[P_Z]) : 0.f;
    v->oow = g_off[P_Q] >= 0 ? MRF32(p + g_off[P_Q]) : g_off[P_W] >= 0 ? MRF32(p + g_off[P_W]) : 1.f;
    if (g_off[P_PARGB] >= 0){
        uint32_t c = to_argb(MR32(p + g_off[P_PARGB]));
        v->a = (float)(c >> 24); v->r = (float)((c >> 16) & 0xff); v->g = (float)((c >> 8) & 0xff); v->b = (float)(c & 0xff);
    } else {
        if (g_off[P_RGB] >= 0){ v->r = MRF32(p + g_off[P_RGB]); v->g = MRF32(p + g_off[P_RGB] + 4); v->b = MRF32(p + g_off[P_RGB] + 8); }
        v->a = g_off[P_A] >= 0 ? MRF32(p + g_off[P_A]) : 255.f;
    }
    v->qow = g_off[P_Q0] >= 0 ? MRF32(p + g_off[P_Q0]) : v->oow;
    if (g_off[P_ST0] >= 0 && g_tex_w > 0){
        /* Glide: s,t run 0..256 along the texture's longer side */
        float big = (float)(g_tex_w > g_tex_h ? g_tex_w : g_tex_h);
        v->sow = MRF32(p + g_off[P_ST0])     / (256.f * (float)g_tex_w / big);
        v->tow = MRF32(p + g_off[P_ST0] + 4) / (256.f * (float)g_tex_h / big);
    }
}
static int culled(const GlVert *a, const GlVert *b, const GlVert *c){
    if (!g_cull) return 0;
    float area = (b->x - a->x) * (c->y - a->y) - (c->x - a->x) * (b->y - a->y);
    if (g_origin_ll) area = -area;      /* Glide's sign is in the window's own y direction */
    return g_cull == 1 ? area < 0.f : area > 0.f;
}
static void draw_tri(uint32_t pa, uint32_t pb, uint32_t pc){
    g_st.tex = tex_now();
    GlVert v[3]; fetch(pa, &v[0]); fetch(pb, &v[1]); fetch(pc, &v[2]);
    if (culled(&v[0], &v[1], &v[2])) return;
    glb_tris(&g_st, v, 1); g_tris++;
}

/* ------------------------------------------------------ linear frame buffer */
static uint32_t g_lfb_guest, g_lfb_size; static int g_lfb_bpp, g_lfb_locked_write, g_lfb_buf;
static uint32_t *g_tmp; static size_t g_tmp_n;
static uint32_t *tmp_px(size_t n){ if (n > g_tmp_n){ free(g_tmp); g_tmp = malloc(n * 4); g_tmp_n = n; } return g_tmp; }
static uint16_t to565(uint32_t c){ return (uint16_t)(((c >> 8) & 0xf800) | ((c >> 5) & 0x07e0) | ((c >> 3) & 0x001f)); }
static uint32_t from565(uint16_t v){ uint32_t r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
    return 0xff000000u | (r * 255 / 31) << 16 | (g * 255 / 63) << 8 | (b * 255 / 31); }
static uint32_t from555(uint16_t v){ uint32_t r = (v >> 10) & 31, g = (v >> 5) & 31, b = v & 31;
    return 0xff000000u | (r * 255 / 31) << 16 | (g * 255 / 31) << 8 | (b * 255 / 31); }

/* ------------------------------------------------------------------- calls */
static uint32_t guest_str(const char *s){
    uint32_t n = (uint32_t)strlen(s) + 1, p = gheap_alloc(1, n, 1);
    if (p) memcpy(g_mem + p, s, n);
    return p;
}
/* Wide screen driving (porsche_hle.c).  Glide's resolutions are a fixed list of sizes; the game is offered some
 * of them at other sizes, made to fit the page: glide_mode_size(id, w, h) says the size resolution `id` has
 * from now on and has it listed (grQueryResolutions below); w = 0 takes both back. */
static int g_mode_size[16][2];
void glide_mode_size(uint32_t id, int w, int h){ if (id < 16){ g_mode_size[id][0] = w; g_mode_size[id][1] = w ? h : 0; } }
/* the area the picture is shown in, in device pixels (0x0: not known).  PORSCHE_VIEW=3440x1440 says it for a
 * test; else the page does */
void glide_view_size(int *w, int *h){
    static int env = -1, ew, eh;
    if (env < 0){ const char *e = getenv("PORSCHE_VIEW"); env = e && sscanf(e, "%dx%d", &ew, &eh) == 2 && ew > 0 && eh > 0; }
    if (env){ *w = ew; *h = eh; } else glb_view_size(w, h);
}
static void res_dims(uint32_t res, int *w, int *h){
    static const short t[][2] = { {320,200},{320,240},{400,256},{512,384},{640,200},{640,350},{640,400},{640,480},
        {800,600},{960,720},{856,480},{512,256},{1024,768},{1280,1024},{1600,1200},{400,300} };
    if (res < 16){ *w = t[res][0]; *h = t[res][1]; } else { *w = 640; *h = 480; }
    if (res < 16 && g_mode_size[res][0]){ *w = g_mode_size[res][0]; *h = g_mode_size[res][1]; }
}

/* The calls by number.  A race makes 95,000 grDrawTriangle and some 40,000 state calls a second: an import is
 * looked up by its name once (glide_id; porsche_win32.c keeps the answer for each import) and called by its
 * number after that (glide_call_id). */
enum {
    G_grGlideInit, G_grGlideShutdown, G_grSstSelect, G_grErrorSetCallback, G_grFinish, G_grDitherMode,
    G_grEnable, G_grDisable, G_grTexLodBiasValue, G_grTexMipMapMode, G_grSstWinOpen, G_grSstWinClose,
    G_guGammaCorrectionRGB, G_grQueryResolutions, G_grGet, G_grGetString, G_grCoordinateSpace, G_grVertexLayout,
    G_grColorCombine, G_grAlphaCombine, G_grTexCombine, G_grAlphaBlendFunction, G_grAlphaTestFunction, G_grAlphaTestReferenceValue,
    G_grDepthBufferMode, G_grDepthBufferFunction, G_grDepthMask, G_grDepthBiasLevel, G_grCullMode, G_grConstantColorValue,
    G_grChromakeyMode, G_grChromakeyValue, G_grColorMask, G_grFogMode, G_grFogColorValue, G_grFogTable,
    G_grClipWindow, G_grTexFilterMode, G_grTexClampMode, G_grTexMinAddress, G_grTexMaxAddress, G_grTexCalcMemRequired,
    G_grTexSource, G_grTexDownloadMipMap, G_grTexDownloadMipMapLevelPartial, G_grTexDownloadTable, G_grBufferClear, G_grBufferSwap,
    G_grRenderBuffer, G_grDrawTriangle, G_grAADrawTriangle, G_grDrawLine, G_grDrawPoint, G_grLfbLock,
    G_grLfbUnlock, G_grLfbReadRegion, G_grLfbWriteRegion,
    G_COUNT
};
static const char *const g_names[G_COUNT] = {
    "grGlideInit", "grGlideShutdown", "grSstSelect", "grErrorSetCallback", "grFinish", "grDitherMode",
    "grEnable", "grDisable", "grTexLodBiasValue", "grTexMipMapMode", "grSstWinOpen", "grSstWinClose",
    "guGammaCorrectionRGB", "grQueryResolutions", "grGet", "grGetString", "grCoordinateSpace", "grVertexLayout",
    "grColorCombine", "grAlphaCombine", "grTexCombine", "grAlphaBlendFunction", "grAlphaTestFunction", "grAlphaTestReferenceValue",
    "grDepthBufferMode", "grDepthBufferFunction", "grDepthMask", "grDepthBiasLevel", "grCullMode", "grConstantColorValue",
    "grChromakeyMode", "grChromakeyValue", "grColorMask", "grFogMode", "grFogColorValue", "grFogTable",
    "grClipWindow", "grTexFilterMode", "grTexClampMode", "grTexMinAddress", "grTexMaxAddress", "grTexCalcMemRequired",
    "grTexSource", "grTexDownloadMipMap", "grTexDownloadMipMapLevelPartial", "grTexDownloadTable", "grBufferClear", "grBufferSwap",
    "grRenderBuffer", "grDrawTriangle", "grAADrawTriangle", "grDrawLine", "grDrawPoint", "grLfbLock",
    "grLfbUnlock", "grLfbReadRegion", "grLfbWriteRegion",
};
/* the number of a call, by the name glide3x.dll exports it under (_grDrawTriangle@12) or the bare one; -1: none */
int glide_id(const char *name){
    char n[64]; const char *p = name[0] == '_' ? name + 1 : name; size_t k = 0;
    for (; p[k] && p[k] != '@' && k < sizeof n - 1; k++) n[k] = p[k];
    n[k] = 0;
    for (int i = 0; i < G_COUNT; i++) if (!strcmp(n, g_names[i])) return i;
    return -1;
}
int glide_call_id(CPU *c, int id, uint32_t *out){
    g_calls++;
    if (id == G_grDrawTriangle){ draw_tri(A(c, 0), A(c, 1), A(c, 2)); *out = 0; return 1; }   /* nine calls in ten */
    if (g_log < 0){ const char *e = getenv("GLIDE_LOG"); g_log = e && *e && *e != '0'; }
    const char *n = g_names[id];
    uint32_t r = 0;
    /* anything but a draw may change what the next draw needs: its texture is looked up again (tex_now) and its
     * state counts as new (glide_state_serial) */
    if (id != G_grAADrawTriangle && id != G_grDrawLine && id != G_grDrawPoint){ g_tex_now = -1; glide_state_serial++; }

    if (id == G_grGlideInit || id == G_grGlideShutdown || id == G_grSstSelect
        || id == G_grErrorSetCallback || id == G_grFinish || id == G_grDitherMode
        || id == G_grEnable || id == G_grDisable || id == G_grTexLodBiasValue
        || id == G_grTexMipMapMode){
        GLOG("%s(0x%x)\n", n, A(c, 0));
    }
    else if (id == G_grSstWinOpen){
        /* (hWnd, resolution, refresh, cformat, origin, ncolor, naux) */
        res_dims(A(c, 1), &g_w, &g_h);
        g_cformat = A(c, 3); g_origin_ll = A(c, 4) == 1;
        state_defaults(); g_open = 1;
        glb_open(g_w, g_h);
        { void metal_set_game_size(unsigned, unsigned); metal_set_game_size((unsigned)g_w, (unsigned)g_h); }   /* the mouse's scale (input_web.c) */
        fprintf(stderr, "[glide] grSstWinOpen %dx%d cformat %u origin %s, %u colour + %u aux buffers\n",
                g_w, g_h, g_cformat, g_origin_ll ? "lower left" : "upper left", A(c, 5), A(c, 6));
        r = 1;
    }
    else if (id == G_grSstWinClose){ g_open = 0; r = 1; }
    else if (id == G_guGammaCorrectionRGB){
        GLOG("guGammaCorrectionRGB(%.2f, %.2f, %.2f)\n", AF(c, 0), AF(c, 1), AF(c, 2));   /* the display's gamma: not applied */
    }
    else if (id == G_grQueryResolutions){
        /* (const GrResolution *template, GrResolution *out): {res, refresh, ncolor, naux} */
        uint32_t t = A(c, 0), o = A(c, 1), cnt = 0;
        for (uint32_t id = 0; id < 16; id++){
            if (id != 7 && id != 8 && id != 0xc && !g_mode_size[id][0]) continue;   /* 640x480, 800x600, 1024x768, and the page's */
            if (t && MR32(t) != 0xffffffffu && MR32(t) != id) continue;
            if (o){ MR32(o + 16*cnt) = id; MR32(o + 16*cnt + 4) = 0; MR32(o + 16*cnt + 8) = 2; MR32(o + 16*cnt + 12) = 1; }
            cnt++;
        }
        r = cnt * 16u;
    }
    else if (id == G_grGet){
        /* (pname, plength, FxI32 *params) -> bytes written */
        uint32_t pn = A(c, 0), len = A(c, 1), pp = A(c, 2);
        int32_t v[4] = {0}; int nv = 1;
        switch (pn){
        case 0x01: v[0] = 16; break;                                    /* BITS_DEPTH */
        case 0x02: v[0] = 5; v[1] = 6; v[2] = 5; v[3] = 0; nv = 4; break;   /* BITS_RGBA */
        case 0x03: v[0] = 0x10000; v[1] = 0x10000; nv = 2; break;       /* FIFO_FULLNESS */
        case 0x04: v[0] = 64; break;                                    /* FOG_TABLE_ENTRIES */
        case 0x05: v[0] = 32; break;                                    /* GAMMA_TABLE_ENTRIES */
        case 0x06: v[0] = 4096; break;                                  /* GLIDE_STATE_SIZE */
        case 0x07: v[0] = 256; break;                                   /* VERTEXLAYOUT_SIZE */
        case 0x08: v[0] = 0; break;                                     /* IS_BUSY */
        case 0x09: v[0] = 1; break;                                     /* LFB_PIXEL_PIPE */
        case 0x0a: v[0] = 256; break;                                   /* MAX_TEXTURE_SIZE */
        case 0x0b: v[0] = 3; break;                                     /* MAX_TEXTURE_ASPECT_RATIO */
        case 0x0c: v[0] = 4 << 20; break;                               /* MEMORY_FB */
        case 0x0d: v[0] = (int32_t)TMU_MEM; break;                      /* MEMORY_TMU */
        case 0x0e: v[0] = 0; break;                                     /* MEMORY_UMA */
        case 0x0f: v[0] = 1; break;                                     /* NUM_BOARDS */
        case 0x10: v[0] = 0; break;                                     /* NON_POWER_OF_TWO_TEXTURES */
        case 0x11: v[0] = 1; break;                                     /* NUM_FB */
        case 0x12: v[0] = 0; break;                                     /* NUM_SWAP_HISTORY_BUFFER */
        case 0x13: v[0] = 1; break;                                     /* NUM_TMU */
        case 0x14: v[0] = 0; break;                                     /* PENDING_BUFFERSWAPS */
        case 0x15: v[0] = 2; break;                                     /* REVISION_FB */
        case 0x16: v[0] = 2; break;                                     /* REVISION_TMU */
        case 0x24: v[0] = 16; break;                                    /* TEXTURE_ALIGN */
        case 0x26: v[0] = 0; v[1] = 0; v[2] = g_w; v[3] = g_h; nv = 4; break;   /* VIEWPORT */
        case 0x27: v[0] = 0; v[1] = 0xffff; nv = 2; break;              /* WDEPTH_MIN_MAX */
        case 0x28: v[0] = 0xffff; v[1] = 0; nv = 2; break;              /* ZDEPTH_MIN_MAX */
        default: nv = 1; v[0] = 0; GLOG("grGet(0x%x) unknown\n", pn); break;
        }
        if (pp && len >= 4u * (uint32_t)nv){ for (int i = 0; i < nv; i++) MR32(pp + 4u*i) = (uint32_t)v[i]; r = 4u * (uint32_t)nv; }
        GLOG("grGet(0x%x) -> %d\n", pn, v[0]);
    }
    else if (id == G_grGetString){
        static uint32_t s[5];
        uint32_t pn = A(c, 0); int i = pn >= 0xa0 && pn <= 0xa4 ? (int)(pn - 0xa0) : 0;
        static const char *txt[5] = { "", "Voodoo2", "Glide", "3Dfx Interactive", "3.10" };
        if (!s[i]) s[i] = guest_str(txt[i]);
        r = s[i];
    }
    else if (id == G_grCoordinateSpace) g_coord_space = (int)A(c, 0);
    else if (id == G_grVertexLayout){
        /* (param, offset, mode) */
        uint32_t pa = A(c, 0); int off = A(c, 2) ? (int)A(c, 1) : -1, i = -1;
        switch (pa){ case 0x01: i = P_XY; break; case 0x02: i = P_Z; break; case 0x03: i = P_W; break; case 0x04: i = P_Q; break;
                     case 0x05: i = P_FOG; break; case 0x10: i = P_A; break; case 0x20: i = P_RGB; break; case 0x30: i = P_PARGB; break;
                     case 0x40: i = P_ST0; break; case 0x41: i = P_ST1; break; case 0x50: i = P_Q0; break; case 0x51: i = P_Q1; break; }
        if (i >= 0) g_off[i] = off;
        GLOG("grVertexLayout(0x%x, %d, %u)\n", pa, (int)A(c, 1), A(c, 2));
    }
    else if (id == G_grColorCombine){ g_st.cc_func = (uint8_t)A(c,0); g_st.cc_factor = (uint8_t)A(c,1); g_st.cc_local = (uint8_t)A(c,2); g_st.cc_other = (uint8_t)A(c,3); g_st.cc_invert = (uint8_t)A(c,4); }
    else if (id == G_grAlphaCombine){ g_st.ac_func = (uint8_t)A(c,0); g_st.ac_factor = (uint8_t)A(c,1); g_st.ac_local = (uint8_t)A(c,2); g_st.ac_other = (uint8_t)A(c,3); g_st.ac_invert = (uint8_t)A(c,4); }
    else if (id == G_grTexCombine){
        if (A(c, 0) == 0){ g_st.tc_rgb_func = (uint8_t)A(c,1); g_st.tc_rgb_factor = (uint8_t)A(c,2); g_st.tc_a_func = (uint8_t)A(c,3);
                           g_st.tc_a_factor = (uint8_t)A(c,4); g_st.tc_rgb_invert = (uint8_t)A(c,5); g_st.tc_a_invert = (uint8_t)A(c,6); } }
    else if (id == G_grAlphaBlendFunction){ g_st.blend_rgb_src = (uint8_t)A(c,0); g_st.blend_rgb_dst = (uint8_t)A(c,1); g_st.blend_a_src = (uint8_t)A(c,2); g_st.blend_a_dst = (uint8_t)A(c,3); }
    else if (id == G_grAlphaTestFunction) g_st.alpha_func = (uint8_t)A(c, 0);
    else if (id == G_grAlphaTestReferenceValue) g_st.alpha_ref = (uint8_t)A(c, 0);
    else if (id == G_grDepthBufferMode) g_st.depth_mode = (uint8_t)A(c, 0);
    else if (id == G_grDepthBufferFunction) g_st.depth_func = (uint8_t)A(c, 0);
    else if (id == G_grDepthMask) g_st.depth_mask = (uint8_t)(A(c, 0) != 0);
    else if (id == G_grDepthBiasLevel) g_st.depth_bias = (int16_t)A(c, 0);
    else if (id == G_grCullMode) g_cull = (int)A(c, 0);
    else if (id == G_grConstantColorValue) g_st.constant_color = to_argb(A(c, 0));
    else if (id == G_grChromakeyMode) g_st.chroma_on = (uint8_t)(A(c, 0) != 0);
    else if (id == G_grChromakeyValue) g_st.chroma_color = to_argb(A(c, 0)) & 0xffffffu;
    else if (id == G_grColorMask){ g_st.mask_rgb = (uint8_t)(A(c, 0) != 0); g_st.mask_a = (uint8_t)(A(c, 1) != 0); }
    else if (id == G_grFogMode) g_st.fog_mode = (uint8_t)(A(c, 0) & 0xff);
    else if (id == G_grFogColorValue) g_st.fog_color = to_argb(A(c, 0));
    else if (id == G_grFogTable){ uint32_t t = A(c, 0); if (t) for (int i = 0; i < 64; i++) g_st.fog_table[i] = MR8(t + (uint32_t)i); }
    else if (id == G_grClipWindow){ g_st.clip_x0 = (int)A(c,0); g_st.clip_y0 = (int)A(c,1); g_st.clip_x1 = (int)A(c,2); g_st.clip_y1 = (int)A(c,3);
        if (g_origin_ll){ int y0 = g_h - g_st.clip_y1, y1 = g_h - g_st.clip_y0; g_st.clip_y0 = y0; g_st.clip_y1 = y1; } }
    else if (id == G_grTexFilterMode){ if (A(c,0) == 0){ g_st.tex_filter_min = (uint8_t)A(c,1); g_st.tex_filter_mag = (uint8_t)A(c,2); } }
    else if (id == G_grTexClampMode){ if (A(c,0) == 0){ g_st.tex_clamp_s = (uint8_t)A(c,1); g_st.tex_clamp_t = (uint8_t)A(c,2); } }
    else if (id == G_grTexMinAddress) r = 0;
    else if (id == G_grTexMaxAddress) r = TMU_MEM - 8u;
    else if (id == G_grTexCalcMemRequired) r = mip_bytes((int)A(c,0), (int)A(c,1), (int)A(c,2), (int)A(c,3));
    else if (id == G_grTexSource){
        /* (tmu, start, evenOdd, GrTexInfo *{small, large, aspect, format, data}) */
        uint32_t ti = A(c, 3);
        if (A(c, 0) == 0 && ti){
            g_src = (TexSrc){ 1, A(c, 1), (int)MR32(ti), (int)MR32(ti + 4), (int)MR32(ti + 8), (int)MR32(ti + 12) };
            lod_dims(g_src.large, g_src.aspect, &g_tex_w, &g_tex_h);
        }
    }
    else if (id == G_grTexDownloadMipMap){
        uint32_t ti = A(c, 3);
        if (ti){ int sm = (int)MR32(ti), lg = (int)MR32(ti + 4), as = (int)MR32(ti + 8), fm = (int)MR32(ti + 12); uint32_t data = MR32(ti + 16);
                 if (data) tmu_write(A(c, 1), data, level_offset(sm - 1, lg, as, fm)); }
    }
    else if (id == G_grTexDownloadMipMapLevelPartial){
        /* (tmu, start, thisLod, largeLod, aspect, format, evenOdd, data, first_row, last_row) */
        int lod = (int)A(c,2), lg = (int)A(c,3), as = (int)A(c,4), fm = (int)A(c,5);
        uint32_t data = A(c,7); int r0 = (int)A(c,8), r1 = (int)A(c,9);
        int w, h; lod_dims(lod, as, &w, &h);
        uint32_t row = (uint32_t)(w * fmt_bpp(fm));
        if (data && r1 >= r0)
            tmu_write(A(c,1) + level_offset(lod, lg, as, fm) + (uint32_t)r0 * row, data, (uint32_t)(r1 - r0 + 1) * row);
        if (r0 > 0) GLOG("partial download rows %d..%d of lod %d\n", r0, r1, lod);
    }
    else if (id == G_grTexDownloadTable){
        uint32_t ty = A(c, 0), d = A(c, 1);
        if (d && (ty == 2 || ty == 3)){
            for (int i = 0; i < 256; i++){
                uint32_t e = MR32(d + 4u*(uint32_t)i);
                if (ty == 3){   /* 6666: a6 r6 g6 b6 */
                    uint32_t a = (e >> 18) & 63, rr = (e >> 12) & 63, gg = (e >> 6) & 63, bb = e & 63;
                    e = (a * 255 / 63) << 24 | (rr * 255 / 63) << 16 | (gg * 255 / 63) << 8 | (bb * 255 / 63);
                }
                g_pal[i] = e;
            }
            g_pal_gen++;
        }
    }
    else if (id == G_grBufferClear){
        /* (color, alpha, depth) */
        glb_clear(&g_st, to_argb(A(c, 0)), (uint8_t)A(c, 1), A(c, 2));
    }
    else if (id == G_grBufferSwap){
        /* the stall watchdog (watchdog.c) counts presents: no frame for a while, a report of every guest thread */
        { void watchdog_on_present(void); watchdog_on_present(); }
        glb_step(MR32(0x6559ecu));   /* the game's own clock, 64 ticks a second (0x4A45D0): a race's world moves by it */
        glb_swap(); g_frames++;
        /* the game's clock (win32.c's virtual clock: QueryPerformanceCounter,
         * timeGetTime) moves on a frame at every present; NFSU2 ticks it from
         * its Direct3D 9 Present, Porsche presents here.  Without it the clock
         * only crept forward through its safety valve and every animation ran
         * at a fraction of its speed.  After the swap, which may wait for the page: a frame's time starts
         * when the game goes on. */
        { void vclock_tick(void); vclock_tick(); }
        if (g_log || (g_frames % 300) == 1) fprintf(stderr, "[glide] frame %llu: %llu triangles so far, %llu texture decodes\n",
            (unsigned long long)g_frames, (unsigned long long)g_tris, (unsigned long long)g_tex_decodes); }
    else if (id == G_grRenderBuffer){ GLOG("grRenderBuffer(%u)\n", A(c, 0)); }
    else if (id == G_grDrawTriangle) draw_tri(A(c, 0), A(c, 1), A(c, 2));
    else if (id == G_grAADrawTriangle) draw_tri(A(c, 0), A(c, 1), A(c, 2));
    else if (id == G_grDrawLine){
        GlVert v[2]; g_st.tex = tex_now(); fetch(A(c, 0), &v[0]); fetch(A(c, 1), &v[1]); glb_lines(&g_st, v, 1); }
    else if (id == G_grDrawPoint){
        GlVert v; g_st.tex = tex_now(); fetch(A(c, 0), &v); glb_points(&g_st, &v, 1); }
    else if (id == G_grLfbLock){
        /* (type, buffer, writeMode, origin, pixelPipeline, GrLfbInfo_t *{size, lfbPtr, stride, writeMode, origin}) */
        uint32_t type = A(c, 0) & 1u, buf = A(c, 1), wm = A(c, 2), info = A(c, 5);
        if (buf > 1 || !info){ r = 0; }
        else {
            int bpp = (wm == 5 || wm == 4) ? 4 : 2;
            uint32_t need = (uint32_t)(g_w * g_h * bpp);
            if (need > g_lfb_size){ g_lfb_guest = gheap_alloc(1, need, 1); g_lfb_size = g_lfb_guest ? need : 0; }
            if (!g_lfb_guest){ r = 0; }
            else {
                uint32_t *px = tmp_px((size_t)g_w * g_h);
                glb_read_rgb(0, 0, g_w, g_h, px, g_w);
                for (int i = 0; i < g_w * g_h; i++){
                    if (bpp == 2) MR16(g_lfb_guest + 2u*(uint32_t)i) = to565(px[i]);
                    else MR32(g_lfb_guest + 4u*(uint32_t)i) = px[i];
                }
                g_lfb_bpp = bpp; g_lfb_locked_write = type == 1; g_lfb_buf = (int)buf;
                MR32(info + 4) = g_lfb_guest; MR32(info + 8) = (uint32_t)(g_w * bpp);
                MR32(info + 12) = bpp == 4 ? 5u : 0u; MR32(info + 16) = 0;   /* 565 or 8888, upper left */
                r = 1;
            }
        }
        GLOG("grLfbLock(type %u, buffer %u, mode 0x%x) -> %u\n", A(c, 0), buf, wm, r);
    }
    else if (id == G_grLfbUnlock){
        GLOG("grLfbUnlock(type %u, buffer %u)\n", A(c, 0), A(c, 1));
        if (g_lfb_locked_write && g_lfb_guest){
            uint32_t *px = tmp_px((size_t)g_w * g_h);
            for (int i = 0; i < g_w * g_h; i++)
                px[i] = g_lfb_bpp == 2 ? from565(MR16(g_lfb_guest + 2u*(uint32_t)i)) : (MR32(g_lfb_guest + 4u*(uint32_t)i) | 0xff000000u);
            if (getenv("GLIDE_LFBSTAT")){   /* how much of the frame a write lock really changes */
                static uint32_t *before; static size_t bn; static uint64_t locks, changed, rows_lo = ~0ull, rows_hi;
                if (bn != (size_t)g_w * g_h){ free(before); bn = (size_t)g_w * g_h; before = malloc(bn * 4); }
                glb_read_rgb(0, 0, g_w, g_h, before, g_w);
                for (int i = 0; i < g_w * g_h; i++) if ((before[i] & 0xf8fcf8u) != (px[i] & 0xf8fcf8u)){
                    changed++; uint64_t y = (uint64_t)(i / g_w); if (y < rows_lo) rows_lo = y; if (y > rows_hi) rows_hi = y; }
                if (++locks % 100 == 0){
                    fprintf(stderr, "[glide] lfb: %llu write locks, %.0f changed pixels a lock, rows %llu..%llu\n",
                            (unsigned long long)locks, (double)changed / 100.0, (unsigned long long)rows_lo, (unsigned long long)rows_hi);
                    changed = 0; rows_lo = ~0ull; rows_hi = 0;
                }
            }
            glb_write_rgb(0, 0, g_w, g_h, px, g_w, 0);
        }
        g_lfb_locked_write = 0; r = 1;
    }
    else if (id == G_grLfbReadRegion){
        /* (src_buffer, x, y, w, h, dst_stride, dst) -> 565 */
        int x = (int)A(c,1), y = (int)A(c,2), w = (int)A(c,3), h = (int)A(c,4); uint32_t st = A(c,5), d = A(c,6);
        if (w > 0 && h > 0 && d){ uint32_t *px = tmp_px((size_t)w * h); glb_read_rgb(x, y, w, h, px, w);
            for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) MR16(d + (uint32_t)j*st + 2u*(uint32_t)i) = to565(px[j*w + i]); }
        r = 1;
    }
    else if (id == G_grLfbWriteRegion){
        /* (dst_buffer, x, y, src_format, w, h, pixelPipeline, src_stride, src) */
        int x = (int)A(c,1), y = (int)A(c,2), fmt = (int)A(c,3), w = (int)A(c,4), h = (int)A(c,5);
        uint32_t st = A(c,7), s = A(c,8);
        if (w > 0 && h > 0 && s){
            uint32_t *px = tmp_px((size_t)w * h);
            for (int j = 0; j < h; j++) for (int i = 0; i < w; i++){
                uint32_t a = s + (uint32_t)j*st;
                px[j*w + i] = fmt == 0 ? from565(MR16(a + 2u*(uint32_t)i)) : fmt == 1 || fmt == 2 ? from555(MR16(a + 2u*(uint32_t)i))
                            : fmt == 4 || fmt == 5 ? (MR32(a + 4u*(uint32_t)i) | 0xff000000u) : 0xffff00ffu;
            }
            glb_write_rgb(x, y, w, h, px, w, 0);
        }
        r = 1;
    }
    else { *out = 0; return 1; }
    *out = r;
    return 1;
}
int glide_call(CPU *c, const char *name, uint32_t *out){
    int id = glide_id(name);
    if (id < 0){
        g_unknown++;
        fprintf(stderr, "[glide] %s: not implemented\n", name);
        *out = 0;
        return 1;   /* handled: returns 0 */
    }
    return glide_call_id(c, id, out);
}

/* The renderer's frame count: the mouse goes to the game one change a frame
 * (runtime/web/input_web.c mouse_take); with NFSU2's renderer's count (no
 * Direct3D presents here) a press and its release were taken together after
 * a second, and every click was lost. */
long metal_frames(void){ return (long)g_frames; }

void glide_report(void){
    fprintf(stderr, "[glide] %llu calls, %llu frames, %llu triangles, %llu texture decodes, %llu unknown calls\n",
            (unsigned long long)g_calls, (unsigned long long)g_frames, (unsigned long long)g_tris,
            (unsigned long long)g_tex_decodes, (unsigned long long)g_unknown);
}
