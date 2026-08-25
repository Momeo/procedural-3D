/**
 * 元素魔像谱系（golem.js）：岩石 rockgolem / 熔岩 magmagolem / 冰霜
 * frostgolem / 水晶 crystalgolem。精英/Boss 层：低频砸地步、大体型
 * （scale 1.5~2.3，不超过 draco 2.8 铁律）。
 *
 * 差异化三维度（2026-08-25 r2 重做：去除装甲板机制在魔像身上的使用，
 * 四种不再共用桶身底子）：
 *   1. 身体胖瘦/比例：rock 矮壮墩实（宽肩短腿巨拳，会走的碑）/
 *      magma 高大魁梧倒三角（Boss 2.3）/ frost 瘦高冰柱（棱柱躯干+细长四肢）
 *      / crystal 中等悬浮（晶簇拼身、垂落晶柱代替腿型）；
 *   2. 身体纹路（surfaceStrips 贴面薄片，一种一个读法）：rock 苔藓斑+风化
 *      皴裂（deep 槽不发光）/ magma 熔岩缝发光铺满胸背（eye 槽 1.05）/
 *      frost 冰白霜纹（eye 槽克制 0.6）/ crystal 紫青晶脉（eye 槽 0.9）；
 *   3. 脑袋特殊化（robots.js 头部个性化先例）：rock 半埋石颅+单眼缝 /
 *      magma 裂口发光嘴+双岩刺角 / frost 光滑无面冰面+双冰蓝眼+冰锥冠 /
 *      crystal 悬浮大水晶当头（菱锥八面体，无下颚）。
 *   20m 外四项全不同，剪影秒分。
 *
 * 借与自写的分界（范式照 dragons.js / undead.js 顶部契约）：
 *   - 借：parts()（core/anatomy.js）、contactShadow（core/contact.js）、
 *     WRAP_TILES/linenMaps（core/wraps.js）、prims（pipeline/prims.js）、
 *     mkActorTools/flyBlob/animateFlyer（flyers.js）、MUMMY.animate
 *     （core/mummy.js 人形步态）、surfaceStrips/
 *     mkRadiusFn（dragons.js 贴面游走器）、makeZombieMaterialsFrom
 *     （zombies_ex.js）。
 *   - 自写：四种体型底子（共享柱肢/桶身 builder，参数全走 P）+
 *     golemAnimate 壳（core 不可改，蓄力后仰按 spec.windupLean 反向抵消；
 *     instanced 侧 gait.js 人形支直读同字段，双端同源）。
 *
 * 配色防染：四种全用 linenMaps 中性基底（fleshMaps 绿染坑）。装饰件一律
 * noHit；六材质槽不破。
 *
 * 备注（去甲后）：bake.js 的 userData.plate / region:'core' 部位覆盖与
 * hitvol.js 的 plate/core 倍率 + severMask 掩码链跳过是**保留的通用可选
 * 机制**（零运行时成本、旧物种零影响）——魔像不再使用；掩码链跳过同时是
 * 断肢幽灵盒的真 bug fix（断掉的肢体不再挡子弹），必须保留。
 */

import * as THREE from 'three';
import { parts } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES, linenMaps } from '../core/wraps.js';
import { MUMMY } from '../core/mummy.js';
import { prims } from '../prims.js';
import { mkActorTools, flyBlob, animateFlyer } from './flyers.js';
import { surfaceStrips, mkRadiusFn } from './dragons.js';
import { makeZombieMaterialsFrom } from './zombies_ex.js';

// ---------------------------------------------------------------------------
// 共享小件
// ---------------------------------------------------------------------------

/** 直立桶身（lathe，轴 +Y）表面参数化：P(a,y) = (r·cos a, y, r·sin a)，
 *  a=0 → 正前（+z）/ a=π 背 / a=±π/2 两侧。给 surfaceStrips 贴纹路用。 */
function makeBarrelSurf(rFn) {
  return (a, y) => {
    const r = rFn(y);
    return { p: [r * Math.cos(a), y, r * Math.sin(a)], n: [Math.cos(a), 0, Math.sin(a)] };
  };
}

/** 柱肢（魔像的腿是承重仓柱）：大腿柱 + 小腿柱 + 石板脚；粗细/长度全走 P。 */
function limbGeometry(T, P) {
  const out = {};
  {
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW, { y: -P.thighL / 2, top: 1.12, bottom: 0.9 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(P.legW * 1.05, P.shinL, P.legW * 1.05, { y: -P.shinL / 2, top: 0.95, bottom: 1.08 });
    ps.box(P.legW * (P.footW ?? 1.5), 0.12, P.legW * 2.0,
      { y: -P.shinL + 0.05, z: P.legW * 0.35, top: 1.0, bottom: 0.95 });
    out.shin = ps.build();
  }
  {
    const p = parts(T);
    p.box(P.armW * 1.25, P.upperL, P.armW * 1.2, { y: -P.upperL / 2, top: 1.18, bottom: 0.86 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 1.45, P.foreL, P.armW * 1.35, { y: -P.foreL / 2, top: 0.9, bottom: 1.08 });
    // 石拳（拳径 P.fistW × 臂粗——rockgolem 的巨拳是其剪影词之一）
    pf.box(P.armW * P.fistW, P.armW * P.fistW, P.armW * P.fistW,
      { y: -P.foreL - P.armW * P.fistW * 0.4, top: 0.9, bottom: 0.9 });
    out.fore = pf.build();
  }
  return out;
}

/** 行走魔像 rig 装配（rock/magma/frost 共用）：人形契约（bake 零改动可烘）。
 *  G = 物种几何字典（pelvis/limbs/torso/shoulderRock/head 件/cracks），
 *  物种 build 负责后挂装饰件（角/冠/刺等，noHit）。 */
function buildGolemRig(spec, mats, actor, G) {
  const P = spec.proportions;
  const { meshes, add, count } = mkActorTools(mats, actor);
  // R = 逐实例随机：工厂（createZombieEx）withSeed 流内调用，保持原样
  const R = () => Math.random();

  // 抖动方案照抄 buildHumanoid 的分布（gait.js makeGaitParams 复算侧同分布）
  const j = {
    leg: 0.93 + R() * 0.15,
    arm: 0.92 + R() * 0.17,
    girth: 0.90 + R() * 0.22,
    chest: 0.93 + R() * 0.15,
    chestW: 0.90 + R() * 0.20,
    head: 0.93 + R() * 0.14,
  };
  const asym = {
    scale: 0.90 + R() * 0.20,
    tilt: (R() - 0.5) * 0.20,      // 魔像头歪得比尸体克制（巨石不是烂肉）
    droop: (R() - 0.5) * 0.07,
    reach: (R() - 0.5) * 0.38,
  };
  const lead = asym.reach >= 0 ? 1 : -1;
  const gait = { stride: 0.85 + R() * 0.32, swing: 0.8 + R() * 0.45 };

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = P.hipY * j.leg;
  body.add(hips);
  add(hips, G.pelvis, mats.wrapDark, 'body').scale.set(j.chestW, 1, j.chestW);

  // 柱腿（站位一前一后，同人形契约）
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX * j.chestW, 0,
      side === lead ? P.legX * 0.42 : -P.legX * 0.26);
    hips.add(hip);
    add(hip, G.thigh, mats.wrap, 'body').scale.set(j.girth, j.leg, j.girth);
    const knee = new THREE.Group();
    knee.position.y = -P.thighL * j.leg;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body').scale.set(j.girth, j.leg, j.girth);
    legs.push({ hip, knee, side });
  }

  // 躯干（桶身 + 肩头岩 + 贴面纹路）
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  torso.rotation.y = asym.reach * 0.85;
  hips.add(torso);
  add(torso, G.torso, mats.wrap, 'body').scale.set(j.chestW, j.chest, j.chestW);
  if (G.shoulderRock) {
    add(torso, G.shoulderRock, mats.wrapDark, 'body').scale.set(j.chestW, j.chest, j.chestW);
  }
  if (G.cracks) add(torso, G.cracks, P.crackMat === 'deep' ? mats.deep : mats.eye, 'body', true);   // 贴面纹 noHit

  // 巨石臂
  const arms = [];
  for (const side of [-1, 1]) {
    const w = side === lead ? 1.11 : 0.93;
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.shoulderX * j.chestW * w,
      P.shoulderY * j.chest + side * asym.droop,
      side === lead ? P.shoulderX * 0.16 : -P.shoulderX * 0.10);
    torso.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body').scale.set(j.girth, j.arm, j.girth);
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL * j.arm;
    shoulder.add(elbow);
    add(elbow, G.fore, mats.wrapDark, 'body').scale.set(j.girth, j.arm, j.girth);
    arms.push({ shoulder, elbow, side, bias: side * asym.reach });
  }

  // 头（物种特色件全在 G 里；头盒心探出躯干盒顶 = 爆头可达铁律）
  const neck = new THREE.Group();
  neck.position.y = P.headY * j.chest;
  neck.scale.setScalar(j.head);
  neck.rotation.y = -asym.reach * 1.15;
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  if (G.headDark) add(neck, G.headDark, mats.wrapDark, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  const blob = contactShadow((spec.radius ?? 0.55) * 1.8);
  blob.position.y = 0.03;
  group.add(blob);

  const rig = {
    group, body, hips, torso, neck, legs, arms, tatters: [], meshes,
    triangles: 0, asym, gait, lead, blob,
    stepSpan: 2 * ((P.thighL || 0.5) + (P.shinL || 0.5)) * j.leg,
    twistBase: torso.rotation.y,
    neckBase: neck.rotation.y,
    tools: { add, count },
  };
  rig.triangles = count();
  return rig;
}

/** 行走魔像的动画壳：core animateHumanoid 的 windup 后仰 0.30 rad 不可调
 *  （core 一行不改）——重甲巨物后仰读法太飘（用户实测报告「胸甲后甩」的
 *  真凶，板已于 r2 去除，字段保留）。按 spec.windupLean 反向抵消到目标幅值；
 *  instanced 侧 pipeline/gait.js 人形支直读同字段（双端同值同源）。 */
function golemAnimate(rig, spec, s) {
  MUMMY.animate(rig, spec, s);
  const wl = spec.windupLean ?? 0.30;
  if (wl !== 0.30 && s.windup > 0) {
    rig.torso.rotation.x -= s.windup * (0.30 - wl);   // 抵消 core 的固定 0.30 后仰
  }
}

// ---------------------------------------------------------------------------
// 物种一：岩石魔像 rockgolem —— 会走的碑（矮壮墩实：宽肩短腿巨拳，
// 半埋式石颅+单眼缝；苔藓斑+风化皴裂 deep 槽不发光）
// ---------------------------------------------------------------------------

const ROCKGEO = new Map();

/** 矮壮桶：半径表（lathe profile 与纹路贴面共用） */
const ROCK_PROFILE = [[0.001, -0.02], [0.36, 0.0], [0.46, 0.16], [0.50, 0.36],
  [0.44, 0.52], [0.32, 0.62], [0.001, 0.66]];

function rockGeometry(P) {
  let out = ROCKGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.30, P.bodyD * 0.9, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  Object.assign(out, limbGeometry(T, P));
  {
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
    // 肩头两座大岩丘（半埋石颅的「肩线」由它们撑出——顶低于头盒心，不挡判定）
    const pk = prims(T);
    for (const s of [-1, 1]) {
      pk.ellipsoid(0.20, 0.15, 0.18, { x: s * P.shoulderX * 0.85, y: P.chestH * 0.88, z: 0, rings: 4, segs: 7 });
    }
    out.shoulderRock = pk.build();
  }
  {
    // 半埋式石颅：矮扁颅（几乎没脖子，嵌进肩线；头顶与两肩岩丘同高）+ 单眼缝
    const p = prims(T);
    p.ellipsoid(P.headW * 0.55, P.headH * 0.40, P.headD * 0.50, { y: P.headH * 0.32, rings: 4, segs: 7 });
    out.skull = p.build();
    // 眉檐巨石（压出「头埋进肩」的读法）
    const pb = parts(T);
    pb.box(P.headW * 1.3, P.headH * 0.24, P.headD * 0.6, { y: P.headH * 0.52, z: P.headD * 0.2, top: 1.0, bottom: 0.8 });
    out.headDark = pb.build();
    // 单眼缝（eye 槽，一条横缝）
    const pe = parts(T);
    pe.box(P.headW * 0.66, P.headH * 0.075, 0.02, { y: P.headH * 0.34, z: P.headD * 0.50, chamfer: 0.002 });
    out.eyes = pe.build();
  }
  {
    // 苔藓斑 + 风化皴裂（deep 槽深色不发光）：主裂两侧+背面，顶部苔斑漫纹
    out.cracks = surfaceStrips(20260827, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.5, 0.02, 0.15, 0.52, 6, 0.020],
      [Math.PI - 0.5, 0.04, Math.PI + 0.3, 0.50, 6, 0.020],
      [Math.PI * 0.5, 0.03, Math.PI * 0.5, 0.52, 5, 0.024],
      [0.8, 0.24, 0.2, 0.38, 3, 0.013],
      [Math.PI - 0.8, 0.22, Math.PI - 0.15, 0.36, 3, 0.013],
      [1.35, 0.50, 1.8, 0.60, 3, 0.017],                    // 顶部苔痕（沿肩线漫）
    ]);
  }
  ROCKGEO.set(P, out);
  return out;
}

export function buildRockgolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = rockGeometry(P);
  return buildGolemRig(spec, mats, actor, G);
}

export const ROCKGOLEM = {
  id: 'rockgolem',
  name: 'Rockgolem（岩石魔像）',

  speed: 0.9,
  scale: 1.6,
  height: 2.6,
  radius: 0.62,

  palette: {
    wrap: 0x8a7a62,      // 灰褐岩身
    wrapDark: 0x5a4c3c,  // 深岩（小腿/前臂/肩岩/眉檐）
    deep: 0x2c2a1c,      // 皴裂+苔痕（深褐绿，不发光）
    eye: 0xffc86a,       // 琥珀单眼缝
    eyeGlow: 0.55,
    accent: 0x6e6558,
    tatter: 0x4a4438,
  },

  proportions: {
    hipY: 0.84, hipW: 0.60, bodyD: 0.54,          // 矮壮：髋低腿短
    legX: 0.24, legW: 0.26, thighL: 0.41, shinL: 0.43,   // hipY=thighL+shinL，铁律
    torsoY: 0.10, chestW: 0.86, chestH: 0.64,     // 宽桶
    torsoProfile: ROCK_PROFILE,
    shoulderX: 0.52, shoulderY: 0.46,             // 超宽肩
    armW: 0.19, upperL: 0.44, foreL: 0.50, fistW: 2.4,   // 巨拳
    headY: 0.72, headW: 0.26, headH: 0.24, headD: 0.26,  // 半埋石颅（头顶≈桶顶+缝）
    footW: 1.7,
    crackMat: 'deep',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.62,          // 低频重踏（每一步都砸地）
    stride: 0.50,
    armSwing: 0.26,
    armReach: 0.05,
    armSplay: 0.32,      // 宽桶身把巨臂撑开
    elbowBend: -0.08,
    lean: -0.05,
    sway: 0.14,
    hipTwist: 0.05,
    bob: 0.085,
    headLoll: 0.04,
    headDroop: -0.10,
  },

  windupLean: 0.08,      // 蓄力后仰压小（重甲巨物 0.30 读法太飘）
  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildRockgolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种二：熔岩魔像 magmagolem —— 倒三角熔炉（Boss 档 scale 2.3：高大魁梧、
// 上宽下收；熔岩缝发光铺满胸背 + 裂口发光嘴 + 双岩刺角）
// ---------------------------------------------------------------------------

const MAGMAGEO = new Map();

/** 倒三角桶：下收上阔（肩线最宽） */
const MAGMA_PROFILE = [[0.001, -0.02], [0.24, 0.02], [0.30, 0.22], [0.36, 0.44],
  [0.44, 0.62], [0.47, 0.74], [0.001, 0.80]];   // 顶收低：倒三角肩线顶住即可，
  // 再高会让肩峰盒挡住「低机位→头」的射线（r2 实测：肩线顶 5.1m 时 8m 外
  // 平视仰角的爆头射线先穿躯干盒顶缘）

function magmaGeometry(P) {
  let out = MAGMAGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.32, P.bodyD * 0.9, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  Object.assign(out, limbGeometry(T, P));
  {
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
    // 肩峰玄武岩块（倒三角的「肩线外扩」读法）
    const pk = prims(T);
    for (const s of [-1, 1]) {
      pk.ellipsoid(0.22, 0.16, 0.20, { x: s * P.shoulderX * 0.88, y: P.chestH * 0.80, z: 0, rings: 4, segs: 7 });
    }
    out.shoulderRock = pk.build();
  }
  {
    // 头：方颅 + 裂口发光嘴（熔岩从口器缝透出）+ 双岩刺角（装配处后挂）
    const p = prims(T);
    p.ellipsoid(P.headW * 0.52, P.headH * 0.44, P.headD * 0.48, { y: P.headH * 0.44, rings: 4, segs: 7 });
    out.skull = p.build();
    // 下颌岩（wrapDark）压住嘴缝下缘
    const pj = parts(T);
    pj.box(P.headW * 0.9, P.headH * 0.18, P.headD * 0.5, { y: P.headH * 0.10, z: P.headD * 0.2, top: 1.0, bottom: 0.85 });
    out.headDark = pj.build();
    // 裂口嘴 + 目缝（eye 槽合一：嘴下目上两条发光缝）
    const pe = parts(T);
    pe.box(P.headW * 0.7, P.headH * 0.07, 0.02, { y: P.headH * 0.20, z: P.headD * 0.48, chamfer: 0.002 });   // 裂口嘴
    pe.box(P.headW * 0.62, P.headH * 0.06, 0.02, { y: P.headH * 0.55, z: P.headD * 0.50, chamfer: 0.002 });  // 目缝
    out.eyes = pe.build();
  }
  {
    // 熔岩缝（eye 槽 1.05，透出近黑岩面）：胸背铺满——正面三主枝 + 背两枝 +
    // 往肩渗的短枝（r1 被胸甲盖着，r2 去甲后铺满）
    out.cracks = surfaceStrips(20260828, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.3, 0.04, 0.08, 0.80, 7, 0.024],                    // 正右主枝（爬到肩）
      [Math.PI - 0.3, 0.02, Math.PI - 0.08, 0.78, 7, 0.024],// 正左主枝
      [0.0, 0.10, 0.0, 0.70, 6, 0.022],                     // 正中枝
      [Math.PI * 0.5, 0.06, Math.PI * 0.45, 0.80, 6, 0.026],// 背主枝
      [Math.PI * 1.5, 0.08, Math.PI * 1.55, 0.76, 6, 0.026],// 背副枝
      [0.7, 0.30, 0.2, 0.50, 3, 0.015],                     // 支裂
      [Math.PI - 0.7, 0.32, Math.PI - 0.2, 0.52, 3, 0.015],
      [1.2, 0.55, 1.5, 0.72, 3, 0.014],
      [Math.PI - 1.2, 0.58, Math.PI - 1.5, 0.74, 3, 0.014],
    ]);
  }
  MAGMAGEO.set(P, out);
  return out;
}

export function buildMagmagolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = magmaGeometry(P);
  const rig = buildGolemRig(spec, mats, actor, G);
  const { add, count } = rig.tools;
  // 双岩刺角（后弯长刺，noHit 细长装饰件铁律）+ 关节缝渗光（黑岩拼缝透炉光）
  const horns = prims(WRAP_TILES);
  for (const s of [-1, 1]) {
    horns.cyl(0, 0.035, 0.30, { x: s * P.headW * 0.42, y: P.headH * 0.72, z: -P.headD * 0.1, rx: -0.7, rz: -s * 0.5, radial: 5 });
  }
  add(rig.neck, horns.build(), mats.wrapDark, 'head', true);
  const seams = prims(WRAP_TILES);
  for (const s of [-1, 1]) {
    seams.ellipsoid(0.035, 0.022, 0.035, { x: s * P.shoulderX, y: P.torsoY + P.shoulderY - 0.06, z: 0.02, rings: 3, segs: 5 });
    seams.ellipsoid(0.030, 0.020, 0.030, { x: s * P.legX, y: -0.04, z: 0.04, rings: 3, segs: 5 });
  }
  add(rig.torso, seams.build(), mats.eye, 'body', true);    // 细长渗光件 noHit
  rig.triangles = count();
  return rig;
}

export const MAGMAGOLEM = {
  id: 'magmagolem',
  name: 'Magmagolem（熔岩魔像）',

  speed: 0.7,            // Boss 的缓慢逼近
  scale: 2.3,            // Boss 梯队：bonebrute 平级、< draco 2.8 铁律
  height: 4.4,
  radius: 0.85,

  palette: {
    wrap: 0x1e1b1c,      // 黑玄武岩
    wrapDark: 0x322c2e,  // 深灰黑（腿/臂/肩峰/下颌岩）
    deep: 0x0c0a0c,
    eye: 0xff5a16,       // 熔岩橙红（裂缝/嘴缝/目缝/关节渗光同槽）
    eyeGlow: 1.05,       // 裂缝要透出近黑岩面（draco 1.1 同款定档）
    accent: 0x3c3638,
    tatter: 0x2c282a,
  },

  proportions: {
    hipY: 1.10, hipW: 0.52, bodyD: 0.50,          // 高大：腿长桶高
    legX: 0.20, legW: 0.22, thighL: 0.54, shinL: 0.56,   // hipY=thighL+shinL，铁律
    torsoY: 0.10, chestW: 0.94, chestH: 0.92,     // 倒三角大桶
    torsoProfile: MAGMA_PROFILE,
    shoulderX: 0.50, shoulderY: 0.72,
    armW: 0.16, upperL: 0.54, foreL: 0.60, fistW: 1.9,
    headY: 1.10, headW: 0.26, headH: 0.30, headD: 0.27,   // 头抬出肩峰线（爆头可达铁律）
    footW: 1.6,
    crackMat: 'eye',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.56,
    stride: 0.52,
    armSwing: 0.24,
    armReach: 0.06,
    armSplay: 0.30,
    elbowBend: -0.06,
    lean: -0.04,
    sway: 0.11,
    hipTwist: 0.04,
    bob: 0.09,
    headLoll: 0.04,
    headDroop: -0.08,
  },

  windupLean: 0.08,
  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildMagmagolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种三：冰霜魔像 frostgolem —— 瘦高冰塔（棱柱/冰柱感躯干 + 细长四肢带
// 冰锥 + 光滑无面冰面 + 双冰蓝眼 + 冰锥冠；冰白霜纹克制 0.6）
// ---------------------------------------------------------------------------

const FROSTGEO2 = new Map();

/** 瘦高冰柱：细收长桶（上微收的棱柱读法） */
const FROST_PROFILE = [[0.001, -0.02], [0.22, 0.02], [0.27, 0.26], [0.28, 0.52],
  [0.26, 0.74], [0.20, 0.86], [0.001, 0.92]];

function frostGeometry(P) {
  let out = FROSTGEO2.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.26, P.bodyD * 0.85, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  Object.assign(out, limbGeometry(T, P));
  {
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 8 });   // 少分段 = 棱柱面读法
    out.torso = p.build();
    // 肩冰棱（小而挺，瘦高体的肩线标记）
    const pk = prims(T);
    for (const s of [-1, 1]) {
      pk.ellipsoid(0.13, 0.11, 0.13, { x: s * P.shoulderX * 0.85, y: P.chestH * 0.90, z: 0, rings: 4, segs: 6 });
    }
    out.shoulderRock = pk.build();
  }
  {
    // 光滑无面冰面（无下颌无眉檐的光颅——「没有脸」就是它的脸）+ 双冰蓝眼
    const p = prims(T);
    p.ellipsoid(P.headW * 0.50, P.headH * 0.50, P.headD * 0.48, { y: P.headH * 0.48, rings: 5, segs: 8 });
    out.skull = p.build();
    const pe = prims(T);
    for (const s of [-1, 1]) {
      pe.ellipsoid(0.024, 0.030, 0.018, { x: s * P.headW * 0.20, y: P.headH * 0.52, z: P.headD * 0.46, rings: 3, segs: 6 });
    }
    out.eyes = pe.build();
    out.headDark = null;
  }
  {
    // 冰白霜纹/冻裂纹（eye 槽克制 0.6）：细枝多分叉，冰面结晶的蕨状读法
    out.cracks = surfaceStrips(20260829, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.35, 0.06, 0.1, 0.72, 6, 0.011],
      [Math.PI - 0.35, 0.04, Math.PI - 0.1, 0.70, 6, 0.011],
      [Math.PI * 0.5, 0.08, Math.PI * 0.52, 0.74, 5, 0.013],
      [0.85, 0.24, 0.4, 0.48, 4, 0.008],                    // 蕨状细分叉
      [Math.PI - 0.85, 0.26, Math.PI - 0.4, 0.50, 4, 0.008],
      [0.2, 0.50, -0.25, 0.66, 3, 0.008],
      [Math.PI + 0.2, 0.52, Math.PI + 0.5, 0.68, 3, 0.008],
    ]);
  }
  FROSTGEO2.set(P, out);
  return out;
}

export function buildFrostgolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = frostGeometry(P);
  const rig = buildGolemRig(spec, mats, actor, G);
  const { add, count } = rig.tools;
  // 冰锥冠（头顶一圈四根冰刺，noHit）+ 肘冰锥（细长四肢的「冰刺骨节」）
  const crown = prims(WRAP_TILES);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    crown.cyl(0, 0.024, 0.16 - (k % 2) * 0.04, {
      x: Math.cos(a) * P.headW * 0.30, y: P.headH * 0.92, z: Math.sin(a) * P.headW * 0.30,
      rx: Math.sin(a) * 0.45, rz: -Math.cos(a) * 0.45, radial: 4 });
  }
  add(rig.neck, crown.build(), mats.accent, 'head', true);
  const spikes = prims(WRAP_TILES);
  for (const side of [-1, 1]) {
    // 肘冰锥（挂肘关节，向外挑）
    spikes.cyl(0, 0.030, 0.20, { x: side * 0.06, y: 0.0, z: -0.02, rx: -0.5, rz: -side * 0.9, radial: 4 });
  }
  const spikeGeo = spikes.build();
  add(rig.arms[0].elbow, spikeGeo, mats.accent, 'arm', true);
  add(rig.arms[1].elbow, spikeGeo, mats.accent, 'arm', true);
  rig.triangles = count();
  return rig;
}

/** 冰霜材质：基底六槽照常，accent 槽（冰锥冠/肘刺）换半透明冰 */
function makeFrostMaterials(spec, rng) {
  const mats = makeZombieMaterialsFrom(spec, linenMaps(), rng);
  mats.accent.transparent = true;
  mats.accent.opacity = 0.7;
  mats.accent.depthWrite = false;   // 半透明件不写深度（wraith 方案同款取舍）
  mats.accent.roughness = 0.25;     // 冰面低糙度
  return mats;
}

export const FROSTGOLEM = {
  id: 'frostgolem',
  name: 'Frostgolem（冰霜魔像）',

  speed: 0.85,
  scale: 1.5,
  height: 3.3,           // 瘦高：比 rockgolem 高半米但细一圈
  radius: 0.52,

  palette: {
    wrap: 0xc8d8e2,      // 苍白蓝冰岩
    wrapDark: 0x8aa2b2,  // 灰蓝冰
    deep: 0x1a2430,
    eye: 0xd8f4ff,       // 冰白发光（霜纹/双眼同槽，克制）
    eyeGlow: 0.6,
    accent: 0xbfe0f0,    // 冰锥冠/肘刺（半透冰件由 makeFrostMaterials 换透明）
    accentRough: 0.25,
    accentMetal: 0.0,
    tatter: 0x8aa2b2,
  },

  proportions: {
    hipY: 1.12, hipW: 0.44, bodyD: 0.40,          // 瘦高：腿长桶细
    legX: 0.15, legW: 0.16, thighL: 0.55, shinL: 0.57,   // hipY=thighL+shinL，铁律
    torsoY: 0.10, chestW: 0.56, chestH: 0.90,     // 细高冰柱桶
    torsoProfile: FROST_PROFILE,
    shoulderX: 0.32, shoulderY: 0.74,
    armW: 0.11, upperL: 0.56, foreL: 0.60, fistW: 1.4,   // 细长臂小拳
    headY: 1.02, headW: 0.20, headH: 0.26, headD: 0.22,
    footW: 1.2,
    crackMat: 'eye',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.7,
    stride: 0.55,          // 大长腿步幅大
    armSwing: 0.28,
    armReach: 0.04,
    armSplay: 0.20,
    elbowBend: -0.10,
    lean: -0.03,           // 冰塔最直
    sway: 0.09,
    hipTwist: 0.05,
    bob: 0.06,
    headLoll: 0.04,
    headDroop: -0.05,
  },

  windupLean: 0.08,
  makeMaterials: makeFrostMaterials,
  build: buildFrostgolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种四：水晶魔像 crystalgolem —— 晶簇聚合体（中等身材半悬浮：躯干由晶簇
// 拼成、无常规腿型（垂落晶柱）+ 悬浮大水晶当头 + 碎晶环绕转；紫青晶脉）
// ---------------------------------------------------------------------------

const CRYSTALGEO = new Map();

function crystalGeometry(P) {
  let out = CRYSTALGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：岩核小桶 + 晶簇拼壳（多根高低不一的水晶棱柱从核上长出——
    // 「躯干由晶簇拼成」的读法：侧视高低错落的尖顶线）
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 8 });
    out.torso = p.build();
    const pk = prims(T);
    // 主簇：胸前两大棱晶 + 肩背三簇 + 顶心一根主晶柱
    pk.cyl(0.02, 0.09, 0.42, { x: 0.10, y: P.chestH * 0.75, z: 0.16, rx: 0.5, rz: -0.4, radial: 5 });
    pk.cyl(0.02, 0.08, 0.36, { x: -0.12, y: P.chestH * 0.70, z: 0.14, rx: 0.4, rz: 0.5, radial: 5 });
    for (const s of [-1, 1]) {
      pk.cyl(0.02, 0.10, 0.46, { x: s * P.shoulderX * 0.8, y: P.chestH * 0.82, z: -0.06, rx: -0.35, rz: -s * 0.6, radial: 5 });
      pk.cyl(0.015, 0.06, 0.28, { x: s * P.shoulderX * 0.55, y: P.chestH * 0.70, z: 0.14, rx: 0.45, rz: -s * 0.35, radial: 4 });
    }
    pk.cyl(0.02, 0.11, 0.5, { x: 0, y: P.chestH * 0.95, z: -0.10, rx: -0.5, radial: 5 });
    out.clusters = pk.build();
  }
  {
    // 头：悬浮大水晶（菱锥八面体，无下颚——整块晶体当头，岩颈很短）
    const p = prims(T);
    p.cyl(0.03, 0.05, 0.10, { y: 0.0, radial: 5 });                        // 岩颈
    p.cyl(0, 0.14, 0.20, { y: 0.20, radial: 6 });                          // 上锥
    p.cyl(0.14, 0, 0.16, { y: 0.02, radial: 6, capTop: false });           // 下锥
    out.skull = p.build();
    // 晶体腰部发光环带（eye 槽：晶核透光读法）
    const pe = prims(T);
    pe.cyl(0.145, 0.145, 0.030, { y: 0.11, radial: 6, capTop: false, capBot: false });
    out.eyes = pe.build();
    out.headDark = null;
  }
  {
    // 垂落晶柱（代替腿型：两根短晶柱挂躯干下，fly.legs 通道微摆）
    const p = prims(T);
    p.cyl(0.02, P.legW * 0.5, P.thighL, { y: -P.thighL / 2, radial: 5 });
    out.thigh = p.build();
    const ps = prims(T);
    ps.cyl(P.legW * 0.45, 0, P.shinL, { y: -P.shinL / 2, radial: 5, capTop: false });
    out.shin = ps.build();
  }
  {
    // 臂：岩臂 + 晶拳簇
    const p = parts(T);
    p.box(P.armW * 1.2, P.upperL, P.armW * 1.15, { y: -P.upperL / 2, top: 1.15, bottom: 0.88 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 1.3, P.foreL, P.armW * 1.25, { y: -P.foreL / 2, top: 0.9, bottom: 1.05 });
    out.foreBase = pf.build();
    const pk = prims(T);
    pk.cyl(0.015, 0.07, 0.22, { y: -P.foreL - 0.08, rx: 0.3, radial: 5 });
    pk.cyl(0.015, 0.05, 0.16, { x: 0.05, y: -P.foreL - 0.06, rz: -0.5, radial: 4 });
    pk.cyl(0.015, 0.05, 0.16, { x: -0.05, y: -P.foreL - 0.06, rz: 0.5, radial: 4 });
    out.fistCrystal = pk.build();
  }
  {
    // 悬浮碎晶环（破布槽 spin 通道）：五片菱晶绕肩线一圈
    const p = prims(T);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const R = 0.62;
      p.cyl(0, 0.045, 0.10, { x: Math.cos(a) * R, y: 0.055, z: Math.sin(a) * R, radial: 5, capBot: false });
      p.cyl(0.045, 0, 0.10, { x: Math.cos(a) * R, y: -0.055, z: Math.sin(a) * R, radial: 5, capTop: false });
    }
    out.ringShards = p.build();
  }
  {
    // 紫青晶脉（eye 槽 0.9）：岩核桶面上的晶格线（低抖动长流线）
    out.cracks = surfaceStrips(20260830, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.35, 0.04, 0.1, 0.62, 6, 0.013, 0.12],
      [Math.PI - 0.35, 0.06, Math.PI - 0.08, 0.60, 6, 0.013, 0.12],
      [Math.PI * 0.5, 0.06, Math.PI * 0.52, 0.62, 5, 0.015, 0.12],
      [0.85, 0.30, 0.3, 0.48, 3, 0.009, 0.12],
      [Math.PI - 0.85, 0.28, Math.PI - 0.25, 0.46, 3, 0.009, 0.12],
    ]);
  }
  CRYSTALGEO.set(P, out);
  return out;
}

export function buildCrystalgolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = crystalGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;                 // 半悬浮高度（bake 保留进几何）
  body.add(hips);
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  hips.add(torso);

  const jw = 0.94 + R() * 0.12;
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.clusters, mats.accent, 'body', true);         // 晶簇壳 noHit 装饰
  add(torso, G.cracks, mats.eye, 'body', true);              // 晶脉 noHit

  // 垂落晶柱腿（fly.legs 通道微摆）
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX * jw, -0.06, 0);
    torso.add(hip);
    add(hip, G.thigh, mats.wrapDark, 'body');
    const knee = new THREE.Group();
    knee.position.y = -P.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.accent, 'body');
    legs.push({ hip, knee, side });
  }
  // 岩臂 + 晶拳簇（静态垂落，姿态烘进几何；flapAmp=0 时臂通道静默）
  const arms = [];
  for (const side of [-1, 1]) {
    const mount = new THREE.Group();
    mount.position.set(side * P.shoulderX * jw, P.shoulderY, 0);
    mount.rotation.z = side * 0.10;
    torso.add(mount);
    const shoulder = new THREE.Group();
    mount.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL;
    shoulder.add(elbow);
    add(elbow, G.foreBase, mats.wrapDark, 'body');
    add(elbow, G.fistCrystal, mats.accent, 'body', true);   // 晶拳 noHit
    arms.push({ shoulder, elbow, side });
  }

  // 头：悬浮大水晶（晶簇顶上的整块菱锥；头盒心探出躯干盒顶）
  const neck = new THREE.Group();
  neck.position.y = P.headY;
  torso.add(neck);
  add(neck, G.skull, mats.accent, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // 悬浮碎晶环：破布槽 spin 通道（fillFly/animateFlyer 双端同款）
  const tatters = [];
  {
    const pivot = new THREE.Group();
    pivot.position.set(0, P.chestH * 0.78, 0);
    torso.add(pivot);
    add(pivot, G.ringShards, mats.accent, 'body', true);   // 环片全 noHit
    tatters.push({ pivot, restZ: 0, phase: 0, swing: 1, spin: P.tatters[0].spin });
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.6) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  const rig = {
    group, body, hips, torso, neck, legs, arms, tatters, meshes,
    triangles: 0, asym, lead: 1, blob,
    // 不声明 stepSpan：悬浮种走 (0.8+speed·rate) 常量支 = 悬浮时钟
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
    tools: { add, count },
  };
  rig.triangles = count();
  return rig;
}

export const CRYSTALGOLEM = {
  id: 'crystalgolem',
  name: 'Crystalgolem（水晶魔像）',

  speed: 1.1,            // 悬浮滑行比走快一档
  scale: 1.7,
  height: 3.1,
  radius: 0.62,
  flyY: 0.85,            // 半悬浮：晶柱距地 ~0.3m（读作「浮不起来的巨物」）

  palette: {
    wrap: 0x4a4258,      // 暗紫岩核
    wrapDark: 0x342e40,  // 深紫岩
    deep: 0x16121e,
    eye: 0xb08aff,       // 紫青晶脉/晶头环带同槽
    eyeGlow: 0.9,
    accent: 0x7a5ac8,    // 紫水晶（晶簇/晶柱/晶头/碎晶环/晶拳同槽）
    accentRough: 0.35,
    accentMetal: 0.3,
    tatter: 0x342e40,
  },

  proportions: {
    hipW: 0.5, bodyD: 0.48,
    legX: 0.16, legW: 0.16, thighL: 0.30, shinL: 0.34,   // 垂落晶柱（非常规腿）
    torsoY: 0.08, chestW: 0.66, chestH: 0.72,
    torsoProfile: [[0.001, -0.02], [0.24, 0.02], [0.30, 0.22], [0.32, 0.44],
      [0.28, 0.58], [0.20, 0.68], [0.001, 0.72]],
    shoulderX: 0.36, shoulderY: 0.56,
    armW: 0.13, upperL: 0.46, foreL: 0.50,
    headY: 0.86, headW: 0.22, headH: 0.40, headD: 0.22,  // 大水晶头（含上下锥）
    crackMat: 'eye',
    tatterRest: 0,
    tatters: [{ x: 0, y: 0, z: 0, w: 0, h: 0, spin: 0.7 }],   // 碎晶环自旋速率
  },

  gait: {
    kind: 'fly',
    rate: 4.0,           // (TAU·0.8 - 0.8) / 1.1：悬浮时钟 0.8Hz（巨物低频起伏）
    fly: {
      flapRate: 0,       // 无翼悬浮（时钟兜底 0.9Hz，fillFly 除零护栏）
      flapAmp: 0,
      bobAmp: 0.07, bobRate: 0.8,
      weave: 0.04, pitch: 0.02,
      wingPairs: 0,
      legs: true, legDangle: 0.10, legBend: 0.15,   // 垂落晶柱微摆
      headUp: -0.06, headScan: 0.3,
      windupLean: 0.10,      // 悬浮巨物蓄力仰身压小
      hoverPitch: -0.03,
      hoverHeadUp: 0.10,
    },
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildCrystalgolem,
  animate: animateFlyer,
};
