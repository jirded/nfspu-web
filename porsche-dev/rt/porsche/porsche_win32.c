/* Porsche.exe: Win32 calls the shared (NFSU2) runtime does not implement.
 * runtime/win32.c asks here after its own layers (fileio, win32_ext) and
 * before it reports a call as a stub.  Platform independent: native Linux
 * and the browser build.
 *
 * Arguments: the return address has been popped, so argument i is at
 * esp + 4*i (as ARG() in win32.c); win32.c pops the stdcall arguments. */
#include "cpu.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

static uint32_t A(CPU *c, int i){ return MR32(c->esp + 4u * (uint32_t)i); }

/* the display the game sees (GetDeviceCaps); the renderer sets the real mode */
#define PORSCHE_DESK_W   1024u
#define PORSCHE_DESK_H    768u
#define PORSCHE_DESK_BPP   32u
#define PORSCHE_HDC  0x00D0DC01u   /* the one device context there is */

/* ---- extra imports: entry points the game's DLLs get with GetProcAddress
 * from libraries that do not exist here.  win32_init() appends them to the
 * import table, so GetProcAddress finds them by name and a call through the
 * returned address comes to porsche_win32_call like any other import. */
#include "glide.h"
typedef struct { uint32_t iat; const char *dll; const char *name; int nargs; } ImpEnt;
static const char *const glide_names[] = {
    "_grColorMask@8", "_grVertexLayout@12", "_grCoordinateSpace@4", "_grQueryResolutions@8",
    "_grTexDownloadMipMapLevelPartial@40", "_grErrorSetCallback@4", "_grDisable@4", "_grEnable@4",
    "_grChromakeyValue@4", "_grAADrawTriangle@24", "_grGetString@4", "_grGet@12", "_grTexLodBiasValue@8",
    "_grTexClampMode@12", "_grTexSource@16", "_grTexMaxAddress@4", "_grTexMinAddress@4",
    "_grTexDownloadMipMap@16", "_grTexCalcMemRequired@16", "_grTexCombine@28", "_grTexMipMapMode@12",
    "_grDepthBiasLevel@4", "_grDrawPoint@4", "_grDrawLine@8", "_grDrawTriangle@12", "_grLfbReadRegion@28",
    "_grLfbWriteRegion@36", "_grLfbUnlock@8", "_grLfbLock@24", "_grFogTable@4", "_grFogMode@4",
    "_grFogColorValue@4", "_grDepthMask@4", "_grDepthBufferFunction@4", "_grDepthBufferMode@4",
    "_grAlphaTestFunction@4", "_grChromakeyMode@4", "_grDitherMode@4", "_grTexFilterMode@12",
    "_grCullMode@4", "_grAlphaBlendFunction@16", "_grAlphaCombine@20", "_grColorCombine@20",
    "_grClipWindow@16", "_grFinish@0", "_grBufferSwap@4", "_grBufferClear@12", "_grRenderBuffer@4",
    "_grTexDownloadTable@8", "_grAlphaTestReferenceValue@4", "_grSstWinClose@4", "_grSstWinOpen@28",
    "_grSstSelect@4", "_grGlideShutdown@0", "_grGlideInit@0", "_grConstantColorValue@4",
    /* voodoo2z.dll calls this one through its GetProcAddress pointer even
     * when that is null (THRASH_setstate 0x2e, gamma): it must exist, or the
     * call pops none of its 12 bytes of arguments */
    "_guGammaCorrectionRGB@12",
};
#define NGLIDE ((int)(sizeof glide_names / sizeof glide_names[0]))
static ImpEnt g_extra[NGLIDE + 1];
const ImpEnt *porsche_extra_imports(uint32_t *n){
    for (int i = 0; i < NGLIDE; i++){
        const char *at = strchr(glide_names[i], '@');
        g_extra[i] = (ImpEnt){ 0, "glide3x.dll", glide_names[i], at ? atoi(at + 1) / 4 : 0 };
    }
    g_extra[NGLIDE] = (ImpEnt){ 0, "gimme.dll", "ConvertFile", 0 };   /* cdecl: the caller pops */
    *n = NGLIDE + 1;
    return g_extra;
}

/* ---- GetAsyncKeyState / GetKeyState: Porsche's front end reads keys and the
 * mouse buttons this way (the shared runtime answered 0 for everything).
 * Keys come from keyboard.c's state (DIK codes), the buttons from the page's
 * input (runtime/web/input_web.c; natively there is no input). */
int kbd_key_down(unsigned dik);   /* keyboard.c */
__attribute__((weak)) unsigned porsche_mouse_buttons(void){ return 0; }   /* bit 0 left, 1 right, 2 middle */
static unsigned vk_dik(unsigned vk){
    static const unsigned char letters[26] = { 0x1E,0x30,0x2E,0x20,0x12,0x21,0x22,0x23,0x17,0x24,0x25,0x26,0x32,
                                               0x31,0x18,0x19,0x10,0x13,0x1F,0x14,0x16,0x2F,0x11,0x2D,0x15,0x2C };
    static const unsigned char digits[10] = { 0x0B,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0A };
    static const unsigned char numpad[10] = { 0x52,0x4F,0x50,0x51,0x4B,0x4C,0x4D,0x47,0x48,0x49 };
    if (vk >= 'A' && vk <= 'Z') return letters[vk - 'A'];
    if (vk >= '0' && vk <= '9') return digits[vk - '0'];
    if (vk >= 0x60 && vk <= 0x69) return numpad[vk - 0x60];
    if (vk >= 0x70 && vk <= 0x79) return 0x3B + (vk - 0x70);   /* F1..F10 */
    switch (vk){
    case 0x08: return 0x0E; case 0x09: return 0x0F; case 0x0D: return 0x1C; case 0x13: return 0xC5; case 0x14: return 0x3A;
    case 0x1B: return 0x01; case 0x20: return 0x39; case 0x21: return 0xC9; case 0x22: return 0xD1; case 0x23: return 0xCF;
    case 0x24: return 0xC7; case 0x25: return 0xCB; case 0x26: return 0xC8; case 0x27: return 0xCD; case 0x28: return 0xD0;
    case 0x2D: return 0xD2; case 0x2E: return 0xD3; case 0x6A: return 0x37; case 0x6B: return 0x4E; case 0x6D: return 0x4A;
    case 0x6E: return 0x53; case 0x6F: return 0xB5; case 0x7A: return 0x57; case 0x7B: return 0x58;
    case 0xA0: return 0x2A; case 0xA1: return 0x36; case 0xA2: return 0x1D; case 0xA3: return 0x9D; case 0xA4: return 0x38; case 0xA5: return 0xB8;
    case 0xBA: return 0x27; case 0xBB: return 0x0D; case 0xBC: return 0x33; case 0xBD: return 0x0C; case 0xBE: return 0x34;
    case 0xBF: return 0x35; case 0xC0: return 0x29; case 0xDB: return 0x1A; case 0xDC: return 0x2B; case 0xDD: return 0x1B; case 0xDE: return 0x28;
    default: return 0;
    }
}
static int vk_down(unsigned vk){
    switch (vk){
    case 0x01: return (porsche_mouse_buttons() & 1u) != 0;                 /* VK_LBUTTON */
    case 0x02: return (porsche_mouse_buttons() & 2u) != 0;                 /* VK_RBUTTON */
    case 0x04: return (porsche_mouse_buttons() & 4u) != 0;                 /* VK_MBUTTON */
    case 0x10: return kbd_key_down(0x2A) || kbd_key_down(0x36);            /* VK_SHIFT */
    case 0x11: return kbd_key_down(0x1D) || kbd_key_down(0x9D);            /* VK_CONTROL */
    case 0x12: return kbd_key_down(0x38) || kbd_key_down(0xB8);            /* VK_MENU */
    case 0x0D: return kbd_key_down(0x1C) || kbd_key_down(0x9C);            /* VK_RETURN, the keypad's too */
    default: { unsigned d = vk_dik(vk); return d ? kbd_key_down(d) : 0; }
    }
}
int porsche_key_state(uint32_t vk, int async){
    static uint8_t was[256];
    vk &= 0xffu;
    int down = vk_down(vk);
    /* SHORT results, sign-extended as Windows leaves them in eax: callers test ah or the sign */
    if (!async) return down ? (int)0xffffff80u : 0;         /* GetKeyState: high bit = down */
    int r = down ? (int)0xffff8000u : 0;
    if (down && !was[vk]) r |= 1;                           /* pressed since the last call */
    was[vk] = (uint8_t)down;
    return r;
}

/* ---- gimme.dll: EA's image converter (GIMEX).  The game loads it for one
 * call, when it makes the player's picture (0x4DBBA0, a new profile or
 * another driver):
 *     bool ConvertFile(const char *src, const char *dst, int index)   (cdecl)
 * src is FEData\Art\ALLdrivr.fsh, the driver portraits (54x64, 8 bits a
 * pixel, 16-bit 565 palette); dst is SaveData\pic16.fsh, the one picture as
 * 16-bit 565 pixels, which the front end and the dashboard then load.  This
 * writes that file as gimme.dll did (the install's SaveData\pic16.fsh, byte
 * for byte).  A picture of the player's own (.tif .tga .jpg .bmp, the other
 * src the game tries) is not converted: false, and the game keeps its old one. */
int fileio_resolve_save(const char *win, char *out, size_t outsz);                    /* fileio.c */
int fileio_resolve_write(const char *op, const char *win, char *out, size_t outsz);
static uint16_t to565(uint32_t r, uint32_t g, uint32_t b){ return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)); }
static uint32_t gimme_convert_file(CPU *c){
    char src[260], dst[260], hs[1024], hd[1024];
    uint32_t ps = A(c, 0), pd = A(c, 1), idx = A(c, 2);
    if (!ps || !pd || !mem_is_committed(ps) || !mem_is_committed(pd)) return 0;
    snprintf(src, sizeof src, "%s", (const char *)(g_mem + ps));
    snprintf(dst, sizeof dst, "%s", (const char *)(g_mem + pd));
    uint8_t *b = 0; long n = 0; uint32_t ok = 0;
    FILE *f = fileio_resolve_save(src, hs, sizeof hs) ? fopen(hs, "rb") : 0;
    if (f){
        fseek(f, 0, SEEK_END); n = ftell(f); fseek(f, 0, SEEK_SET);
        if (n > 0 && n < (8l << 20) && (b = malloc((size_t)n)) && fread(b, 1, (size_t)n, f) != (size_t)n){ free(b); b = 0; }
        fclose(f);
    }
#define RD16(o) ((uint32_t)b[o] | (uint32_t)b[(o) + 1] << 8)
#define RD32(o) (RD16(o) | RD16((o) + 2) << 16)
    if (b && n >= 16 && !memcmp(b, "SHPI", 4) && idx < RD32(8) && 24 + 8 * (long)idx <= n){
        uint32_t img = RD32(20 + 8 * idx), code = img + 16 <= (uint32_t)n ? b[img] : 0;
        uint32_t w = code ? RD16(img + 4) : 0, h = code ? RD16(img + 6) : 0, np = w * h;
        uint16_t pal[256]; int have_pal = 0;
        if (code == 0x7b){                                /* 8 bits a pixel: the palette is an attachment */
            for (uint32_t at = img, nx; (nx = RD32(at) >> 8) && at + nx + 16 <= (uint32_t)n; ){
                at += nx;
                uint32_t pc = b[at], cnt = RD16(at + 4), e = at + 16;
                if (cnt > 256) cnt = 256;
                if (pc == 0x29 && e + 2 * cnt <= (uint32_t)n){ for (uint32_t k = 0; k < cnt; k++) pal[k] = (uint16_t)RD16(e + 2 * k); have_pal = 1; }
                else if (pc == 0x2a && e + 4 * cnt <= (uint32_t)n){ for (uint32_t k = 0; k < cnt; k++) pal[k] = to565(b[e + 4 * k + 2], b[e + 4 * k + 1], b[e + 4 * k]); have_pal = 1; }
                else if (pc == 0x24 && e + 3 * cnt <= (uint32_t)n){ for (uint32_t k = 0; k < cnt; k++) pal[k] = to565(b[e + 3 * k + 2], b[e + 3 * k + 1], b[e + 3 * k]); have_pal = 1; }
                if (have_pal){ for (uint32_t k = cnt; k < 256; k++) pal[k] = 0; break; }
            }
        }
        long need = code == 0x7b ? (long)np : code == 0x78 ? 2l * np : -1;
        if (np && need > 0 && img + 16 + need <= (uint32_t)n && (code == 0x78 || have_pal)){
            uint32_t size = 48u + 2u * np;
            uint8_t *o = calloc(1, size);
            if (o){
                memcpy(o, "SHPI", 4); o[4] = (uint8_t)size; o[5] = (uint8_t)(size >> 8); o[6] = (uint8_t)(size >> 16); o[7] = (uint8_t)(size >> 24);
                o[8] = 1; memcpy(o + 12, "GIMX", 4);
                memcpy(o + 16, b + 16 + 8 * idx, 4); o[20] = 32; memcpy(o + 24, "Buy ERTS", 8);   /* the entry (its name kept), the padding */
                o[32] = 0x78; o[36] = (uint8_t)w; o[37] = (uint8_t)(w >> 8); o[38] = (uint8_t)h; o[39] = (uint8_t)(h >> 8);
                for (uint32_t k = 0; k < np; k++){
                    uint16_t v = code == 0x78 ? (uint16_t)RD16(img + 16 + 2 * k) : pal[b[img + 16 + k]];
                    o[48 + 2 * k] = (uint8_t)v; o[49 + 2 * k] = (uint8_t)(v >> 8);
                }
                FILE *g = fileio_resolve_write("gimme ConvertFile", dst, hd, sizeof hd) ? fopen(hd, "wb") : 0;
                if (g){ ok = fwrite(o, 1, size, g) == size; ok &= fclose(g) == 0; }
                free(o);
            }
        }
        if (!ok) fprintf(stderr, "[gimme] ConvertFile(\"%s\", \"%s\", %u): image code 0x%02x %ux%u%s not converted\n",
                         src, dst, idx, code, w, h, have_pal ? "" : " (no palette)");
    }
    else fprintf(stderr, "[gimme] ConvertFile(\"%s\", \"%s\", %u): %s\n", src, dst, idx,
                 !b ? "cannot read the source" : "not an EA image file (SHPI) with that image");
#undef RD16
#undef RD32
    free(b);
    return ok;
}

int porsche_win32_call(CPU *c, const char *dll, const char *n, uint32_t *out){
    uint32_t r = 0;
    if (dll && !strcasecmp(dll, "glide3x.dll")) return glide_call(c, n, out);
    if (dll && !strcasecmp(dll, "gimme.dll") && !strcmp(n, "ConvertFile")){ *out = gimme_convert_file(c); return 1; }
    if (!strcmp(n, "GetKeyState")) r = (uint32_t)porsche_key_state(A(c, 0), 0);
    else if (!strcmp(n, "CharUpperA")){
        /* CharUpperA(lpsz): a single character when the high word is 0,
         * else the string, converted in place; returns its argument */
        uint32_t p = A(c, 0);
        if (p < 0x10000u) r = (uint32_t)toupper((int)(p & 0xffu));
        else { for (uint32_t k = p; MR8(k); k++) MR8(k) = (uint8_t)toupper(MR8(k)); r = p; }
    }
    else if (!strcmp(n, "GetKeyboardType")){
        /* 0: type (4 = enhanced 101/102 keys), 1: subtype, 2: function keys */
        uint32_t w = A(c, 0); r = w == 0 ? 4u : w == 1 ? 0u : w == 2 ? 12u : 0u;
    }
    else if (!strcmp(n, "ScreenToClient") || !strcmp(n, "ClientToScreen")){
        r = 1;   /* the client area starts at the screen's 0,0: the point stays */
    }
    else if (!strcmp(n, "GetWindowThreadProcessId")){
        /* (hWnd, lpdwProcessId): the window is virtual, so it belongs to the
         * caller.  voodoo2z.dll's THRASH_setvideomode then opens Glide on its
         * own thread instead of posting message 0x465 to the window's thread
         * and waiting for an event. */
        uint32_t pp = A(c, 1);
        if (pp) MR32(pp) = 100u;
        r = (c->fs_base) ? MR32(c->fs_base + 0x24u) : 1u;
    }
    else if (!strcmp(n, "DirectDrawCreate") || !strcmp(n, "DirectDrawCreateEx")){
        /* (guid, out, outer): no DirectDraw.  voodoo2z.dll only wants it for
         * exclusive full-screen mode (SetCooperativeLevel) and skips that when
         * the create fails; before, a stub returned DD_OK without an object. */
        uint32_t pp = A(c, 1);
        if (pp) MR32(pp) = 0;
        r = 0x887600FFu;   /* DDERR_NODIRECTDRAWHW */
    }
    else if (!strcmp(n, "DirectDrawEnumerateA") || !strcmp(n, "DirectDrawEnumerateExA")) r = 0;   /* no devices to report */
    else if (!strcmp(n, "GetWindowDC") || !strcmp(n, "GetDC")) r = PORSCHE_HDC;
    else if (!strcmp(n, "ReleaseDC")) r = 1;
    else if (!strcmp(n, "GetDeviceCaps")){
        switch (A(c, 1)){
        case 8:   r = PORSCHE_DESK_W; break;      /* HORZRES */
        case 10:  r = PORSCHE_DESK_H; break;      /* VERTRES */
        case 12:  r = PORSCHE_DESK_BPP; break;    /* BITSPIXEL */
        case 14:  r = 1; break;                   /* PLANES */
        case 24:  r = 0xffffffffu; break;         /* NUMCOLORS: more than 256 */
        case 88: case 90: r = 96; break;          /* LOGPIXELSX/Y */
        case 116: r = 60; break;                  /* VREFRESH */
        default:  r = 0; break;
        }
    }
    else return 0;
    *out = r;
    return 1;
}
