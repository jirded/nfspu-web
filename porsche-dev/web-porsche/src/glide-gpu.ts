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
import type { GameProcess } from '../../web/src/host/process';

export const PG_HOST_KIND = 9;
const PG_MAGIC = 0x314c4750, PG_NSLOT = 3, PG_CMD_OFF = 64, PG_VERT_OFF = 2 << 20, PG_VERT_FLOATS = 12;
const OP_CLEAR = 1, OP_DRAW = 2, OP_TEXNEW = 3, OP_TEXFREE = 4, OP_LFB = 5;
// control block, u32 index
const C_MAGIC = 0, C_W = 2, C_H = 3, C_READY = 4, C_DONE = 5, C_SLOT = 8, C_ATTACHED = 11;
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

const WGSL_MAIN = WGSL_COMMON + /* wgsl */`
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

export interface GlideStats { frames: number; drawsLast: number; vertsLast: number; textures: number; pipelines: number; errors: number }
export interface GlideRenderer { stats(): GlideStats; detach(): void }
export interface GlideOptions { scale?: number; log?: (s: string) => void; trace?: number[] }

export async function attachGlide(proc: GameProcess, canvas: HTMLCanvasElement, opts: GlideOptions = {}): Promise<GlideRenderer> {
  const log = opts.log ?? console.log;
  const traceFrames = new Set(opts.trace ?? []);
  if (!navigator.gpu) throw new Error('this browser has no WebGPU');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  let errors = 0;
  device.addEventListener('uncapturederror', (e: any) => { if (errors++ < 20) log(`[glide-gpu] WebGPU error: ${e.error?.message ?? e}`); });
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const reg = await proc.registered(PG_HOST_KIND);
  const ctl = () => new Uint32Array(proc.memory.buffer as unknown as ArrayBuffer, reg.ptr, 16);
  const ctlI = () => new Int32Array(proc.memory.buffer as unknown as ArrayBuffer, reg.ptr, 16);
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
  const mMain = mod(WGSL_MAIN, 'main'), mClear = mod(WGSL_CLEAR, 'clear'), mLfb = mod(WGSL_LFB, 'lfb'), mPresent = mod(WGSL_PRESENT, 'present');

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
  let gw = 0, gh = 0, scale = 1, color: GPUTexture | null = null, depth: GPUTexture | null = null, presentGroup: GPUBindGroup | null = null;
  const linear = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const presentPipe = device.createRenderPipeline({ layout: 'auto', label: 'present',
    vertex: { module: mPresent, entryPoint: 'vs' }, fragment: { module: mPresent, entryPoint: 'fs', targets: [{ format }] } });
  const ensureTarget = (w: number, h: number) => {
    const want = opts.scale ?? Math.max(1, Math.min(4, Math.round((canvas.clientHeight * devicePixelRatio) / h) || 1));
    if (color && w === gw && h === gh && want === scale) return;
    gw = w; gh = h; scale = want;
    color?.destroy(); depth?.destroy();
    color = device.createTexture({ size: [w * scale, h * scale], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
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
    const key = `m${bs},${bd},${as},${ad},${dm ? 1 : 0},${df},${dw},${mr},${ma},${prim}`;
    let p = pipes.get(key);
    if (p) return p;
    const blendOn = !(bs === 4 && bd === 0 && as === 4 && ad === 0);
    p = device.createRenderPipeline({ layout: mainLayout, label: key,
      vertex: { module: mMain, entryPoint: 'vs', buffers: [{ arrayStride: PG_VERT_FLOATS * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' },
        { shaderLocation: 2, offset: 32, format: 'float32x4' }] }] },
      fragment: { module: mMain, entryPoint: 'fs', targets: [{ format: 'rgba8unorm',
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
  let frames = 0, drawsLast = 0, vertsLast = 0;
  const later: GPUTexture[] = [];
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
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: color!.createView(), loadOp: first ? 'clear' : 'load', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
      depthStencilAttachment: { view: depth!.createView(), depthLoadOp: first ? 'clear' : 'load', depthClearValue: 1, depthStoreOp: 'store' },
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
          const st = cmds.subarray(so, so + S.COUNT), fv = new Float32Array(buf, base + PG_VERT_OFF + firstV * PG_VERT_FLOATS * 4, Math.min(count, 3) * PG_VERT_FLOATS);
          log(`[trace ${f}] draw prim ${prim} v${firstV}+${count} tex ${st[17]} cc ${[...st.subarray(0, 5)]} ac ${[...st.subarray(5, 10)]} tc ${[...st.subarray(10, 16)]} ` +
              `blend ${[...st.subarray(22, 26)]} atest ${st[26]}/${st[27]} depth m${st[28]} f${st[29]} w${st[30]} b${st[31] | 0} chroma ${st[32]}:${st[33].toString(16)} ` +
              `mask ${st[34]}${st[35]} fog ${st[36]} clip ${[...st.subarray(54, 58)]} v0 ${[...fv.subarray(0, 11)].map(x => +x.toFixed(3))}`);
        }
        const ub = nb++ * (UBLOCK / 4);
        ustage.set(cmds.subarray(so, so + S.COUNT), ub);
        if (count && scissor(cmds[so + S.CLIP], cmds[so + S.CLIP + 1], cmds[so + S.CLIP + 2], cmds[so + S.CLIP + 3])) {
          pass.setPipeline(mainPipe(cmds, so, prim));
          pass.setBindGroup(0, uGroup, [ub * 4]);
          pass.setBindGroup(1, texGroup(cmds[so + S.TEX], cmds[so + S.FILTER_MIN] & 1, cmds[so + S.FILTER_MAG] & 1, cmds[so + S.CLAMP_S], cmds[so + S.CLAMP_T]));
          pass.draw(count, 1, firstV, 0);
          draws++;
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
    const pp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    pp.setViewport((cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 1);
    pp.setPipeline(presentPipe); pp.setBindGroup(0, presentGroup!); pp.draw(3);
    pp.end();
    device.queue.submit([enc.finish()]);
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
  let done = 0, running = true;
  Atomics.store(ctlI(), C_ATTACHED, 1); Atomics.notify(ctlI(), C_ATTACHED);
  const tick = () => {
    if (!running) return;
    const ready = Atomics.load(ctlI(), C_READY);
    for (let n = 0; done < ready && n < PG_NSLOT; n++) {
      const f = done + 1;
      try { drawFrame(f); } catch (e) { if (errors++ < 20) log(`[glide-gpu] frame ${f}: ${e}`); }
      done = f;
      Atomics.store(ctlI(), C_DONE, f); Atomics.notify(ctlI(), C_DONE);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  log(`[glide-gpu] attached: ${format} canvas, adapter ${(adapter as any).info?.description || (adapter as any).info?.vendor || ''}`);
  return {
    stats: () => ({ frames, drawsLast, vertsLast, textures: textures.size, pipelines: pipes.size, errors }),
    detach: () => { running = false; Atomics.store(ctlI(), C_ATTACHED, 0); Atomics.notify(ctlI(), C_ATTACHED); ro.disconnect(); },
  };
}
