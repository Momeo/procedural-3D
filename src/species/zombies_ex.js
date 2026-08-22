/**
 * 扩展丧尸物种：剪影差异优先的四只新怪（Bloater / Runner / Brute / Screecher）。
 * （曾有的双足拟爬行 CRAWLER 实验种已被 species/crawler_true.js 的真四足
 *   爬行者取代——双足 rig 的腿没有水平化通道，只能到「长臂佝行」。）
 *
 * 组织方式与 zombie.js 一致：纯数据 spec + 可选专属贴图函数 + 工厂，
 * 几何/动画/骨架全部复用 core/ 的 buildHumanoid / animateHumanoid（一行未改）。
 * 贴图 helper（噪声/Sobel/打包/compensate）从 zombie.js 的 export 复用；
 * 腐肉 fleshMaps / 破衣 clothMaps 直接共享，只有 Bloater 的胀裂腹皮另写
 * bloatMaps()（范式同 zombie.js 的 drawFlesh：albedo 同场输出 height/rough）。
 *
 * 剪影分工（20m 外只靠轮廓辨认）：
 *   - BLOATER   肿胀者：桶状躯干 + 短腿 + 小头，慢速拖步——轮廓是「桶」
 *   - RUNNER    疾跑者：长腿细腰 + 大幅前倾 + 摆臂高步频——轮廓是「斜线」
 *   - BRUTE     巨汉：  2.6m 体量 + 门板宽肩 + 垂到膝的巨臂 + 沉没小头——轮廓是「墙」
 *   - SCREECHER 尖叫者：胸/头后仰 + 双臂炸开过顶——轮廓是「V 字」
 */

import * as THREE from 'three';
import { MUMMY, buildHumanoid } from '../core/mummy.js';
import { compensate } from '../core/wraps.js';
import { mulberry32, hashStr, withSeed, random } from '../rng.js';
import {
  hash2, fbm, smooth, makeCanvas,
  normalFromHeight, packRough, linearMean, toTexture,
  fleshMaps, clothMaps,
} from './zombie.js';

const SIZE = 512;

// ---------------------------------------------------------------------------
// Bloater 专属贴图：胀裂皮——蜡黄绷皮 + 暗红胀裂纹 + 黄亮脓疮
// ---------------------------------------------------------------------------

/**
 * 与 drawFlesh 同范式：albedo 与 height/rough 同场一次写出。
 * 特征必须大而少：肢体 UV 只覆盖贴图一角，小脓疮在 7m 外全部 mip 成噪点。
 *   - 胀裂纹：ridged fbm 的细脊线，暗红褐色、微凹陷、高粗糙（干裂）
 *   - 脓疮：  格点随机凸包，黄亮色、height 隆起、低粗糙（湿亮）
 */
function drawBloat() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);

  // 脓疮格点：8×8 格，每格按 hash 决定是否长疮、疮心与半径
  const CELL = 8;
  const pusAt = (u, v) => {
    // 返回 {bump, core}：bump 高度场用，core 着色用
    let bump = 0, core = 0;
    const gu = u * CELL, gv = v * CELL;
    const cx = Math.floor(gu), cy = Math.floor(gv);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const ix = ((cx + ox) % CELL + CELL) % CELL;
        const iy = ((cy + oy) % CELL + CELL) % CELL;
        const on = hash2(ix, iy, 61);
        if (on < 0.42) continue;                    // 过半格子不长疮
        const px = (ix + 0.25 + hash2(ix, iy, 67) * 0.5) / CELL;
        const py = (iy + 0.25 + hash2(ix, iy, 71) * 0.5) / CELL;
        const rad = 0.035 + hash2(ix, iy, 73) * 0.045;
        // 平铺距离
        let du = Math.abs(u - px); du = Math.min(du, 1 - du);
        let dv = Math.abs(v - py); dv = Math.min(dv, 1 - dv);
        const d = Math.hypot(du, dv) / rad;
        if (d >= 1) continue;
        const fall = smooth(Math.max(0, 1 - d));
        bump = Math.max(bump, fall);
        core = Math.max(core, smooth(Math.max(0, 1 - d * 1.6)));
      }
    }
    return { bump, core };
  };

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // 底子：蜡黄绷皮，明度波动比腐肉小（皮被撑紧了），保留块级色阶
      const mottle = fbm(u, v, 4, 5, 13) - 0.5;
      const patchTone = (hash2(Math.floor(u * 4), Math.floor(v * 4), 31) - 0.5) * 26;
      const grain = (hash2(x, y, 7) - 0.5);
      let r = 198 + mottle * 34 + patchTone + grain * 9;
      let g = 188 + mottle * 32 + patchTone + grain * 9;
      let b = 148 + mottle * 28 + patchTone * 0.9 + grain * 9;

      // 胀裂纹：ridged 脊线，两个方向叠出网状裂口
      const rg1 = 1 - Math.abs(fbm(u, v, 3, 6, 83) * 2 - 1);
      const rg2 = 1 - Math.abs(fbm(u * 1.7, v * 0.6, 3, 5, 89) * 2 - 1);
      const ck = smooth(Math.max(0, Math.min(1, (Math.max(rg1, rg2) - 0.90) / 0.06)));
      r += (96 - r) * ck * 0.85;
      g += (38 - g) * ck * 0.85;
      b += (34 - b) * ck * 0.85;

      // 脓疮：黄亮凸包，疮心更亮
      const { bump, core } = pusAt(u, v);
      r += (226 - r) * bump * 0.75;
      g += (206 - g) * bump * 0.75;
      b += (128 - b) * bump * 0.75;
      r += (246 - r) * core * 0.5;
      g += (228 - g) * core * 0.5;
      b += (150 - b) * core * 0.5;

      const p = i * 4;
      a[p]     = Math.max(0, Math.min(255, r));
      a[p + 1] = Math.max(0, Math.min(255, g));
      a[p + 2] = Math.max(0, Math.min(255, b));
      a[p + 3] = 255;

      height[i] = mottle * 0.2 - ck * 0.4 + bump * 1.1 + grain * 0.05;
      rough[i] = 0.82 + mottle * 0.05 + ck * 0.15 - bump * 0.42 - core * 0.15;
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough };
}

let BLOAT = null;
export function bloatMaps() {
  if (BLOAT) return BLOAT;
  const { albedo, height, rough } = drawBloat();
  BLOAT = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.6), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  return BLOAT;
}

/**
 * 六槽位材质集的参数化版：与 zombie.js 的 makeZombieMaterials 同契约同结构，
 * 只是 wrap 槽的贴图集可换（Bloater 换胀裂皮，其余槽位仍是破衣/深窝/死眼）。
 */
/**
 * 六槽位材质集的参数化版：与 zombie.js 的 makeZombieMaterials 同契约同结构，
 * 只是 wrap 槽的贴图集可换（Bloater 换胀裂皮，其余槽位仍是破衣/深窝/死眼）。
 * rng 省略时走模块级 RNG（rng.js，受 ?seed= 控制）；工厂传实例专用流。
 */
export function makeZombieMaterialsFrom(spec, wrapMaps, rng = random) {
  const flesh = wrapMaps || fleshMaps();
  const cloth = clothMaps();
  const jitter = (hex, gain, h, s, l) =>
    compensate(hex, gain).offsetHSL(h, s, l);

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

  const eye = new THREE.MeshStandardMaterial({
    color: 0x20241c,
    roughness: 0.45,
    metalness: 0.0,
    emissive: spec.palette.eye,
    emissiveIntensity: spec.palette.eyeGlow ?? 0.38,
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
    vertexColors: true,
  });

  return { wrap, wrapDark, deep, eye, accent, tatter };
}

// ---------------------------------------------------------------------------
// 工厂：createZombie 的同构，但材质钩子走 spec.makeMaterials（缺省 =
// makeZombieMaterialsFrom 腐肉/破衣标准套），这样 Bloater 换皮不需要
// 第二个工厂函数。
// ---------------------------------------------------------------------------

export function createZombieEx(spec, index) {
  // 确定性生成：与 createZombie 同契约（seed = hashStr(spec.id) + index 派生，
  // withSeed 包 core buildHumanoid，材质抖动走独立派生流——详见 zombie.js）。
  const seed = (hashStr(spec.id) + (index || 0) * 2654435761) >>> 0;
  return withSeed(seed, () => {
    const actor = { spec, variant: spec.id, index };
    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const makeMats = spec.makeMaterials || ((s, r) => makeZombieMaterialsFrom(s, null, r));
    const mats = makeMats(spec, rng);
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
// 物种一：肿胀者 Bloater —— 桶
// ---------------------------------------------------------------------------

export const BLOATER = {
  id: 'bloater',
  name: 'Bloater',

  speed: 0.9,
  scale: 1.12,
  height: 1.75,
  radius: 0.55,

  palette: {
    wrap: 0xa89f74,      // 蜡黄胀皮（贴图带暗红裂纹/黄亮脓疮）
    wrapDark: 0x7a6a52,  // 被撑烂的衣料残余：与皮同明度档，别把躯干切成铠甲
    deep: 0x141210,
    eye: 0xd8cf9a,       // 被脂肪挤成缝的浊眼
    accent: 0x3a332c,
    tatter: 0x7a6a52,
  },

  proportions: {
    // 短腿扛巨桶：腿短一截、骨盆/躯干又宽又厚、头小一圈
    hipY: 0.78, hipW: 0.46, bodyD: 0.42,
    legX: 0.18, legW: 0.20, thighL: 0.38, shinL: 0.40,   // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.62, chestH: 0.58,
    shoulderX: 0.36, shoulderY: 0.48, armW: 0.16, upperL: 0.35, foreL: 0.36,
    headY: 0.64, headW: 0.175, headH: 0.215, headD: 0.20,
    tatterRest: 0.42,
    tatters: [
      // 被撑破的裤腰布条横挂胯前
      { on: 'torso', x: 0.10, y: -0.10, z: 0.06, w: 0.42, h: 0.40, yaw: 0.2, cut: 0, swing: 0.5, out: 0.12 },
    ],
  },

  gait: {
    rate: 0.68,          // 慢：重
    stride: 0.46,
    armSwing: 0.12,      // 手臂被躯干顶住，几乎不摆
    armReach: -0.28,     // 手臂被肚子顶开，微微前张
    armSplay: 0.34,      // 粗腰把两臂撑开
    elbowBend: -0.20,
    lean: -0.08,         // 肚子把重心顶回来，接近直立才显得「胀」
    sway: 0.22,          // 大质量左右倒
    hipTwist: 0.06,
    bob: 0.045,
    headLoll: 0.12,
    headDroop: -0.10,
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, bloatMaps(), rng),
  build: buildHumanoid,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种二：疾跑者 Runner —— 斜线
// ---------------------------------------------------------------------------

export const RUNNER = {
  id: 'runner',
  name: 'Runner',

  speed: 3.0,            // 全物种最快，horde 里会明显甩开别人
  scale: 1.0,
  height: 2.0,
  radius: 0.36,

  palette: {
    wrap: 0x9a9284,      // 灰白干尸
    wrapDark: 0x5e3c34,  // 残破运动服：暗褪红（亮红会读成超级英雄，实测被否）
    deep: 0x17130f,
    eye: 0xc9d4b2,
    accent: 0x3a332c,
    tatter: 0x54352f,
  },

  proportions: {
    // 长腿细腰：腿占身高一半以上，躯干/四肢全部收窄
    hipY: 1.06, hipW: 0.30, bodyD: 0.21,
    legX: 0.11, legW: 0.115, thighL: 0.52, shinL: 0.54,  // hipY=thighL+shinL，铁律
    torsoY: 0.13, chestW: 0.37, chestH: 0.56,
    shoulderX: 0.25, shoulderY: 0.50, armW: 0.095, upperL: 0.47, foreL: 0.50,
    headY: 0.66, headW: 0.215, headH: 0.26, headD: 0.24,
    tatterRest: 0.5,
    tatters: [
      // 烂运动衫下摆 + 后背一条，跑动中向后飘（swing 大）
      { on: 'torso', x: 0.05, y: -0.06, z: 0.03, w: 0.30, h: 0.40, yaw: 0.4, cut: 2, swing: 1.2, out: 0.16 },
      { on: 'torso', x: 0.16, y: 0.26, z: -0.12, w: 0.20, h: 0.50, yaw: -0.4, cut: 1, swing: 1.3, out: 0.22 },
    ],
  },

  gait: {
    rate: 1.1,
    stride: 0.74,        // 大步幅
    armSwing: 0.55,      // 摆臂是「跑」与「走」的最大差别
    armReach: -0.5,
    armSplay: 0.10,      // 两臂夹紧身体，跑的流线感
    elbowBend: 0.95,     // 正值=前臂向前折起，短跑摆臂姿势
    lean: -0.40,         // 大幅前倾——剪影是一条斜线
    sway: 0.05,          // 跑起来不晃
    hipTwist: 0.13,
    bob: 0.09,
    headLoll: 0.05,      // 头稳定前视，猎手的专注
    headDroop: 0.08,
  },

  build: buildHumanoid,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种三：巨汉 Brute —— 墙
// ---------------------------------------------------------------------------

export const BRUTE = {
  id: 'brute',
  name: 'Brute',

  speed: 1.1,
  scale: 1.34,           // × 逐实例抖动后 2.3~2.8m
  height: 2.6,
  radius: 0.62,

  palette: {
    wrap: 0x6b6a5c,      // 石灰厚皮
    wrapDark: 0x3c382f,
    deep: 0x12100d,
    eye: 0xc4b98a,
    accent: 0x3a332c,
    tatter: 0x453e33,
  },

  proportions: {
    // 门板：肩宽接近普通丧尸两倍、臂粗过腿、手臂垂到膝、头缩进肩膀
    hipY: 1.12, hipW: 0.52, bodyD: 0.42,
    legX: 0.20, legW: 0.21, thighL: 0.55, shinL: 0.57,   // hipY=thighL+shinL，铁律
    torsoY: 0.13, chestW: 0.74, chestH: 0.64,
    shoulderX: 0.44, shoulderY: 0.52, armW: 0.22, upperL: 0.58, foreL: 0.62,
    headY: 0.68, headW: 0.20, headH: 0.24, headD: 0.22,
    tatterRest: 0.40,
    tatters: [
      // 腰间一圈烂布，读作被撑爆的工装裤
      { on: 'torso', x: -0.08, y: -0.10, z: 0.05, w: 0.46, h: 0.44, yaw: -0.2, cut: 0, swing: 0.6, out: 0.12 },
    ],
  },

  gait: {
    rate: 0.66,          // 低频重踏
    stride: 0.52,
    armSwing: 0.30,      // 巨臂像钟摆
    armReach: 0.08,      // 手臂自然垂落（近地），不前伸
    armSplay: 0.36,      // 被宽躯干撑开
    elbowBend: -0.10,
    lean: -0.14,
    sway: 0.13,
    hipTwist: 0.05,
    bob: 0.10,           // 起伏大 = 每一步都砸地
    headLoll: 0.08,
    headDroop: -0.36,    // 头埋进肩里
  },

  build: buildHumanoid,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种四：尖叫者 Screecher —— V 字
// ---------------------------------------------------------------------------

export const SCREECHER = {
  id: 'screecher',
  name: 'Screecher',

  speed: 1.6,
  scale: 0.97,
  height: 1.95,
  radius: 0.40,

  palette: {
    wrap: 0x8d8698,      // 灰紫尸斑皮
    wrapDark: 0x3a3542,
    deep: 0x141118,
    eye: 0xf2e3b8,
    eyeGlow: 0.55,       // 仰头嚎叫时眼窝漏光，比常尸亮一档
    accent: 0x3a332c,
    tatter: 0x403a4a,
  },

  proportions: {
    // 骨架接近常尸但全瘦一号；差异全靠姿态（gait）撑开
    hipY: 0.94, hipW: 0.32, bodyD: 0.24,
    legX: 0.12, legW: 0.13, thighL: 0.46, shinL: 0.48,   // hipY=thighL+shinL，铁律
    torsoY: 0.14, chestW: 0.40, chestH: 0.58,
    shoulderX: 0.27, shoulderY: 0.50, armW: 0.105, upperL: 0.47, foreL: 0.49,
    headY: 0.67, headW: 0.235, headH: 0.28, headD: 0.26,
    tatterRest: 0.46,
    tatters: [
      // 两条长布从肩上垂下，双臂炸开时布条挂进 V 字里
      { on: 'arm', side: -1, x: -0.02, y: -0.20, z: 0, w: 0.16, h: 0.62, yaw: -0.7, cut: 1, swing: 1.3, out: 0.2 },
      { on: 'arm', side: 1, x: 0.02, y: -0.24, z: 0, w: 0.16, h: 0.55, yaw: 0.8, cut: 2, swing: 1.2, out: 0.2 },
    ],
  },

  gait: {
    rate: 0.95,
    stride: 0.55,
    armSwing: 0.40,      // 炸开的双臂还在挥，像痉挛
    armReach: -2.35,     // 双臂甩过头顶（-0.95 是平举前伸，-2.35 是举过顶）
    armSplay: 0.55,      // 大幅外张——V 字的一撇一捺
    elbowBend: 0.25,     // 前臂略向前折，爪状
    lean: 0.12,          // 正值=胸椎后仰
    sway: 0.16,
    hipTwist: 0.10,
    bob: 0.06,
    headLoll: 0.28,      // 仰着的头乱晃
    headDroop: 0.55,     // 正值=头整个仰过去，嚎叫
  },

  build: buildHumanoid,
  animate: MUMMY.animate,
};
