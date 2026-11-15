// The Glide renderer on WebGPU: draws the frames runtime/porsche_web/glide_gpu.c
// records (layout: runtime/porsche_web/glide_gpu.h, keep the numbers in step).
//
// Each frame packet holds commands (clear, draw with a 256-byte Glide state,
// texture upload/free, frame buffer writes) and window-coordinate vertices.
// The Voodoo's pipeline is one shader: the texture, colour and alpha combine
// units, chroma key, alpha test, table fog and the Z or W buffer depth are
// done per pixel from the state (a uniform block per draw); blending, the
// depth test and the colour mask are the pipeline's fixed functions.
// The game's frame buffer is an offscreen target at `scale` times the game's
// resolution, shown on the canvas at the end of each frame.
import { ScaleGovernor } from './autoscale';
import { fitScale } from './wide';
import type { GameProcess } from '../../web/src/host/process';

export const PG_HOST_KIND = 9;
const PG_MAGIC = 0x314c4750, PG_NSLOT = 3, PG_CMD_OFF = 64, PG_VERT_OFF = 2 << 20, PG_VERT_FLOATS = 12;
const OP_CLEAR = 1, OP_DRAW = 2, OP_TEXNEW = 3, OP_TEXFREE = 4, OP_LFB = 5;
// control block, u32 index
const C_MAGIC = 0, C_W = 2, C_H = 3, C_READY = 4, C_DONE = 5, C_SLOT = 8, C_ATTACHED = 11, C_AHEAD = 12, C_VIEW_W = 13, C_VIEW_H = 14, C_RACING = 15, C_GO = 16;
/** the control block's length in words (glide_gpu.h PgCtl) */
const CTL_WORDS = 17;
// draw state, u32 index (glide_gpu.h)
const S = {
  TEX: 17, FILTER_MIN: 18, FILTER_MAG: 19, CLAMP_S: 20, CLAMP_T: 21,
  BLEND_RGB_SRC: 22, BLEND_RGB_DST: 23, BLEND_A_SRC: 24, BLEND_A_DST: 25,
  DEPTH_MODE: 28, DEPTH_FUNC: 29, DEPTH_MASK: 30, MASK_RGB: 34, MASK_A: 35, CLIP: 54, SCREEN_W: 58, SCREEN_H: 59, COUNT: 64,
};
const UBLOCK = 256, MAX_BLOCKS = 16384;

const WGSL_COMMON = /* wgsl */`
struct U { s: array<vec4<u32>, 16> };
@group(0) @binding(0) var<uniform> u: U;
fn g(i: u32) -> u32 { return u.s[i >> 2u][i & 3u]; }
fn gi(i: u32) -> i32 { return bitcast<i32>(g(i)); }
fn argb(c: u32) -> vec4<f32> {
  return vec4<f32>(f32((c >> 16u) & 255u), f32((c >> 8u) & 255u), f32(c & 255u), f32(c >> 24u)) / 255.0;
}
`;

const WGSL_UBER = WGSL_COMMON + /* wgsl */`
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
struct VIn { @location(0) a: vec4<f32>, @location(1) b: vec4<f32>, @location(2) c: vec4<f32> };
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec4<f32>,
  @location(1) st: vec3<f32>,
  @location(2) zw: vec2<f32>,
};
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  let W = f32(g(58u)); let H = f32(g(59u));
  o.pos = vec4<f32>(v.a.x / W * 2.0 - 1.0, 1.0 - v.a.y / H * 2.0, 0.5, 1.0);
  o.col = v.b / 255.0;
  o.st = v.c.xyz;
  o.zw = v.a.zw;
  return o;
}
// Glide combine function: f factor, l local, o other, la local alpha
fn comb(func: u32, f: f32, l: f32, o: f32, la: f32) -> f32 {
  switch func {
    case 0u: { return 0.0; }
    case 1u: { return l; }
    case 2u: { return la; }
    case 3u: { return f * o; }
    case 4u: { return f * o + l; }
    case 5u: { return f * o + la; }
    case 6u: { return f * (o - l); }
    case 7u: { return f * (o - l) + l; }
    case 8u: { return f * (o - l) + la; }
    case 9u: { return -f * l + l; }
    case 16u: { return -f * l + la; }
    default: { return l; }
  }
}
// factor: lc local channel, la/oa local/other alpha, tc/ta texture channel/alpha
fn fac(k: u32, lc: f32, la: f32, oa: f32, tc: f32, ta: f32) -> f32 {
  switch k {
    case 0u: { return 0.0; } case 1u: { return lc; } case 2u: { return oa; } case 3u: { return la; }
    case 4u: { return ta; } case 5u: { return tc; } case 8u: { return 1.0; } case 9u: { return 1.0 - lc; }
    case 10u: { return 1.0 - oa; } case 11u: { return 1.0 - la; } case 12u: { return 1.0 - ta; } case 13u: { return 1.0 - tc; }
    default: { return 0.0; }
  }
}
fn cmp(func: u32, a: f32, b: f32) -> bool {
  switch func {
    case 0u: { return false; } case 1u: { return a < b; } case 2u: { return a == b; } case 3u: { return a <= b; }
    case 4u: { return a > b; } case 5u: { return a != b; } case 6u: { return a >= b; } default: { return true; }
  }
}
fn wdepth(oow: f32) -> f32 {
  if (oow <= 0.0) { return 65535.0; }
  let w = 1.0 / oow;
  if (w < 1.0) { return 0.0; }
  let e = floor(log2(w));
  return min(e * 4096.0 + (w / exp2(e) - 1.0) * 4096.0, 65535.0);
}
fn fogtab(k: u32) -> f32 { return f32((g(38u + (k >> 2u)) >> ((k & 3u) * 8u)) & 255u); }
fn fogw(k: u32) -> f32 { return exp2(3.0 + f32(k >> 2u)) / f32(8u - (k & 3u)); }
fn fog_w(w: f32) -> f32 {
  if (w <= 1.0) { return fogtab(0u) / 255.0; }
  for (var k = 0u; k < 63u; k++) {
    let b = fogw(k + 1u);
    if (w < b) { let a = fogw(k); return mix(fogtab(k), fogtab(k + 1u), (w - a) / (b - a)) / 255.0; }
  }
  return fogtab(63u) / 255.0;
}
struct FOut { @location(0) c: vec4<f32>, @builtin(frag_depth) d: f32 };
@fragment fn fs(i: VOut) -> FOut {
  var o: FOut;
  let q = select(1.0, i.st.z, i.st.z != 0.0);
  let tl = textureSample(tex, smp, i.st.xy / q);
  // TMU 0: local = its texel, other = nothing upstream
  var tx = vec4<f32>(0.0);
  if (g(17u) != 0u) {
    let rf = g(10u); let rk = g(11u); let af = g(12u); let ak = g(13u);
    tx = vec4<f32>(
      comb(rf, fac(rk, tl.r, tl.a, 0.0, tl.r, tl.a), tl.r, 0.0, tl.a),
      comb(rf, fac(rk, tl.g, tl.a, 0.0, tl.g, tl.a), tl.g, 0.0, tl.a),
      comb(rf, fac(rk, tl.b, tl.a, 0.0, tl.b, tl.a), tl.b, 0.0, tl.a),
      comb(af, fac(ak, tl.a, tl.a, 0.0, tl.a, tl.a), tl.a, 0.0, tl.a));
    tx = clamp(tx, vec4<f32>(0.0), vec4<f32>(1.0));
    if (g(14u) != 0u) { tx = vec4<f32>(1.0 - tx.rgb, tx.a); }
    if (g(15u) != 0u) { tx.a = 1.0 - tx.a; }
  }
  let it = i.col;
  let cst = argb(g(16u));
  let dep = i.zw.x / 65535.0;
  // colour and alpha combine units
  let cl = select(select(it, vec4<f32>(dep), g(2u) == 2u), cst, g(2u) == 1u);
  let co = select(select(it, cst, g(3u) == 2u), tx, g(3u) == 1u);
  let al = select(select(it.a, dep, g(7u) == 2u), cst.a, g(7u) == 1u);
  let ao = select(select(it.a, cst.a, g(8u) == 2u), tx.a, g(8u) == 1u);
  var a = clamp(comb(g(5u), fac(g(6u), al, al, ao, tx.a, tx.a), al, ao, al), 0.0, 1.0);
  if (g(9u) != 0u) { a = 1.0 - a; }
  let cf = g(0u); let ck = g(1u);
  var c = clamp(vec3<f32>(
    comb(cf, fac(ck, cl.r, al, ao, tx.r, tx.a), cl.r, co.r, al),
    comb(cf, fac(ck, cl.g, al, ao, tx.g, tx.a), cl.g, co.g, al),
    comb(cf, fac(ck, cl.b, al, ao, tx.b, tx.a), cl.b, co.b, al)), vec3<f32>(0.0), vec3<f32>(1.0));
  if (g(4u) != 0u) { c = 1.0 - c; }
  // chroma key on the combined colour, alpha test
  if (g(32u) != 0u) {
    let k = argb(g(33u) | 0xff000000u).rgb;
    if (all(round(c * 255.0) == round(k * 255.0))) { discard; }
  }
  if (!cmp(g(26u), round(a * 255.0), f32(g(27u)))) { discard; }
  // fog
  let fm = g(36u);
  if (fm != 0u) {
    var f = 0.0;
    if (fm == 3u) { f = i.zw.x / 65535.0; } else { f = fog_w(select(65535.0, 1.0 / i.zw.y, i.zw.y > 0.0)); }
    c = mix(c, argb(g(37u)).rgb, f);
  }
  o.c = vec4<f32>(c, a);
  let dm = g(28u);
  var d = i.zw.x;
  if (dm == 2u || dm == 4u) { d = wdepth(i.zw.y); }
  o.d = clamp((d + f32(gi(31u))) / 65535.0, 0.0, 1.0);
  return o;
}
`;

// The main shader, specialised: a draw's combine modes, tests and fog mode are constants of its pipeline
// (SHADER_MODES below: one pipeline for each set that comes up, a few dozen in a game), so the card's compiler
// throws away every branch not taken.  The same code with the modes read from the uniform block for each pixel
// (WGSL_UBER) cost an integrated GPU 6 to 7 times a plain textured fill: 20 ms a menu frame at 1280x960, 43 ms at
// 1920x1440.  With a z buffer the depth comes from the vertices (fs_z), so the card can reject hidden pixels
// before it shades them; only a w buffer needs it worked out for each pixel (fs).
const WGSL_MAIN = WGSL_COMMON + /* wgsl */`
override CF: u32 = 0u; override CK: u32 = 0u; override CLS: u32 = 0u; override COS: u32 = 0u; override CINV: u32 = 0u;
override AF: u32 = 0u; override AK: u32 = 0u; override ALS: u32 = 0u; override AOS: u32 = 0u; override AINV: u32 = 0u;
override TRF: u32 = 0u; override TRK: u32 = 0u; override TAF: u32 = 0u; override TAK: u32 = 0u;
override TINVC: u32 = 0u; override TINVA: u32 = 0u; override TEX: u32 = 0u;
override ATEST: u32 = 7u; override DMODE: u32 = 0u; override CHROMA: u32 = 0u; override FOG: u32 = 0u;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
struct VIn { @location(0) a: vec4<f32>, @location(1) b: vec4<f32>, @location(2) c: vec4<f32> };
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec4<f32>,
  @location(1) st: vec3<f32>,
  @location(2) zw: vec2<f32>,
};
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  let W = f32(g(58u)); let H = f32(g(59u));
  // a z buffer's depth is the vertices' own, biased (1, 3); without a depth buffer (0) the game's z may be anything
  // and must not reach the clipper; with a w buffer (2, 4) the fragment shader writes it
  var z = 0.5;
  if (DMODE == 1u || DMODE == 3u) { z = clamp((v.a.z + f32(gi(31u))) / 65535.0, 0.0, 1.0); }
  o.pos = vec4<f32>(v.a.x / W * 2.0 - 1.0, 1.0 - v.a.y / H * 2.0, z, 1.0);
  o.col = v.b / 255.0;
  o.st = v.c.xyz;
  o.zw = v.a.zw;
  return o;
}
// Glide combine function: f factor, l local, o other, la local alpha
fn comb(func: u32, f: f32, l: f32, o: f32, la: f32) -> f32 {
  switch func {
    case 0u: { return 0.0; }
    case 1u: { return l; }
    case 2u: { return la; }
    case 3u: { return f * o; }
    case 4u: { return f * o + l; }
    case 5u: { return f * o + la; }
    case 6u: { return f * (o - l); }
    case 7u: { return f * (o - l) + l; }
    case 8u: { return f * (o - l) + la; }
    case 9u: { return -f * l + l; }
    case 16u: { return -f * l + la; }
    default: { return l; }
  }
}
// factor: lc local channel, la/oa local/other alpha, tc/ta texture channel/alpha
fn fac(k: u32, lc: f32, la: f32, oa: f32, tc: f32, ta: f32) -> f32 {
  switch k {
    case 0u: { return 0.0; } case 1u: { return lc; } case 2u: { return oa; } case 3u: { return la; }
    case 4u: { return ta; } case 5u: { return tc; } case 8u: { return 1.0; } case 9u: { return 1.0 - lc; }
    case 10u: { return 1.0 - oa; } case 11u: { return 1.0 - la; } case 12u: { return 1.0 - ta; } case 13u: { return 1.0 - tc; }
    default: { return 0.0; }
  }
}
fn cmp(func: u32, a: f32, b: f32) -> bool {
  switch func {
    case 0u: { return false; } case 1u: { return a < b; } case 2u: { return a == b; } case 3u: { return a <= b; }
    case 4u: { return a > b; } case 5u: { return a != b; } case 6u: { return a >= b; } default: { return true; }
  }
}
fn wdepth(oow: f32) -> f32 {
  if (oow <= 0.0) { return 65535.0; }
  let w = 1.0 / oow;
  if (w < 1.0) { return 0.0; }
  let e = floor(log2(w));
  return min(e * 4096.0 + (w / exp2(e) - 1.0) * 4096.0, 65535.0);
}
fn fogtab(k: u32) -> f32 { return f32((g(38u + (k >> 2u)) >> ((k & 3u) * 8u)) & 255u); }
fn fogw(k: u32) -> f32 { return exp2(3.0 + f32(k >> 2u)) / f32(8u - (k & 3u)); }
// the fog table's entry k is for w = 2^(k / 4) * 8 / (8 - k % 4): the entry at or below w is worked out, not
// searched for (a loop over the 64 entries for each pixel of a foggy road was most of a race frame's cost)
fn fog_w(w: f32) -> f32 {
  if (w <= 1.0) { return fogtab(0u) / 255.0; }
  let j = min(u32(floor(log2(w))), 15u);
  let r = w / exp2(f32(j));
  let k = j * 4u + u32(r >= 8.0 / 7.0) + u32(r >= 8.0 / 6.0) + u32(r >= 8.0 / 5.0);
  if (k >= 63u) { return fogtab(63u) / 255.0; }
  let a = fogw(k); let b = fogw(k + 1u);
  return mix(fogtab(k), fogtab(k + 1u), clamp((w - a) / (b - a), 0.0, 1.0)) / 255.0;
}
// the pixel's colour (a pixel the chroma key or the alpha test rejects is discarded)
fn shade(i: VOut) -> vec4<f32> {
  // TMU 0: local = its texel, other = nothing upstream
  var tx = vec4<f32>(0.0);
  if (TEX != 0u) {
    let q = select(1.0, i.st.z, i.st.z != 0.0);
    let tl = textureSample(tex, smp, i.st.xy / q);
    tx = vec4<f32>(
      comb(TRF, fac(TRK, tl.r, tl.a, 0.0, tl.r, tl.a), tl.r, 0.0, tl.a),
      comb(TRF, fac(TRK, tl.g, tl.a, 0.0, tl.g, tl.a), tl.g, 0.0, tl.a),
      comb(TRF, fac(TRK, tl.b, tl.a, 0.0, tl.b, tl.a), tl.b, 0.0, tl.a),
      comb(TAF, fac(TAK, tl.a, tl.a, 0.0, tl.a, tl.a), tl.a, 0.0, tl.a));
    tx = clamp(tx, vec4<f32>(0.0), vec4<f32>(1.0));
    if (TINVC != 0u) { tx = vec4<f32>(1.0 - tx.rgb, tx.a); }
    if (TINVA != 0u) { tx.a = 1.0 - tx.a; }
  }
  let it = i.col;
  let cst = argb(g(16u));
  let dep = i.zw.x / 65535.0;
  // colour and alpha combine units
  let cl = select(select(it, vec4<f32>(dep), CLS == 2u), cst, CLS == 1u);
  let co = select(select(it, cst, COS == 2u), tx, COS == 1u);
  let al = select(select(it.a, dep, ALS == 2u), cst.a, ALS == 1u);
  let ao = select(select(it.a, cst.a, AOS == 2u), tx.a, AOS == 1u);
  var a = clamp(comb(AF, fac(AK, al, al, ao, tx.a, tx.a), al, ao, al), 0.0, 1.0);
  if (AINV != 0u) { a = 1.0 - a; }
  var c = clamp(vec3<f32>(
    comb(CF, fac(CK, cl.r, al, ao, tx.r, tx.a), cl.r, co.r, al),
    comb(CF, fac(CK, cl.g, al, ao, tx.g, tx.a), cl.g, co.g, al),
    comb(CF, fac(CK, cl.b, al, ao, tx.b, tx.a), cl.b, co.b, al)), vec3<f32>(0.0), vec3<f32>(1.0));
  if (CINV != 0u) { c = 1.0 - c; }
  // chroma key on the combined colour, alpha test
  if (CHROMA != 0u) {
    let k = argb(g(33u) | 0xff000000u).rgb;
    if (all(round(c * 255.0) == round(k * 255.0))) { discard; }
  }
  if (ATEST != 7u) {
    if (!cmp(ATEST, round(a * 255.0), f32(g(27u)))) { discard; }
  }
  // fog
  if (FOG != 0u) {
    var f = 0.0;
    if (FOG == 3u) { f = i.zw.x / 65535.0; } else { f = fog_w(select(65535.0, 1.0 / i.zw.y, i.zw.y > 0.0)); }
    c = mix(c, argb(g(37u)).rgb, f);
  }
  return vec4<f32>(c, a);
}
// a w buffer: the depth is worked out for each pixel
struct FOut { @location(0) c: vec4<f32>, @builtin(frag_depth) d: f32 };
@fragment fn fs(i: VOut) -> FOut {
  var o: FOut;
  o.c = shade(i);
  o.d = clamp((wdepth(i.zw.y) + f32(gi(31u))) / 65535.0, 0.0, 1.0);
  return o;
}
// a z buffer or none: the vertices' depth
@fragment fn fs_z(i: VOut) -> @location(0) vec4<f32> { return shade(i); }
// for measuring only (GlideRenderer.variant): the texel times the vertex colour, no combine, no tests
@fragment fn fs_flat(i: VOut) -> @location(0) vec4<f32> {
  let q = select(1.0, i.st.z, i.st.z != 0.0);
  return textureSample(tex, smp, i.st.xy / q) * i.col;
}
`;
/** the modes a pipeline of the main shader is made for: its override's name and the draw state's word (ne: only
 *  whether the word is zero counts) */
const SHADER_MODES: readonly [name: string, word: number, ne?: boolean][] = [
  ['CF', 0], ['CK', 1], ['CLS', 2], ['COS', 3], ['CINV', 4, true], ['AF', 5], ['AK', 6], ['ALS', 7], ['AOS', 8], ['AINV', 9, true],
  ['TRF', 10], ['TRK', 11], ['TAF', 12], ['TAK', 13], ['TINVC', 14, true], ['TINVA', 15, true], ['TEX', 17, true],
  ['ATEST', 26], ['DMODE', 28], ['CHROMA', 32, true], ['FOG', 36],
];
/** a draw's modes: the constants of its pipeline, and a key that is the same for the same constants */
export function shaderModes(st: ArrayLike<number>, o = 0): { key: string; constants: Record<string, number> } {
  const constants: Record<string, number> = {};
  let key = '';
  for (const [name, word, ne] of SHADER_MODES) {
    const v = ne ? (st[o + word] ? 1 : 0) : st[o + word] >>> 0;
    constants[name] = v; key += v.toString(36) + '.';
  }
  return { key, constants };
}


// clear: a rectangle (x0 y0 x1 y1 in game pixels), colour, depth; W, H at 8, 9
const WGSL_CLEAR = WGSL_COMMON + /* wgsl */`
struct VOut { @builtin(position) pos: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let W = f32(g(8u)); let H = f32(g(9u));
  let x = select(f32(g(0u)), f32(g(2u)), vi == 1u || vi == 2u || vi == 4u);
  let y = select(f32(g(1u)), f32(g(3u)), vi == 2u || vi == 4u || vi == 5u);
  var o: VOut; o.pos = vec4<f32>(x / W * 2.0 - 1.0, 1.0 - y / H * 2.0, 0.5, 1.0); return o;
}
struct FOut { @location(0) c: vec4<f32>, @builtin(frag_depth) d: f32 };
@fragment fn fs() -> FOut {
  var o: FOut;
  o.c = vec4<f32>(argb(g(4u)).rgb, f32(g(5u)) / 255.0);
  o.d = f32(g(6u)) / 65535.0;
  return o;
}
`;

// frame buffer writes (loading screens, movies): a textured rectangle, x0 y0 x1 y1 at 0..3, W, H at 8, 9
const WGSL_LFB = WGSL_COMMON + /* wgsl */`
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let W = f32(g(8u)); let H = f32(g(9u));
  let r = vi == 1u || vi == 2u || vi == 4u; let b = vi == 2u || vi == 4u || vi == 5u;
  let x = select(f32(g(0u)), f32(g(2u)), r); let y = select(f32(g(1u)), f32(g(3u)), b);
  var o: VOut;
  o.pos = vec4<f32>(x / W * 2.0 - 1.0, 1.0 - y / H * 2.0, 0.5, 1.0);
  o.uv = vec2<f32>(select(0.0, 1.0, r), select(0.0, 1.0, b));
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> { return vec4<f32>(textureSample(tex, smp, i.uv).rgb, 1.0); }
`;

// the finished frame onto the canvas
const WGSL_PRESENT = /* wgsl */`
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut; o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2<f32>(p.x, 1.0 - p.y); return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> { return vec4<f32>(textureSample(tex, smp, i.uv).rgb, 1.0); }
`;

const BLEND: GPUBlendFactor[] = ['zero', 'src-alpha', 'src', 'dst-alpha', 'one', 'one-minus-src-alpha', 'one-minus-src', 'one-minus-dst-alpha'];
function blendFactor(f: number, isSrc: boolean): GPUBlendFactor {
  if (f === 2) return isSrc ? 'dst' : 'src';
  if (f === 6) return isSrc ? 'one-minus-dst' : 'one-minus-src';
  if (f === 15) return isSrc ? 'src-alpha-saturated' : 'one';
  return BLEND[f] ?? 'one';
}
const CMP: GPUCompareFunction[] = ['never', 'less', 'equal', 'less-equal', 'greater', 'not-equal', 'greater-equal', 'always'];
const TOPO: GPUPrimitiveTopology[] = ['triangle-list', 'line-list', 'point-list'];

export interface GlideStats {
  /** the game's frames taken so far, drawn or skipped */
  frames: number;
  /** of those, the ones not drawn: a newer frame that starts by clearing the whole picture was already waiting */
  skipped: number;
  /** the picture is drawn at this many times the game's resolution */
  scale: number;
  drawsLast: number; vertsLast: number; textures: number; pipelines: number; errors: number;
}
export interface GlideRenderer {
  stats(): GlideStats;
  /** the game's picture as a PNG, at the size it is drawn (not the stretched canvas); null when there is none yet */
  shot(): Promise<Blob | null>;
  /** for checking the shaders against each other: the next frame is drawn twice on a cleared picture, with the
   *  'uber' shader and with the real one, and the two pictures are compared (colour channels,
   *  0..255: the mean difference, the largest, and the part of the channels that differ by more than 2) */
  compare(): Promise<{ mean: number; max: number; differ: number; w: number; h: number } | null>;
  /** draw every frame of the game (false), or only the newest when several wait (the default) */
  skipStale(on: boolean): void;
  /** how many frames the game may publish ahead of the page's drawing (1 by default; 0 to 2) */
  ahead(n: number): void;
  /** the picture's size in times the game's resolution; undefined: what fits the canvas, up to 4 */
  scale(n: number | undefined): void;
  /** the area the picture is shown in, in the display's pixels (wide.ts viewPixels): the game makes its wide
   *  display modes fit it, from the next time they are listed or a race starts */
  view(w: number, h: number): void;
  /** for looking at a picture: the draws of the frame after the next go to the log (GlideOptions.trace does the
   *  same for frames known beforehand) */
  trace(): void;
  /** for measuring: 'full' is the real shader; 'uber' the one before it, with every mode read for each pixel (the
   *  same picture); 'flat' a trivial fragment shader (the picture is wrong) */
  variant(v: 'full' | 'flat' | 'uber'): void;
  /** for measuring (GlideOptions.profile): the card's time a frame for the game's pass and for the pass onto the canvas,
   *  and how many times over the picture's area was drawn, averaged since the last call; null when it cannot be timed */
  gpuTimes(): { frames: number; mainMs: number; presentMs: number; overdraw: number; draws: number; modes: string[] } | null;
  detach(): void;
}
export interface GlideOptions {
  /** the picture's size in times the game's resolution; undefined: automatic (what fits the canvas, at most autoCap,
   *  and a step smaller whenever the graphics card cannot keep up: autoscale.ts) */
  scale?: number;
  log?: (s: string) => void; trace?: number[]; skipStale?: boolean; ahead?: number;
  /** the display's refresh rate (default 60): what counts as a slow frame depends on it */
  displayHz?: number;
  /** measure the card's time for each pass (GlideRenderer.gpuTimes): asks for the timestamp-query feature */
  profile?: boolean;
  /** the largest automatic scale (default 4): what an earlier game came down to */
  autoCap?: number;
  /** the automatic scale came down to `cap` */
  onAutoCap?: (cap: number) => void;
  /** GlideRenderer.view's first value (default: not known) */
  view?: [number, number];
  /** the game's picture has this size now (at the first frame, and whenever the game changes its display mode) */
  onSize?: (w: number, h: number) => void;
}

export async function attachGlide(proc: GameProcess, canvas: HTMLCanvasElement, opts: GlideOptions = {}): Promise<GlideRenderer> {
  const log = opts.log ?? console.log;
  const traceFrames = new Set(opts.trace ?? []);
  if (!navigator.gpu) throw new Error('this browser has no WebGPU');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const timed = !!opts.profile && adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice(timed ? { requiredFeatures: ['timestamp-query'] } : {});
  let closing = false;   // detach destroys the device: that loss is not news
  void device.lost.then(info => { if (!closing) log(`[glide-gpu] the graphics device is lost (${info.reason || 'no reason given'}): ${info.message}`); });
  // the card's own clock around each pass (profile): four timestamps a frame, read back when the frame is done
  const qs = timed ? device.createQuerySet({ type: 'timestamp', count: 4 }) : null;
  const qResolve = timed ? device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const qRead = timed ? device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  let qBusy = false, tMain = 0, tPresent = 0, tN = 0, tArea = 0, tDraws = 0;
  const tModes = new Map<string, number>();   // the area drawn with each set of shader modes
  let variant: 'full' | 'flat' | 'uber' = 'full';
  let errors = 0;
  device.addEventListener('uncapturederror', (e: any) => { if (errors++ < 20) log(`[glide-gpu] WebGPU error: ${e.error?.message ?? e}`); });
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const reg = await proc.registered(PG_HOST_KIND);
  const ctl = () => new Uint32Array(proc.memory.buffer as unknown as ArrayBuffer, reg.ptr, CTL_WORDS);
  const ctlI = () => new Int32Array(proc.memory.buffer as unknown as ArrayBuffer, reg.ptr, CTL_WORDS);
  if (ctl()[C_MAGIC] !== PG_MAGIC) throw new Error('the game module has no Glide WebGPU backend (control block magic)');

  // ---- resources
  const ubuf = device.createBuffer({ size: UBLOCK * MAX_BLOCKS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const vbuf = device.createBuffer({ size: (6 << 20) - PG_VERT_OFF, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const ustage = new Uint32Array(UBLOCK / 4 * MAX_BLOCKS);
  const uLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UBLOCK } }] });
  const tLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
  const uGroup = device.createBindGroup({ layout: uLayout, entries: [{ binding: 0, resource: { buffer: ubuf, size: UBLOCK } }] });
  const mainLayout = device.createPipelineLayout({ bindGroupLayouts: [uLayout, tLayout] });
  const clearLayout = device.createPipelineLayout({ bindGroupLayouts: [uLayout] });
  const mod = (code: string, name: string) => {
    const m = device.createShaderModule({ code, label: name });
    m.getCompilationInfo().then(ci => { for (const msg of ci.messages) log(`[glide-gpu] ${name} shader ${msg.type}: ${msg.message} (line ${msg.lineNum})`); });
    return m;
  };
  const mMain = mod(WGSL_MAIN, 'main'), mUber = mod(WGSL_UBER, 'uber'), mClear = mod(WGSL_CLEAR, 'clear'), mLfb = mod(WGSL_LFB, 'lfb'), mPresent = mod(WGSL_PRESENT, 'present');

  const samplers = new Map<number, GPUSampler>();
  const ADDR: GPUAddressMode[] = ['repeat', 'clamp-to-edge', 'mirror-repeat'];
  const sampler = (minf: number, magf: number, cs: number, ct: number) => {
    const k = minf | magf << 1 | cs << 2 | ct << 4;
    let s = samplers.get(k);
    if (!s) samplers.set(k, s = device.createSampler({ minFilter: minf ? 'linear' : 'nearest', magFilter: magf ? 'linear' : 'nearest',
      addressModeU: ADDR[cs] ?? 'repeat', addressModeV: ADDR[ct] ?? 'repeat' }));
    return s;
  };
  const white = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const textures = new Map<number, GPUTexture>();
  const texGroups = new Map<string, GPUBindGroup>();   // `${id}:${sampler key}`; dropped with the texture
  const texGroup = (id: number, minf: number, magf: number, cs: number, ct: number) => {
    const key = `${id}:${minf}${magf}${cs}${ct}`;
    let bg = texGroups.get(key);
    if (!bg) {
      const t = textures.get(id) ?? white;
      bg = device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: t.createView() }, { binding: 1, resource: sampler(minf, magf, cs, ct) }] });
      texGroups.set(key, bg);
    }
    return bg;
  };
  const dropTexGroups = (id: number) => { for (const k of [...texGroups.keys()]) if (k.startsWith(`${id}:`)) texGroups.delete(k); };

  // ---- render target: the game's frame buffer at `scale` times its resolution
  let cap = Math.max(1, Math.min(4, opts.autoCap ?? 4));
  let capBefore = cap;
  let gw = 0, gh = 0, scale = 1, color: GPUTexture | null = null, depth: GPUTexture | null = null, presentGroup: GPUBindGroup | null = null;
  const linear = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const presentPipe = device.createRenderPipeline({ layout: 'auto', label: 'present',
    vertex: { module: mPresent, entryPoint: 'vs' }, fragment: { module: mPresent, entryPoint: 'fs', targets: [{ format }] } });
  const ensureTarget = (w: number, h: number) => {
    const want = fitScale(opts.scale ?? Math.max(1, Math.min(cap, Math.round((canvas.clientHeight * devicePixelRatio) / h) || 1)),
      w, h, device.limits.maxTextureDimension2D);
    if (color && w === gw && h === gh && want === scale) return;
    if (w !== gw || h !== gh) opts.onSize?.(w, h);
    gw = w; gh = h; scale = want;
    color?.destroy(); depth?.destroy();
    color = device.createTexture({ size: [w * scale, h * scale], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    depth = device.createTexture({ size: [w * scale, h * scale], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    presentGroup = device.createBindGroup({ layout: presentPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: color.createView() }, { binding: 1, resource: linear }] });
    first = true;
    log(`[glide-gpu] frame buffer ${w}x${h}, drawn at ${w * scale}x${h * scale}`);
  };
  let first = true;

  // ---- pipelines
  const pipes = new Map<string, GPURenderPipeline>();
  const mainPipe = (st: Uint32Array, o: number, prim: number) => {
    const bs = st[o + S.BLEND_RGB_SRC], bd = st[o + S.BLEND_RGB_DST], as = st[o + S.BLEND_A_SRC], ad = st[o + S.BLEND_A_DST];
    const dm = st[o + S.DEPTH_MODE], df = st[o + S.DEPTH_FUNC] & 7, dw = st[o + S.DEPTH_MASK] ? 1 : 0;
    const mr = st[o + S.MASK_RGB] ? 1 : 0, ma = st[o + S.MASK_A] ? 1 : 0;
    const modes = variant === 'full' ? shaderModes(st, o) : null;
    const key = `m${variant},${bs},${bd},${as},${ad},${dm ? 1 : 0},${df},${dw},${mr},${ma},${prim},${modes?.key ?? ''}`;
    let p = pipes.get(key);
    if (p) return p;
    const wbuf = dm === 2 || dm === 4;
    const module = variant === 'uber' ? mUber : mMain;
    const constants = variant === 'uber' ? undefined : modes?.constants ?? shaderModes(st, o).constants;
    const blendOn = !(bs === 4 && bd === 0 && as === 4 && ad === 0);
    p = device.createRenderPipeline({ layout: mainLayout, label: key,
      vertex: { module, entryPoint: 'vs', constants, buffers: [{ arrayStride: PG_VERT_FLOATS * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' },
        { shaderLocation: 2, offset: 32, format: 'float32x4' }] }] },
      fragment: { module, constants, entryPoint: variant === 'flat' ? 'fs_flat' : variant === 'uber' || wbuf ? 'fs' : 'fs_z', targets: [{ format: 'rgba8unorm',
        writeMask: (mr ? GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE : 0) | (ma ? GPUColorWrite.ALPHA : 0),
        blend: blendOn ? { color: { srcFactor: blendFactor(bs, true), dstFactor: blendFactor(bd, false), operation: 'add' },
                           alpha: { srcFactor: blendFactor(as, true), dstFactor: blendFactor(ad, false), operation: 'add' } } : undefined }] },
      primitive: { topology: TOPO[prim] ?? 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: !!(dm && dw), depthCompare: dm ? CMP[df] : 'always' },
    });
    pipes.set(key, p);
    return p;
  };
  const clearPipe = (mr: number, md: number) => {
    const key = `c${mr},${md}`;
    let p = pipes.get(key);
    if (!p) pipes.set(key, p = device.createRenderPipeline({ layout: clearLayout, label: key,
      vertex: { module: mClear, entryPoint: 'vs' },
      fragment: { module: mClear, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', writeMask: mr ? GPUColorWrite.ALL : 0 }] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: !!md, depthCompare: 'always' } }));
    return p;
  };
  const lfbPipe = device.createRenderPipeline({ layout: mainLayout, label: 'lfb',
    vertex: { module: mLfb, entryPoint: 'vs' },
    fragment: { module: mLfb, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' } });

  // ---- one frame
  let frames = 0, skipped = 0, drawsLast = 0, vertsLast = 0;
  const later: GPUTexture[] = [];
  /** the frame begins by clearing the whole picture, colour and depth: nothing drawn before it shows or counts */
  function startsFresh(f: number): boolean {
    const buf = proc.memory.buffer as unknown as ArrayBuffer, c = ctl();
    const base = c[C_SLOT + (f % PG_NSLOT)], hd = new Uint32Array(buf, base, 4);
    if (hd[0] !== f) return false;
    const cmds = new Uint32Array(buf, base + PG_CMD_OFF, hd[2] >> 2), w = c[C_W] || 640, h = c[C_H] || 480;
    for (let p = 0, k = 0; k < hd[1] && p < cmds.length; k++) {
      const op = cmds[p], a = p + 2;
      if (op === OP_CLEAR) return cmds[a] <= 0 && cmds[a + 1] <= 0 && cmds[a + 2] >= w && cmds[a + 3] >= h && !!cmds[a + 7] && !!cmds[a + 8];
      if (op === OP_DRAW || op === OP_LFB) return false;
      p += cmds[p + 1] >> 2;
    }
    return false;
  }
  /** a frame nobody will see: its textures are taken (later frames draw with them), nothing is drawn */
  function takeFrame(f: number) {
    const buf = proc.memory.buffer as unknown as ArrayBuffer, c = ctl();
    const base = c[C_SLOT + (f % PG_NSLOT)], hd = new Uint32Array(buf, base, 4);
    if (hd[0] !== f) { log(`[glide-gpu] frame ${f}: the packet says ${hd[0]}`); return; }
    const cmds = new Uint32Array(buf, base + PG_CMD_OFF, hd[2] >> 2);
    for (let p = 0, k = 0; k < hd[1] && p < cmds.length; k++) {
      const op = cmds[p], a = p + 2;
      if (op === OP_TEXNEW) {
        const id = cmds[a], w = cmds[a + 1], h = cmds[a + 2], px = cmds[a + 3];
        const old = textures.get(id); if (old) later.push(old);
        const t = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture: t }, buf, { offset: px, bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
        textures.set(id, t); dropTexGroups(id);
      } else if (op === OP_TEXFREE) {
        const id = cmds[a], t = textures.get(id);
        if (t) { later.push(t); textures.delete(id); dropTexGroups(id); }
      }
      p += cmds[p + 1] >> 2;
    }
    for (const t of later.splice(0)) t.destroy();
    frames++; skipped++;
  }
  /** the step of the game's world frame f shows (glide_gpu.h PgHeader) */
  const frameStep = (f: number) => new Uint32Array(proc.memory.buffer as unknown as ArrayBuffer, ctl()[C_SLOT + (f % PG_NSLOT)], 5)[4];
  function drawFrame(f: number) {
    const buf = proc.memory.buffer as unknown as ArrayBuffer;
    const c = ctl();
    const base = c[C_SLOT + (f % PG_NSLOT)];
    const hd = new Uint32Array(buf, base, 4);
    if (hd[0] !== f) { log(`[glide-gpu] frame ${f}: the packet says ${hd[0]}`); return; }
    const ncmd = hd[1], cmdBytes = hd[2], nvert = hd[3];
    ensureTarget(c[C_W] || 640, c[C_H] || 480);
    if (nvert) device.queue.writeBuffer(vbuf, 0, buf, base + PG_VERT_OFF, nvert * PG_VERT_FLOATS * 4);
    const cmds = new Uint32Array(buf, base + PG_CMD_OFF, cmdBytes >> 2);
    const enc = device.createCommandEncoder();
    const timing = !!qs && !qBusy;
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: color!.createView(), loadOp: first ? 'clear' : 'load', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
      depthStencilAttachment: { view: depth!.createView(), depthLoadOp: first ? 'clear' : 'load', depthClearValue: 1, depthStoreOp: 'store' },
      ...(timing ? { timestampWrites: { querySet: qs!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}),
    });
    first = false;
    const tw = gw * scale, th = gh * scale;
    pass.setViewport(0, 0, tw, th, 0, 1);
    pass.setVertexBuffer(0, vbuf);
    let nb = 0, draws = 0;
    const scissor = (x0: number, y0: number, x1: number, y1: number) => {
      const sx = Math.max(0, Math.min(tw, x0 * scale)), sy = Math.max(0, Math.min(th, y0 * scale));
      const ex = Math.max(sx, Math.min(tw, x1 * scale)), ey = Math.max(sy, Math.min(th, y1 * scale));
      pass.setScissorRect(sx, sy, ex - sx, ey - sy);
      return ex > sx && ey > sy;
    };
    for (let p = 0, k = 0; k < ncmd && p < cmds.length; k++) {
      const op = cmds[p], words = cmds[p + 1] >> 2, a = p + 2;
      if (op === OP_DRAW && nb < MAX_BLOCKS) {
        const prim = cmds[a], firstV = cmds[a + 1], count = cmds[a + 2], so = a + 3;
        if (traceFrames.has(f)) {
          const st = cmds.subarray(so, so + S.COUNT), fv = new Float32Array(buf, base + PG_VERT_OFF + firstV * PG_VERT_FLOATS * 4, count * PG_VERT_FLOATS);
          let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < count; i++) {
            const x = fv[i * PG_VERT_FLOATS], y = fv[i * PG_VERT_FLOATS + 1], z = fv[i * PG_VERT_FLOATS + 2];
            if (z < z0) z0 = z; if (z > z1) z1 = z; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          log(`[trace ${f}] draw prim ${prim} v${firstV}+${count} tex ${st[17]} cc ${[...st.subarray(0, 5)]} ac ${[...st.subarray(5, 10)]} tc ${[...st.subarray(10, 16)]} ` +
              `blend ${[...st.subarray(22, 26)]} atest ${st[26]}/${st[27]} depth m${st[28]} f${st[29]} w${st[30]} b${st[31] | 0} chroma ${st[32]}:${st[33].toString(16)} ` +
              `mask ${st[34]}${st[35]} fog ${st[36]} clip ${[...st.subarray(54, 58)]} v0 ${[...fv.subarray(0, 11)].map(x => +x.toFixed(3))} ` +
              `box ${[x0, y0, x1, y1].map(x => +x.toFixed(1))} z ${+z0.toFixed(1)}..${+z1.toFixed(1)}`);
        }
        const ub = nb++ * (UBLOCK / 4);
        ustage.set(cmds.subarray(so, so + S.COUNT), ub);
        if (count && scissor(cmds[so + S.CLIP], cmds[so + S.CLIP + 1], cmds[so + S.CLIP + 2], cmds[so + S.CLIP + 3])) {
          pass.setPipeline(mainPipe(cmds, so, prim));
          pass.setBindGroup(0, uGroup, [ub * 4]);
          pass.setBindGroup(1, texGroup(cmds[so + S.TEX], cmds[so + S.FILTER_MIN] & 1, cmds[so + S.FILTER_MAG] & 1, cmds[so + S.CLAMP_S], cmds[so + S.CLAMP_T]));
          pass.draw(count, 1, firstV, 0);
          draws++;
          if (timing && prim === 0) {            // the triangles' area, in the game's pixels
            const v = new Float32Array(buf, base + PG_VERT_OFF + firstV * PG_VERT_FLOATS * 4, count * PG_VERT_FLOATS);
            let area = 0;
            for (let t = 0; t + 2 < count; t += 3) {
              const a = t * PG_VERT_FLOATS, b = a + PG_VERT_FLOATS, c2 = b + PG_VERT_FLOATS;
              area += Math.abs((v[b] - v[a]) * (v[c2 + 1] - v[a + 1]) - (v[c2] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
            }
            tArea += area;
            const m = Object.entries(shaderModes(cmds, so).constants).filter(([, x]) => x).map(([k, x]) => `${k}${x}`).join(' ');
            tModes.set(m, (tModes.get(m) ?? 0) + area);
          }
        }
      } else if (op === OP_CLEAR && nb < MAX_BLOCKS) {
        if (traceFrames.has(f)) log(`[trace ${f}] clear ${[...cmds.subarray(a, a + 4)]} argb ${cmds[a + 4].toString(16)} a ${cmds[a + 5]} depth ${cmds[a + 6]} mask ${cmds[a + 7]}${cmds[a + 8]}`);
        const ub = nb++ * (UBLOCK / 4);
        ustage.fill(0, ub, ub + S.COUNT);
        for (let i = 0; i < 7; i++) ustage[ub + i] = cmds[a + i];
        ustage[ub + 8] = gw; ustage[ub + 9] = gh;
        const mr = cmds[a + 7], md = cmds[a + 8];
        if ((mr || md) && scissor(cmds[a], cmds[a + 1], cmds[a + 2], cmds[a + 3])) {
          pass.setPipeline(clearPipe(mr, md));
          pass.setBindGroup(0, uGroup, [ub * 4]);
          pass.draw(6);
        }
      } else if (op === OP_TEXNEW) {
        const id = cmds[a], w = cmds[a + 1], h = cmds[a + 2], px = cmds[a + 3];
        const old = textures.get(id); if (old) later.push(old);
        const t = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture: t }, buf, { offset: px, bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
        textures.set(id, t); dropTexGroups(id);
      } else if (op === OP_TEXFREE) {
        const id = cmds[a], t = textures.get(id);
        if (t) { later.push(t); textures.delete(id); dropTexGroups(id); }
      } else if (op === OP_LFB && nb < MAX_BLOCKS) {
        const x = cmds[a], y = cmds[a + 1], w = cmds[a + 2], h = cmds[a + 3], px = cmds[a + 4];
        const t = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture: t }, buf, { offset: px, bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
        later.push(t);
        const ub = nb++ * (UBLOCK / 4);
        ustage.fill(0, ub, ub + S.COUNT);
        ustage[ub] = x; ustage[ub + 1] = y; ustage[ub + 2] = x + w; ustage[ub + 3] = y + h; ustage[ub + 8] = gw; ustage[ub + 9] = gh;
        scissor(0, 0, gw, gh);
        pass.setPipeline(lfbPipe);
        pass.setBindGroup(0, uGroup, [ub * 4]);
        pass.setBindGroup(1, device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: t.createView() }, { binding: 1, resource: sampler(0, 0, 1, 1) }] }));
        pass.draw(6);
      }
      p += words;
    }
    pass.end();
    if (nb) device.queue.writeBuffer(ubuf, 0, ustage, 0, nb * (UBLOCK / 4));
    // onto the canvas, the game's aspect kept
    const cw = canvas.width, ch = canvas.height;
    const sw = Math.min(cw, ch * gw / gh), sh = sw * gh / gw;
    const pp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
      ...(timing ? { timestampWrites: { querySet: qs!, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {}) });
    pp.setViewport((cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 1);
    pp.setPipeline(presentPipe); pp.setBindGroup(0, presentGroup!); pp.draw(3);
    pp.end();
    if (timing) { enc.resolveQuerySet(qs!, 0, 4, qResolve!, 0); enc.copyBufferToBuffer(qResolve!, 0, qRead!, 0, 32); }
    device.queue.submit([enc.finish()]);
    if (timing) {
      qBusy = true; tDraws += draws;
      qRead!.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(qRead!.getMappedRange().slice(0));
        qRead!.unmap();
        tMain += Number(t[1] - t[0]) / 1e6; tPresent += Number(t[3] - t[2]) / 1e6; tN++; qBusy = false;
      }, () => { qBusy = false; });
    }
    for (const t of later.splice(0)) t.destroy();
    frames++; drawsLast = draws; vertsLast = nvert;
  }

  // ---- the canvas in device pixels
  const ro = new ResizeObserver(() => {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
  });
  ro.observe(canvas);

  // ---- every frame the game publishes, in order (each may upload textures), at most a few per animation frame
  /** the game's picture as it is now: RGBA rows, alpha 255 */
  async function readTarget(): Promise<{ w: number; h: number; data: Uint8Array } | null> {
    if (!color || !gw || !gh) return null;
    const w = gw * scale, h = gh * scale, row = Math.ceil(w * 4 / 256) * 256;   // rows of a copy are 256-byte aligned
    const buf = device.createBuffer({ size: row * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: color }, { buffer: buf, bytesPerRow: row }, [w, h]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange()), data = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) data.set(src.subarray(y * row, y * row + w * 4), y * w * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;                    // the target's alpha is the game's own business
      buf.unmap();
      return { w, h, data };
    } finally { buf.destroy(); }
  }
  type Compared = { mean: number; max: number; differ: number; w: number; h: number } | null;
  let cmpWant: ((r: Compared) => void) | null = null, cmpBusy = false;
  /** frame f drawn with the old shader and with the real one, the two pictures compared (GlideRenderer.compare) */
  async function compareFrame(f: number, want: (r: Compared) => void) {
    const keep = variant;
    try {
      // each on a cleared picture and depth buffer, so that only this frame's own draws are compared
      variant = 'uber'; first = true; drawFrame(f); const a = await readTarget();
      variant = 'full'; first = true; drawFrame(f); const b = await readTarget();
      if (!a || !b || a.data.length !== b.data.length) { want(null); return; }
      let sum = 0, max = 0, differ = 0, n = 0;
      for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) {
        const d = Math.abs(a.data[i + k] - b.data[i + k]);
        sum += d; n++; if (d > max) max = d; if (d > 2) differ++;
      }
      want({ mean: sum / n, max, differ: differ / n, w: a.w, h: a.h });
    } catch (e) { log(`[glide-gpu] compare: ${e}`); want(null); }
    finally {
      variant = keep; done = f; cmpBusy = false;
      Atomics.store(ctlI(), C_DONE, f); letGo(f);
    }
  }
  /** the game need not wait for frame f any more (glide_gpu.h PgCtl go) */
  const letGo = (f: number) => { Atomics.store(ctlI(), C_GO, f); Atomics.notify(ctlI(), C_GO); };
  let done = 0, running = true, skip = opts.skipStale ?? true;
  const gov = new ScaleGovernor(opts.displayHz ?? 60);
  let lastDrawn = 0;
  // A race.  The game moves its world in steps, 64 a second (its ticks), and a frame shows the world as it is
  // after the newest step: there is nothing in between.  A frame that is not shown is a step that is not seen,
  // and the world then jumps two: so while the game says a race runs, every frame is drawn, the oldest first and
  // one at each animation frame, and none is dropped as stale.  (Each frame for the same number of refreshes was
  // tried: on a 144 Hz display that is 48 frames a second, one or two steps each in turn, which is no smoother.)
  let raced = false, shownAt = 0, tickAt = 0, shownStep = 0;
  // the display's refresh: as measured at the page's start, or shorter when the animation frames come faster
  // (the start's measure is too low in a window that was covered then)
  let refreshMs = 1000 / ((opts.displayHz ?? 60) >= 50 ? opts.displayHz! : 60), ticks: number[] = [];
  // for the log, 600 frames of a race at a time: how many refreshes the frames stay and how many steps of the
  // world each one is
  const stay = new Map<number, number>(), steps = new Map<number, number>(); let stayN = 0, stayMs = 0;
  const share = (m: Map<number, number>) => [...m].sort((x, y) => x[0] - y[0]).filter(([, n]) => n * 200 >= stayN)
    .map(([k, n]) => `${k}: ${Math.round(100 * n / stayN)}%`).join(', ');
  const raceShown = (ms: number, step: number) => {
    if (ms > 200) return;                                  // the game loaded, or was paused
    const k = Math.max(1, Math.round(ms / refreshMs));
    stay.set(k, (stay.get(k) ?? 0) + 1); steps.set(step, (steps.get(step) ?? 0) + 1); stayN++; stayMs += ms;
    if (stayN < 600) return;
    log(`[glide-gpu] a race's frames: ${(1000 * stayN / stayMs).toFixed(0)} a second; ticks of the game's clock (64 a second) a frame: ${share(steps)}; ` +
        `refreshes a frame stays (${refreshMs.toFixed(1)} ms each): ${share(stay)}`);
    stay.clear(); steps.clear(); stayN = 0; stayMs = 0;
  };
  // one frame ahead: the game builds its next frame while this one waits for the display's next refresh.  Not
  // at all (0) cost it a refresh of waiting a frame (54 against 64 frames a second in a race, 68 against 97 in
  // the menus, on a 144 Hz display) and the mouse came no sooner; two is one more frame that may be stale.
  Atomics.store(ctlI(), C_AHEAD, opts.ahead ?? 1);
  Atomics.store(ctlI(), C_VIEW_W, opts.view?.[0] ?? 0); Atomics.store(ctlI(), C_VIEW_H, opts.view?.[1] ?? 0);
  Atomics.store(ctlI(), C_ATTACHED, 1); Atomics.notify(ctlI(), C_ATTACHED);
  const tick = (now: number) => {
    if (!running) return;
    if (cmpBusy) { requestAnimationFrame(tick); return; }   // a frame is being drawn twice and read back
    const ready = Atomics.load(ctlI(), C_READY);
    const inRace = Atomics.load(ctlI(), C_RACING) === 1;
    if (inRace !== raced) { raced = inRace; log(raced ? '[glide-gpu] a race: every frame is shown' : '[glide-gpu] the race is over'); }
    if (tickAt && now - tickAt < 100) {
      ticks.push(now - tickAt);
      if (ticks.length === 120) {
        const r = ticks.sort((x, y) => x - y)[12];          // the missed ones are the long ones
        ticks = [];
        if (r > 2 && r < 0.92 * refreshMs) refreshMs = r;
      }
    }
    tickAt = now;
    // the automatic scale: frames of the game that come far apart say the card may be behind; a step down that
    // does not bring them closer is taken back (autoscale.ts)
    if (done < ready && opts.scale === undefined && !document.hidden) {
      const v = lastDrawn ? gov.sample(now - lastDrawn) : null;
      lastDrawn = now;
      if (v === 'lower') {
        if (scale > 1) { capBefore = cap; cap = scale - 1; log(`[glide-gpu] the frames come slowly at ${scale}x: trying the picture at ${cap}x`); }
        else gov.reset();                     // nothing smaller to try
      } else if (v === 'keep') { log(`[glide-gpu] ${cap}x brought them closer (the graphics card was behind): the picture stays there`); opts.onAutoCap?.(cap); }
      else if (v === 'undo') { log(`[glide-gpu] ${cap}x brought them no closer (it is not the graphics card): back to ${capBefore}x`); cap = capBefore; }
    }
    for (let n = 0; done < ready && n < (raced ? 1 : PG_NSLOT); n++) {
      const f = done + 1;
      if (cmpWant) { const want = cmpWant; cmpWant = null; cmpBusy = true; void compareFrame(f, want); break; }
      // several frames wait (the game ran ahead of the display): only the newest is seen.  An older one is still
      // drawn when the next builds on its picture; when the next starts by clearing everything, drawing it would
      // only hold the display up (each batch then takes longer, more frames wait, and the picture stays behind).
      // (in a race every frame is shown: see above)
      const stale = !raced && skip && f < ready && n + 1 < PG_NSLOT && !traceFrames.has(f) && startsFresh(f + 1);
      // in a race the game need not wait until this frame is drawn: it may make the next one meanwhile
      if (raced) letGo(f);
      try { if (stale) takeFrame(f); else drawFrame(f); } catch (e) { if (errors++ < 20) log(`[glide-gpu] frame ${f}: ${e}`); }
      if (raced) {
        const step = frameStep(f);
        if (shownAt && shownStep) raceShown(now - shownAt, (step - shownStep) | 0);
        shownStep = step;
      }
      done = f; shownAt = now;
      Atomics.store(ctlI(), C_DONE, f); if (!raced) letGo(f);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  log(`[glide-gpu] attached: ${format} canvas, adapter ${(adapter as any).info?.description || (adapter as any).info?.vendor || ''}`);
  return {
    stats: () => ({ frames, skipped, scale, drawsLast, vertsLast, textures: textures.size, pipelines: pipes.size, errors }),
    skipStale(on) { skip = on; },
    ahead(n) { Atomics.store(ctlI(), C_AHEAD, Math.max(0, Math.min(PG_NSLOT - 1, n | 0))); },
    scale(n) { opts.scale = n; gov.reset(); },
    view(w, h) { Atomics.store(ctlI(), C_VIEW_W, w | 0); Atomics.store(ctlI(), C_VIEW_H, h | 0); },
    variant(v) { variant = v; },
    trace() { traceFrames.add(Atomics.load(ctlI(), C_READY) + 2); },
    gpuTimes() {
      if (!qs) return null;
      const n = tN || 1, px = (gw || 640) * (gh || 480);
      const modes = [...tModes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, a]) => `${(a / n / px).toFixed(2)}x ${m}`);
      const r = { frames: tN, mainMs: tMain / n, presentMs: tPresent / n, overdraw: tArea / n / px, draws: tDraws / n, modes };
      tMain = tPresent = tN = tArea = tDraws = 0; tModes.clear();
      return r;
    },
    async shot() {
      const t = await readTarget();
      if (!t) return null;
      const c = new OffscreenCanvas(t.w, t.h);
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.data.buffer as ArrayBuffer), t.w, t.h), 0, 0);
      return await c.convertToBlob({ type: 'image/png' });
    },
    compare() { return new Promise(res => { cmpWant = res; }); },
    // the device goes with the game: its textures and buffers are the card's memory, and a game started later
    // makes its own
    detach: () => { running = false; Atomics.store(ctlI(), C_ATTACHED, 0); Atomics.notify(ctlI(), C_ATTACHED); ro.disconnect(); closing = true; device.destroy(); },
  };
}
