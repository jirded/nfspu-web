/* Porsche build: no-op stand-ins for the NFSU2-only parts of the shared
 * runtime (widescreen, autotest, frame-rate HFR, D3DX HLE, enhancements,
 * the game hooks of runtime/debug.c, the career garage, free roam, the
 * DirectInput gamepad of dinput_pad.c, Winsock).  The generic core (CPU,
 * memory, dispatch, heap, Win32, files, COM) links against these.
 *
 * Each one says "not handled" / "nothing to do", so the core takes its plain
 * path.  Replace them one by one with Porsche implementations. */
#include "cpu.h"
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

/* ---- runtime/debug.c guest_hook: NFSU2 game hooks (0 = not handled) */
int ws_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int tonemenu_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int sndlead_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int roam_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int regional_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int powerunits_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int language_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int hornmenu_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int garage_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }
int drift_hook(CPU *c, uint32_t ip){ (void)c; (void)ip; return 0; }

/* ---- widescreen.c (NFSU2's widescreen fix): the game's own 4:3 */
float  ws_ui_x(void){ return 1.f; }
float  ws_ui_y(void){ return 1.f; }
float  ws_persp_x(void){ return 1.f; }
float  ws_persp_y(void){ return 1.f; }
void   ws_set_mapping(float m){ (void)m; }
double ws_render_factor(void){ return 1.0; }
double ws_max_pixels(void){ return 0.0; }
int    ws_take_border_quad(void){ return 0; }
int    ws_fill_target(void){ return 0; }
void   ws_report(void){ }

/* ---- autotest.c (NFSU2's scripted test runs) */
long autotest_frame(void){ return 0; }
const char *autotest_screen(void){ return ""; }
void autotest_on_present(CPU *c){ (void)c; }
void autotest_note_unimpl(const char *dll, const char *name, uint32_t ret){ (void)dll; (void)name; (void)ret; }
void autotest_note_trap(uint32_t addr, const char *mn){ (void)addr; (void)mn; }

/* ---- framerate.c (NFSU2's high-frame-rate fixes): off */
void hfr_note_input_read(int pad){ (void)pad; }
uint64_t hfr_vclock_floor_us(void){ return 0; }
int  hfr_mode_off(void){ return 1; }
void hfr_after_present(void){ }

/* ---- d3dx_hle.c / overrides.c (NFSU2's D3DX and game function replacements) */
int g_efx_stat = 0;
uint32_t g_fx_epoch = 1;
int g_dx_in_pass = 0;
uint32_t g_fe_mgr = 0;
void efx_stat_note(CPU *c, uint32_t addr){ (void)c; (void)addr; }
void d3dx_hle_report(void){ }
void guest_cpu_mark(void){ }
void overrides_report(void){ }

/* ---- enhance.c: no enhancements (ENH_NONE) */
int  enh_rt_size(uint32_t ret, uint32_t bb_w, uint32_t bb_h, unsigned *w, unsigned *h){
    (void)ret; (void)bb_w; (void)bb_h; (void)w; (void)h; return 0; }
void enh_report(void){ }

/* ---- garage.c, roam_game.c, language.c (NFSU2 features) */
void garage_profile_written(const char *path){ (void)path; }
void garage_profile_deleted(const char *path){ (void)path; }
void roam_game_parked(int on){ (void)on; }
const char *language_registry(void){ return 0; }

/* ---- NFSU2's sound effects, headlights, photo mode, SMS, LAN race input,
 * high frame rate display (the browser parts of runtime/web call these) */
void carsfx_mix(float *acc, unsigned frames, unsigned rate){ (void)acc; (void)frames; (void)rate; }
void horn_mix(float *acc, unsigned frames, unsigned rate){ (void)acc; (void)frames; (void)rate; }
void headlights_vs_ramp(float a, float b){ (void)a; (void)b; }
int  hfr_display_live(void){ return 0; }
int  mprace_owns_input(void){ return 0; }
void photo_input(int cmd, int a, int b){ (void)cmd; (void)a; (void)b; }
void sms_request(int id){ (void)id; }

/* ---- winsock.c: not in the headless build yet (0 = not handled) */
int  winsock_call(CPU *c, const char *dll, const char *n, uint32_t *out){ (void)c; (void)dll; (void)n; (void)out; return 0; }
int  winsock_session_active(void){ return 0; }
void winsock_report(void){ }

/* ---- dinput_pad.c: no gamepad yet (its NFSU2 function overrides would
 * replace unrelated Porsche functions at the same addresses) */
int      dipad_guid(uint32_t guid){ (void)guid; return 0; }
void     dipad_created(uint32_t dev, uint32_t guid){ (void)dev; (void)guid; }
int      dipad_enum(CPU *c, uint32_t devtype, uint32_t cb, uint32_t ref, uint32_t flags){
    (void)c; (void)devtype; (void)cb; (void)ref; (void)flags; return 0; }
uint32_t dipad_call(CPU *c, uint32_t self, const char *nm, int nargs, const uint32_t *args){
    (void)c; (void)self; (void)nargs; (void)args;
    fprintf(stderr, "[porsche] gamepad call %s: not implemented\n", nm);
    return 0x80004001u; /* E_NOTIMPL */ }
uint32_t dipad_effect_call(CPU *c, uint32_t self, const char *nm, int nargs, const uint32_t *args){
    (void)c; (void)self; (void)nm; (void)nargs; (void)args; return 0x80004001u; }
void     dipad_effect_free(uint32_t obj){ (void)obj; }
int      dipad_ff_on(void){ return 0; }
