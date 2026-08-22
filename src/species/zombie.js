/**
 * 程序化丧尸：core 人形机器（buildHumanoid / animateHumanoid）
 * 驱动的一个新物种。core 是冻结引擎层，在 ../core/ 下原样复用，一行未改。
 *
 * 复用与分工：
 *   - 几何与骨架：mummy.js 的 buildHumanoid 完全通用——它只消费
 *     spec.proportions 与调用方传入的 mats，不认识「绷带」。木乃伊质感来自
 *     makeMaterials() 里的 linenMaps，而 makeMaterials 没有 export，
 *     本就是给 spec 作者重写的挂钩点，这里重写为丧尸材质。
 *   - 动画：animateHumanoid 同样没有 export，但 MUMMY.animate 就是它的引用，
 *     直接借用。步态差异全部走 spec.gait 数据。
 *   - 破布：anatomy.js 的 tornStrip 由 buildHumanoid 内部经 stripGeo 调用，
 *     proportions.tatters 是纯数据，直接换成破衣条。
 *
 * 贴图范式照抄 wraps.js：离屏 canvas 画 albedo（同时输出 height/rough
 * 场）→ Sobel 法线 → roughness 打包 → linearMean 归一 + compensate 保
 * 住调色板的实测明度。wraps.js 的这些 helper 没有 export，按原范式重写
 * （不是改造源码，是同范式的新物种贴图）。
 *
 * 丧尸 vs 木乃伊的视觉区分：
 *   - 皮肤是腐肉不是布：灰绿斑驳底 + 暗紫瘀伤 + 红褐湿伤口（伤口低粗糙度），
 *     没有绷带的条纹 lap 结构；
 *   - wrapDark 槽位（骨盆/小腿/前臂/胸带）是深色破衣，不是阴影绷带；
 *   - 眼是浑浊死眼（微弱灰绿自发光），不是琥珀色亮瞳；
 *   - 步态：更低步频、强佝偻前倾、双臂前伸、头下垂。
 */

import * as THREE from 'three';
import { MUMMY, buildHumanoid } from '../core/mummy.js';
import { compensate, WRAP_TILES } from '../core/wraps.js';
import { mulberry32, hashStr, withSeed, random } from '../rng.js';

const SIZE = 512;

// ---------------------------------------------------------------------------
// 确定性平铺噪声（hash2/noise/fbm 与 wraps.js 同式，那里没有 export）
// 这些 helper 带 export：同族新物种（zombies_ex.js）写专属贴图时直接复用，
// 避免逐文件抄一遍噪声/Sobel/打包管线。
// ---------------------------------------------------------------------------

export function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export const smooth = (t) => t * t * (3 - 2 * t);

export function noise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(u, v, octaves, basePeriod, seed) {
  let sum = 0, amp = 1, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u * period, v * period, period, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

export function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Sobel 法线（wraps.js 原式：从 height 场而非 albedo 亮度推导，污渍是平的）
export function normalFromHeight(height, strength) {
  const out = makeCanvas(SIZE);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  const at = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * SIZE + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function packRough(rough) {
  const out = makeCanvas(SIZE);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < rough.length; i++) {
    const v = Math.max(0, Math.min(1, rough[i])) * 255;
    const p = i * 4;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function linearMean(canvas) {
  const src = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, SIZE, SIZE).data;
  let sum = 0;
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  for (let p = 0; p < src.length; p += 4) {
    sum += toLinear(src[p] / 255) * 0.2126
         + toLinear(src[p + 1] / 255) * 0.7152
         + toLinear(src[p + 2] / 255) * 0.0722;
  }
  return sum / (SIZE * SIZE);
}

export function toTexture(canvas, colorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// 腐肉：灰绿斑驳 + 暗紫瘀伤 + 红褐伤口
// ---------------------------------------------------------------------------

/**
 * albedo 与 height/rough 同场一次写出（同 wraps.js 的理由：变色的特征必然
 * 改变表面——瘀伤微陷、伤口低陷且湿亮）。
 *
 * 颜色在贴图里直接带色相（木乃伊的 linen 基本是灰度靠调色板上色），因为
 * 瘀伤的紫与底色的绿是两种 hue，单通道明度图表达不了；compensate 按整张
 * 图的线性均值归一，保住 spec.palette.wrap 的实测明度。
 */
function drawFlesh() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // 底子：尸皮的灰绿。明度中幅波动 + 细颗粒 + 每块皮域的整體色阶，
      // 避免塑料平色（肢体 UV 只覆盖贴图一角，没有块级色阶会读成纯平）
      const mottle = fbm(u, v, 4, 5, 11) - 0.5;          // ±0.5
      const patchTone = (hash2(Math.floor(u * 4), Math.floor(v * 4), 29) - 0.5) * 34;
      const grain = (hash2(x, y, 7) - 0.5);
      let r = 142 + mottle * 52 + patchTone + grain * 12;
      let g = 150 + mottle * 46 + patchTone + grain * 12;
      let b = 120 + mottle * 40 + patchTone * 0.9 + grain * 12;

      // 尸斑/瘀伤：暗紫，软边，略凹陷。岛要大、色要深——
      // 小到像素级的瘀伤在 7m 外全部 mip 成灰
      const bru = fbm(u, v, 3, 3, 53);
      const bk = smooth(Math.max(0, Math.min(1, (bru - 0.48) / 0.18)));
      r += (76 - r) * bk * 0.9;
      g += (50 - g) * bk * 0.9;
      b += (94 - b) * bk * 0.9;

      // 伤口：拉长的红褐条斑（腐裂），明度低、粗糙度低（湿亮）。
      const wnd = fbm(u * 0.8, v * 2.2, 3, 5, 97);
      const wk = smooth(Math.max(0, Math.min(1, (wnd - 0.56) / 0.10)));
      r += (70 - r) * wk * 0.92;
      g += (26 - g) * wk * 0.92;
      b += (24 - b) * wk * 0.92;

      const p = i * 4;
      a[p]     = Math.max(0, Math.min(255, r));
      a[p + 1] = Math.max(0, Math.min(255, g));
      a[p + 2] = Math.max(0, Math.min(255, b));
      a[p + 3] = 255;

      height[i] = mottle * 0.35 - bk * 0.25 - wk * 0.5 + grain * 0.06;
      rough[i] = 0.88 + mottle * 0.06 + bk * 0.06 - wk * 0.34;
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough };
}

/**
 * 破衣：深灰褐脏布。比 linen 更粗的织纹、更重的污渍，没有绷带的分条 lap
 * 结构——这是 wrapDark / tatter 槽位的材质，读作「烂衣服」而非「绷带阴影」。
 */
function drawCloth() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // 粗织纹（6px 周期，比 linen 的 4px 更糙）+ 每块补丁的整體色阶
      const warp = Math.sin(x * Math.PI / 3);
      const weft = Math.sin(y * Math.PI / 3 + 0.9);
      const weave = (warp * 0.55 + weft * 0.55 + warp * weft * 0.5) * 7.0;
      const patchTone = (hash2(Math.floor(u * 6), Math.floor(v * 6), 23) - 0.5) * 30;

      // 重污渍：大斑块 + 下流痕（比 linen 狠一档——活人衣服烂在身上）
      const blot = fbm(u, v, 4, 3, 5);
      const stain = fbm(u * 0.7, v * 2.6, 3, 5, 47);
      const dirt = -58 * Math.pow(Math.max(0, blot - 0.30), 1.3)
                 - 34 * Math.pow(Math.max(0, stain - 0.48), 1.1);

      const fuzz = (hash2(x, y, 7) - 0.5) * 8;
      const c = Math.max(0, Math.min(255, 172 + patchTone + weave + fuzz + dirt));

      // 偏冷的灰褐，与腐肉的绿分开
      const p = i * 4;
      a[p]     = c;
      a[p + 1] = Math.max(0, c - 6);
      a[p + 2] = Math.max(0, c - 14);
      a[p + 3] = 255;

      height[i] = weave * 0.03 + (blot - 0.5) * 0.2;
      rough[i] = 0.94 + Math.max(0, -dirt) * 0.001;
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough };
}

// ---------------------------------------------------------------------------
// 共享贴图集（范式同 wraps.js：建一次全局共享，材质按实例走）
// ---------------------------------------------------------------------------

let FLESH = null;
export function fleshMaps() {
  if (FLESH) return FLESH;
  const { albedo, height, rough } = drawFlesh();
  FLESH = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.4), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  return FLESH;
}

let CLOTH = null;
export function clothMaps() {
  if (CLOTH) return CLOTH;
  const { albedo, height, rough } = drawCloth();
  CLOTH = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.7), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  return CLOTH;
}

// ---------------------------------------------------------------------------
// 材质：buildHumanoid 消费的六个槽位，全部换成丧尸读法
// ---------------------------------------------------------------------------

/**
 * buildHumanoid 的材质槽位语义（mummy.js makeMaterials 同款契约）：
 *   wrap     主体：大腿/上臂/胸/头颅   → 腐肉
 *   wrapDark 骨盆/小腿/前臂/胸带/颚带  → 破衣（裤、袖、残留衣料）
 *   deep     眼窝暗带                  → 近黑的腐坏凹陷
 *   eye      双眼                      → 浑浊死眼，微弱自发光
 *   accent   饰件（本 spec 无几何）    → 留位
 *   tatter   破布条（tornStrip）       → 破衣布条，DoubleSide + vertexColors
 *
 * 无 EMISSIVE_FLOOR：那是引擎原版暗室的可读性补丁，与调色无关；查看器与怪海
 * 都是亮场景，不需要。
 */
/**
 * 可播种：rng 省略时走模块级 RNG（rng.js，受 ?seed= 控制）；
 * 工厂 createZombie 会传入按实例种子派生的专用流（与调用次序无关）。
 */
export function makeZombieMaterials(spec, rng = random) {
  const flesh = fleshMaps();
  const cloth = clothMaps();
  const jitter = (hex, gain, h, s, l) =>
    compensate(hex, gain).offsetHSL(h, s, l);

  // 与引擎原版同幅度的逐实例色调抖动（群体的平均值不动）
  const dh = (rng() - 0.5) * 0.05;
  const ds = (rng() - 0.5) * 0.10;
  const dl = (rng() - 0.5) * 0.13;

  const wrap = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrap, flesh.gain, dh, -0.03 + ds, dl),
    map: flesh.map,
    normalMap: flesh.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: flesh.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  const wrapDark = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrapDark, cloth.gain, dh, ds * 0.6, dl * 0.6),
    map: cloth.map,
    normalMap: cloth.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: cloth.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  const deep = new THREE.MeshStandardMaterial({
    color: spec.palette.deep,
    roughness: 0.9,
    metalness: 0.0,
  });

  // 浑浊死眼：引擎原版的眼是 0.9 强度的琥珀瞳（暗室里指方向用的）；丧尸的
  // 眼是灰白蒙翳，自发光压到刚好看得出「那不是活人的眼睛」。
  const eye = new THREE.MeshStandardMaterial({
    color: 0x20241c,
    roughness: 0.45,
    metalness: 0.0,
    emissive: spec.palette.eye,
    emissiveIntensity: 0.38,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: spec.palette.accent,
    roughness: spec.palette.accentRough ?? 0.7,
    metalness: spec.palette.accentMetal ?? 0.0,
  });

  const tatter = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.tatter ?? spec.palette.wrapDark, cloth.gain, dh, -0.06 + ds, dl),
    map: cloth.map,
    normalMap: cloth.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,   // tornStrip 烘了三段明度的 color 属性，契约同引擎原版
  });

  return { wrap, wrapDark, deep, eye, accent, tatter };
}

// ---------------------------------------------------------------------------
// 工厂：createEnemy 的最小同构（mummy.js 的 createEnemy 内部写死
// makeMaterials，只能另起工厂；bake.js / 查看器只消费下面这些字段）
// ---------------------------------------------------------------------------

export function createZombie(spec, index) {
  // 确定性生成：seed = hashStr(spec.id) + index 派生，同 (物种, 槽位) 跨端/
  // 跨次加载逐比特一致（联机按实例 id 哈希当 index 种子源，AGENTS.md 约定
  // 「外观按 id 哈希确定性生成，不走网络同步」）。
  // withSeed 包住整个 build：core/ buildHumanoid 一行不可改、内部直接调
  // Math.random（asym/破布缺失/材质抖动），只能临时替换（rng.js 有说明）。
  const seed = (hashStr(spec.id) + (index || 0) * 2654435761) >>> 0;
  return withSeed(seed, () => {
    const actor = { spec, variant: spec.id, index };
    // 材质抖动走独立的派生流，与 build 内部的 Math.random 消耗互不影响
    const mats = makeZombieMaterials(spec, mulberry32((seed ^ 0x9e3779b9) >>> 0));
    const rig = spec.build(spec, mats, actor);
    actor.rig = rig;
    actor.materials = mats;
    actor.scale = spec.scale * (rig.asym ? rig.asym.scale : 1);
    actor.triangles = Math.round(rig.triangles);
    actor.st = { phase: Math.random() * 6.283 };   // withSeed 流内，已确定性
    return actor;
  });
}

// ---------------------------------------------------------------------------
// 变体覆盖（引擎原版 extend 的同式）
// ---------------------------------------------------------------------------

function extend(base, over) {
  const out = { ...base, ...over };
  for (const key of ['palette', 'proportions', 'gait']) {
    if (over[key]) out[key] = { ...base[key], ...over[key] };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 丧尸本体
// ---------------------------------------------------------------------------

export const ZOMBIE = {
  id: 'zombie',
  name: 'Zombie',

  // animateHumanoid / strideRate / gait.js 消费的字段全集（战斗字段省略，
  // 查看器与怪海都不读；strideRate 只碰 speed 与 gait）
  speed: 1.4,
  scale: 1.0,
  height: 1.9,
  radius: 0.42,

  palette: {
    wrap: 0x6d725a,      // 灰绿腐肉（贴图带瘀紫/伤口的色相变化）
    wrapDark: 0x554b40,  // 破衣：裤、袖、胸带、颚带（后者读作垢发/下颌影）
    deep: 0x171512,      // 眼窝腐陷
    eye: 0xb9c4a2,       // 浑浊死眼的微光
    accent: 0x3a332c,
    tatter: 0x4e463c,
  },

  proportions: {
    hipY: 0.92, hipW: 0.34, bodyD: 0.26,
    legX: 0.13, legW: 0.15, thighL: 0.44, shinL: 0.48,   // hipY=thighL+shinL，铁律
    torsoY: 0.14, chestW: 0.44, chestH: 0.56,
    // 长臂：丧尸的手臂比木乃伊长一截，前伸时够得着画面
    shoulderX: 0.28, shoulderY: 0.50, armW: 0.13, upperL: 0.44, foreL: 0.46,
    headY: 0.66, headW: 0.23, headH: 0.275, headD: 0.255,
    tatterRest: 0.42,

    // 破衣条：衬衫下摆横挂胯部、后背一条长衣片、一只袖口挂袖条——
    // 与木乃伊的三条绷带位置不同，读作衣服不是绷带
    tatters: [
      { on: 'torso', x: 0.04, y: -0.08, z: 0.05, w: 0.38, h: 0.52, yaw: 0.3, cut: 0, swing: 0.7, out: 0.14 },
      { on: 'torso', x: 0.20, y: 0.28, z: -0.15, w: 0.24, h: 0.85, yaw: -0.55, cut: 1, swing: 1.1, out: 0.24 },
      { on: 'arm', side: -1, x: -0.02, y: -0.26, z: 0, w: 0.18, h: 0.55, yaw: -0.9, cut: 2, swing: 1.5, out: 0.22 },
    ],
  },

  gait: {
    rate: 0.8,          // 低步频：拖
    stride: 0.58,
    armSwing: 0.22,     // 前伸的手臂不怎么摆
    armReach: -1.1,     // 双臂前伸（经典丧尸），比木乃伊的 -0.95 更出去
    armSplay: 0.22,
    elbowBend: -0.38,   // 前臂从前伸的上臂垂下
    lean: -0.34,        // 强佝偻前倾（木乃伊 -0.24）
    sway: 0.15,
    hipTwist: 0.09,
    bob: 0.07,
    headLoll: 0.22,     // 头晃得更狠
    headDroop: -0.30,   // 头低垂
  },

  build: buildHumanoid,
  animate: MUMMY.animate,   // animateHumanoid 没有 export；MUMMY.animate 就是它
};

// 查看器并排的四只：同一体态，色相/体量差异
export const ZOMBIE_VARIANTS = [
  ZOMBIE,
  extend(ZOMBIE, {
    id: 'pale', name: 'Pale',
    palette: { wrap: 0x8f9280, wrapDark: 0x3c3833, tatter: 0x3a342e },
  }),
  extend(ZOMBIE, {
    id: 'bruised', name: 'Bruised',
    palette: { wrap: 0x6f6a7c, wrapDark: 0x413a40, tatter: 0x3c343a },
  }),
  extend(ZOMBIE, {
    id: 'bloater', name: 'Bloater',
    speed: 1.0, scale: 1.07,
    proportions: { chestW: 0.52, bodyD: 0.33, legW: 0.18, armW: 0.15 },
    gait: { rate: 0.72, stride: 0.5, bob: 0.05, lean: -0.28 },
  }),
];
