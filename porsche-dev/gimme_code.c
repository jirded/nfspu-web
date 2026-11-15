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

