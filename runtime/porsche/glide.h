/* Glide 3 (glide3x.dll) for the recompiled Porsche.exe.
 *
 * The game's Glide "thrash" driver, Drivers/voodoo2z.dll, is lifted as the
 * second guest module and calls glide3x.dll through GetProcAddress.  Those
 * calls land here (runtime/porsche/glide.c): the Glide state machine, the
 * texture memory of the TMU, the vertex layout and the linear frame buffer.
 * Drawing goes to a backend through the small interface below, so the same
 * front end serves the native software rasterizer (glide_sw.c) and the
 * browser's WebGPU renderer. */
#ifndef PORSCHE_GLIDE_H
#define PORSCHE_GLIDE_H
#include <stdint.h>

/* A vertex as the backend gets it: window coordinates, origin upper left. */
typedef struct {
    float x, y;
    float ooz;          /* Z buffer value, 0..65535 */
    float oow;          /* 1/w: perspective weight, W buffer and fog */
    float r, g, b, a;   /* 0..255 */
    float sow, tow;     /* texture coordinates divided by w, normalised to 0..1 per texture */
    float qow;          /* the texture's own 1/w (GR_PARAM_Q0), else oow */
} GlVert;

/* Everything a draw depends on besides the vertices. */
typedef struct {
    /* combine units */
    uint8_t cc_func, cc_factor, cc_local, cc_other, cc_invert;
    uint8_t ac_func, ac_factor, ac_local, ac_other, ac_invert;
    uint8_t tc_rgb_func, tc_rgb_factor, tc_a_func, tc_a_factor, tc_rgb_invert, tc_a_invert;
    uint32_t constant_color;          /* ARGB */
    /* texture */
    int tex;                          /* backend texture id, 0 = none */
    uint8_t tex_filter_min, tex_filter_mag, tex_clamp_s, tex_clamp_t;
    /* blending and tests */
    uint8_t blend_rgb_src, blend_rgb_dst, blend_a_src, blend_a_dst;
    uint8_t alpha_func; uint8_t alpha_ref;
    uint8_t depth_mode, depth_func, depth_mask; int16_t depth_bias;
    uint8_t chroma_on; uint32_t chroma_color;      /* RGB */
    uint8_t mask_rgb, mask_a;
    uint8_t fog_mode; uint32_t fog_color; uint8_t fog_table[64];
    int clip_x0, clip_y0, clip_x1, clip_y1;
} GlState;

/* backend: native software rasterizer or the browser's WebGPU encoder */
void glb_open(int w, int h);
void glb_clear(const GlState *s, uint32_t argb, uint8_t alpha, uint32_t depth);
void glb_tris(const GlState *s, const GlVert *v, int ntri);       /* 3*ntri vertices */
void glb_lines(const GlState *s, const GlVert *v, int nline);     /* 2*nline vertices */
void glb_points(const GlState *s, const GlVert *v, int npoint);
void glb_swap(void);
int  glb_tex_new(int w, int h, const uint32_t *argb);   /* ARGB8888 texels; returns an id > 0 */
void glb_tex_free(int id);
/* the colour buffer as 32-bit ARGB, for linear frame buffer reads and writes */
void glb_read_rgb(int x, int y, int w, int h, uint32_t *argb, int stride_px);
void glb_write_rgb(int x, int y, int w, int h, const uint32_t *argb, int stride_px, const uint8_t *written);
/* the area the picture is shown in, in device pixels; 0x0: not known */
void glb_view_size(int *w, int *h);

/* runtime/porsche/glide.c */
struct CPU;
int glide_call(struct CPU *c, const char *name, uint32_t *out);
void glide_report(void);
/* wide screen driving (porsche_hle.c): the area the picture is shown in, and the size a Glide resolution has
 * from now on (w = 0: its own again) */
void glide_view_size(int *w, int *h);
void glide_mode_size(uint32_t id, int w, int h);
#endif
