/* The Glide WebGPU backend's shared layout: runtime/porsche_web/glide_gpu.c
 * (the game side, which records) and web-porsche/src/glide-gpu.ts (the page,
 * which draws).  Keep the numbers in step with glide-gpu.ts.
 *
 * Control block (host kind PG_HOST_KIND, registered at the first frame):
 *   u32 magic 'PGL1', version, w, h (the game's resolution)
 *   i32 ready      frames published, the newest is `ready`
 *   i32 done       the newest frame the page has drawn (the page writes it and notifies)
 *   u32 nslot, slot_bytes, slot[PG_NSLOT]   frame f lives in slot f % nslot
 *   i32 attached   1 while a page draws the frames (the game does not wait for a page that is not there)
 *
 * A frame's packet: a header, the commands from PG_CMD_OFF, the vertices
 * from PG_VERT_OFF (PG_VERT_FLOATS floats each).  Commands: u32 op, u32 size
 * in bytes (header included), then the payload. */
#ifndef PORSCHE_GLIDE_GPU_H
#define PORSCHE_GLIDE_GPU_H
#include <stdint.h>

#define PG_HOST_KIND   9
#define PG_MAGIC       0x314c4750u   /* 'PGL1' */
#define PG_NSLOT       3
#define PG_SLOT_BYTES  (6u << 20)
#define PG_CMD_OFF     64u
#define PG_VERT_OFF    (2u << 20)
#define PG_VERT_FLOATS 12            /* x, y, ooz, oow, r, g, b, a, sow, tow, qow, 0 */

typedef struct {
    uint32_t magic, version, w, h;
    int32_t  ready, done;
    uint32_t nslot, slot_bytes;
    uint32_t slot[PG_NSLOT];
    int32_t  attached;
} PgCtl;

typedef struct { uint32_t frame, ncmd, cmd_bytes, nvert; } PgHeader;

enum { PG_OP_CLEAR = 1, PG_OP_DRAW = 2, PG_OP_TEXNEW = 3, PG_OP_TEXFREE = 4, PG_OP_LFB = 5 };
/* CLEAR:   x0 y0 x1 y1, argb, alpha, depth (0..65535), mask_rgb, mask_depth
 * DRAW:    prim (0 triangles, 1 lines, 2 points), first vertex, vertex count, then the 256-byte state
 * TEXNEW:  id, w, h, pixels (RGBA bytes in wasm memory, valid until `done` passes this frame)
 * TEXFREE: id
 * LFB:     x, y, w, h, pixels (RGBA), the frame buffer region the game wrote */

/* The draw state: 64 u32, copied as is into the page's uniform buffer. */
enum {
    S_CC_FUNC, S_CC_FACTOR, S_CC_LOCAL, S_CC_OTHER, S_CC_INVERT,
    S_AC_FUNC, S_AC_FACTOR, S_AC_LOCAL, S_AC_OTHER, S_AC_INVERT,
    S_TC_RGB_FUNC, S_TC_RGB_FACTOR, S_TC_A_FUNC, S_TC_A_FACTOR, S_TC_RGB_INVERT, S_TC_A_INVERT,
    S_CONSTANT, S_TEX, S_FILTER_MIN, S_FILTER_MAG, S_CLAMP_S, S_CLAMP_T,
    S_BLEND_RGB_SRC, S_BLEND_RGB_DST, S_BLEND_A_SRC, S_BLEND_A_DST,
    S_ALPHA_FUNC, S_ALPHA_REF, S_DEPTH_MODE, S_DEPTH_FUNC, S_DEPTH_MASK, S_DEPTH_BIAS,
    S_CHROMA_ON, S_CHROMA, S_MASK_RGB, S_MASK_A, S_FOG_MODE, S_FOG_COLOR,
    S_FOG_TABLE,                       /* 16 u32: the 64 table bytes */
    S_CLIP = S_FOG_TABLE + 16,         /* 4: x0 y0 x1 y1 */
    S_SCREEN_W = S_CLIP + 4, S_SCREEN_H,
    S_COUNT = 64
};
#endif
