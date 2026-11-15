/* Porsche in the browser: the software Glide backend's finished frames for
 * the page (web-porsche/src/main.ts draws them on a canvas).
 *
 * glide_sw.c calls glb_present() at every grBufferSwap with its front buffer
 * (ARGB).  The frame is converted to RGBA bytes into one of two buffers and the
 * control block, published with nfsu2_register(PORSCHE_HOST_KIND_FB), says
 * which one is complete:
 *
 *   u32 magic 'PFB1', version 1, width, height, frame (count), buf[2] (wasm
 *   addresses), cur (index of the latest complete buffer)
 *
 * The page reads `cur` then the pixels; the next frame goes into the other
 * buffer, so a frame being copied is never written at the same time unless
 * the page is a whole frame late. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "host_abi.h"

#define PORSCHE_HOST_KIND_FB 8

typedef struct { uint32_t magic, version, w, h, frame, buf[2], cur; } FbCtl;
static FbCtl g_fb = { 0x31424650u /* 'PFB1' */, 1, 0, 0, 0, { 0, 0 }, 0 };
static uint32_t *g_px[2];
static int g_pw, g_ph, g_registered;

void glb_present(const uint32_t *argb, int w, int h){
    if (w <= 0 || h <= 0) return;
    if (w != g_pw || h != g_ph){
        for (int i = 0; i < 2; i++){ free(g_px[i]); g_px[i] = calloc((size_t)w * h, 4); }
        g_pw = w; g_ph = h;
    }
    if (!g_px[0] || !g_px[1]) return;
    unsigned nxt = __atomic_load_n(&g_fb.cur, __ATOMIC_ACQUIRE) ^ 1u;
    uint32_t *d = g_px[nxt];
    size_t n = (size_t)w * h;
    for (size_t i = 0; i < n; i++){
        uint32_t c = argb[i];   /* 0xAARRGGBB -> bytes R, G, B, 255 */
        d[i] = 0xff000000u | (c & 0x0000ff00u) | ((c >> 16) & 0xffu) | ((c & 0xffu) << 16);
    }
    g_fb.buf[0] = (uint32_t)(uintptr_t)g_px[0];
    g_fb.buf[1] = (uint32_t)(uintptr_t)g_px[1];
    __atomic_store_n(&g_fb.w, (uint32_t)w, __ATOMIC_RELAXED);
    __atomic_store_n(&g_fb.h, (uint32_t)h, __ATOMIC_RELAXED);
    __atomic_store_n(&g_fb.cur, nxt, __ATOMIC_RELEASE);
    __atomic_add_fetch(&g_fb.frame, 1u, __ATOMIC_RELEASE);
    if (!g_registered){ g_registered = 1; nfsu2_register(PORSCHE_HOST_KIND_FB, &g_fb, sizeof g_fb); }
}
