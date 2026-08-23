/**
 * 龙系列：精灵龙 sprite / 土龙 earth / 冰龙 frost / 黑红大龙 draco。
 * 复用 flyers.js 的飞行契约（gait.kind='fly'，animateFlyer/fillFlyJoints 双端同源）
 * 与小件（mirrorX/mkActorTools/flyBlob）。四剪影词互不冲突也不撞飞行系列：
 * 飘带（纤细流线+细尾）/ 葫芦（胖球身+小翼）/ 枯枝（骨架+烂膜）/ 王座三角（大三角）。
 *
 * 龙形共性契约（与 flyers.js 的差异点）：
 *   - 长颈 + 头伸出躯干剪影（爆头可达铁律）：颈节 mesh 标 noHit（长颈不
 *     并入头盒，否则头盒体积爆 0.8 躯干比），角/须/耳等装饰件一律 noHit。
 *   - 长尾 = 3 节链式破布 pivot（TATTER 槽 24+，预算 ≤8）：节间相位差
 *     由 fillFly/animateFlyer 的破布通道自然给出（尾不做碰撞体）。
 *   - 膜翼注册 arms[2]/[3]（ARM2/EL2 扩展关节位 20-23；arms[0..1] 留空，
 *     fillFly 第 0 对翼通道写空槽无害）；翼指撑膜的蝙蝠翼读法（骨+膜面片）。
 *   - 四肢：后腿 legs[0..1]（fillFly 腿通道垂摆），前腿 legs[2..3]（LEG2 槽，
 *     静态 mount 收拢贴腹，烘进几何，fillFly 不写——零四元数按恒等安全通过，
 *     同 scarab 空槽先例）。
 *   - 冰龙骨架感全用几何（肋骨梁/骨节），烂翼膜用破布条（tatter 槽）。
 */

import * as THREE from 'three';
import { parts, tornStrip } from '../core/anatomy.js';
import { WRAP_TILES } from '../core/wraps.js';
import { prims } from '../prims.js';
import { mirrorX, mkActorTools, flyBlob } from './flyers.js';
import { animateFlyer } from './flyers.js';

// ---------------------------------------------------------------------------
// 共享：龙骨架装配（G 几何字典 + D 布局尺寸 → rig）
// G: torso, neckSeg, skull, snout, horns, eyes, wingShBone, wingShMem?,
//    wingElBone, wingElMem?, tailSeg[3], thigh, shin
// D: { torsoW, torsoD, neckY, neckZ, wingY, wingSweep, legX, legZ, tailL[3], ragSpec? }
// ---------------------------------------------------------------------------

function buildDragonRig(spec, mats, actor, G, D) {
  const { meshes, add, count } = mkActorTools(mats, actor);
  // R = 逐实例随机：本函数只经 spec.build 在工厂（createZombieEx）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;                 // 飞行高度（bake 保留进几何）
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const jw = 0.94 + R() * 0.12;
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);

  // 长颈 + 头：颈节 noHit（不并入头盒），头骨+吻部+角+眼 = 头盒
  const neck = new THREE.Group();
  neck.position.set(0, D.neckY, D.neckZ);
  torso.add(neck);
  add(neck, G.neckSeg, mats.wrap, 'head', true);        // 长颈不撑头盒
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.snout, mats.wrapDark, 'head');
  add(neck, G.horns, mats.accent, 'head', true);        // 角：细长件 noHit
  add(neck, G.eyes, mats.eye, 'head');
  if (G.whiskers) add(neck, G.whiskers, mats.accent, 'head', true);   // 须（sprite）
  if (G.ribs) add(torso, G.ribs, mats.wrap, 'body');                  // 肋梁（frost）
  if (G.pelvis) add(torso, G.pelvis, mats.wrapDark, 'body');

  // 膜翼一对 = arms[2]/[3]（ARM2/EL2 槽，bake 按下标注册：arms[2]=L / arms[3]=R；
  // arms[0..1] 留空——前腿在 LEG2 槽，fillFly 第 0 对翼通道写空槽无害）
  const arms = [];
  const legs = [];
  const tatters = [];
  // 长尾：3 节链式破布 pivot（节间相位差自然摆动；尾不做碰撞体）。
  // 先于翼部装配——rig.tatters 顺序必须与 spec.proportions.tatters 一致
  // （makeGaitParams 按下标对齐逐实例参数）。
  let tailParent = hips;
  let tailZ = -D.torsoD * 0.5;
  for (let k = 0; k < 3; k++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, k === 0 ? -0.02 : 0, tailZ);
    tailParent.add(pivot);
    add(pivot, G.tailSeg[k], mats.wrapDark, 'body', true);   // noHit：尾不打
    tatters.push({ pivot, restZ: 0, phase: k * 1.1, swing: 1.0 + k * 0.35 });
    tailParent = pivot;
    tailZ = -D.tailL[k];
  }

  for (const side of [-1, 1]) {
    const mountW = new THREE.Group();
    mountW.position.set(side * D.torsoW * 0.5 * jw, D.wingY, -D.torsoD * 0.1);
    mountW.rotation.y = -side * D.wingSweep;
    torso.add(mountW);
    const shoulder = new THREE.Group();
    mountW.add(shoulder);
    add(shoulder, side > 0 ? G.wingShBone : G.wingShBoneL, mats.wrapDark, 'body');
    if (G.wingShMem) add(shoulder, side > 0 ? G.wingShMem : G.wingShMemL, mats.accent, 'body');
    const elbow = new THREE.Group();
    elbow.position.x = side * D.shLen;
    shoulder.add(elbow);
    add(elbow, side > 0 ? G.wingElBone : G.wingElBoneL, mats.wrapDark, 'body');
    if (G.wingElMem) add(elbow, side > 0 ? G.wingElMem : G.wingElMemL, mats.accent, 'body');
    arms[side < 0 ? 2 : 3] = { shoulder, elbow, side };   // ARM2_L / ARM2_R

    // 烂翼膜（frost）：破布条挂翼肘，tatter 槽随翼拍动
    for (const t of (D.ragSpec || []).filter(tt => tt.side === side)) {
      const pivot = new THREE.Group();
      pivot.position.set(side * t.px, 0, t.pz);
      elbow.add(pivot);
      const m = new THREE.Mesh(tornStrip(t.w, t.h, t.cut || 0, 6, WRAP_TILES), mats.tatter);
      m.userData.noHit = true;
      m.castShadow = false;
      pivot.add(m);
      tatters.push({ pivot, restZ: 0, phase: R() * 6.283, swing: t.swing ?? 1 });
      meshes.push(m);
    }
  }

  // 后腿 legs[0..1]（fillFly 腿通道垂摆）+ 前腿 legs[2..3]（静态 mount 收拢）
  for (const side of [-1, 1]) {
    const mountH = new THREE.Group();
    mountH.position.set(side * D.legX, -D.torsoH * 0.42, D.legZ);
    torso.add(mountH);
    const hip = new THREE.Group();
    mountH.add(hip);
    add(hip, G.thigh, mats.wrapDark, 'body');
    const knee = new THREE.Group();
    knee.position.y = -D.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    legs.push({ hip, knee, side });
  }
  for (const side of [-1, 1]) {
    const mountF = new THREE.Group();
    mountF.position.set(side * D.legX * 0.8, -D.torsoH * 0.40, D.legZ + D.torsoD * 0.42);
    mountF.rotation.x = -0.9;                    // 收拢贴腹（静态，烘进几何）
    torso.add(mountF);
    const hip = new THREE.Group();
    mountF.add(hip);
    add(hip, G.thigh, mats.wrapDark, 'body');
    const knee = new THREE.Group();
    knee.position.y = -D.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    legs.push({ hip, knee, side });
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.4) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters, meshes,
    triangles: count(), asym, lead: 1, blob,
    // 不声明 stepSpan：stepRate 走 (0.8+speed·rate) 常量支 = 拍翅时钟
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

/** 膜翼几何（单侧 +x）：臂骨 + 3 翼指 + 指间膜面片（蝙蝠翼读法）。
 *  cfg: { boneL, chord, fingerN, memT(膜厚), boneW } */
function wingGeometry(T, cfg) {
  const bone = parts(T);
  bone.box(cfg.boneL, cfg.boneW, cfg.boneW * 1.2, { x: cfg.boneL / 2, z: 0.02 });
  for (let k = 0; k < cfg.fingerN; k++) {
    const t = (k + 1) / cfg.fingerN;
    bone.box(cfg.boneL * (1 - t * 0.35), cfg.boneW * 0.55, cfg.boneW * 0.55,
      { x: cfg.boneL * 0.55 + t * cfg.boneL * 0.3, z: -cfg.chord * (0.3 + t * 0.6), ry: -0.25 - t * 0.55 });
  }
  const mem = parts(T);
  for (let k = 0; k < cfg.fingerN; k++) {
    const t = k / cfg.fingerN;
    mem.box(cfg.boneL * 0.72, cfg.memT, cfg.chord * 0.42,
      { x: cfg.boneL * (0.42 + t * 0.2), z: -cfg.chord * (0.32 + t * 0.3), ry: -0.18 - t * 0.25 });
  }
  return { bone: bone.build(), mem: mem.build() };
}

// ---------------------------------------------------------------------------
// 物种一：精灵龙 sprite —— 飘带（纤细流线 + 细尾，8Hz 小振幅，weave 大）
// ---------------------------------------------------------------------------

const SPRITEGEO = new Map();

function spriteGeometry(P) {
  let out = SPRITEGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：纤细纺锤（lathe 横放）
    const p = prims(T);
    p.lathe([
      [0.001, -0.30], [0.045, -0.26], [0.075, -0.12], [0.085, 0.02],
      [0.075, 0.14], [0.045, 0.24], [0.001, 0.30],
    ], { rx: Math.PI / 2, segs: 8 });
    out.torso = p.build();
  }
  {
    // 长颈（两节斜上伸）+ 小头 + 吻 + 大耳 + 长须 + 大眼
    const p = prims(T);
    p.cyl(0.030, 0.038, 0.20, { rx: Math.PI / 2 - 0.45, y: 0.05, z: 0.09, radial: 6 });
    p.cyl(0.024, 0.030, 0.16, { rx: Math.PI / 2 - 0.25, y: 0.13, z: 0.24, radial: 6 });
    out.neckSeg = p.build();

    const ps = prims(T);
    ps.ellipsoid(0.055, 0.048, 0.070, { y: 0.19, z: 0.33, rings: 5, segs: 8 });
    out.skull = ps.build();

    const pn = prims(T);
    pn.cyl(0.008, 0.026, 0.09, { rx: Math.PI / 2 + 0.15, y: 0.175, z: 0.42, radial: 6 });
    out.snout = pn.build();

    const ph = prims(T);
    for (const s of [-1, 1]) {
      ph.cyl(0, 0.020, 0.13, { x: s * 0.05, y: 0.27, z: 0.30, rx: -0.5, rz: -s * 0.7, radial: 5 });   // 大耳
    }
    out.horns = ph.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.020, 0.024, 0.016, { x: s * 0.035, y: 0.20, z: 0.375, rings: 3, segs: 6 });
    out.eyes = pe.build();

    // 长须（accent，两根前垂须，细长件——在 rig 装配时与角同标 noHit）
    const pw = prims(T);
    for (const s of [-1, 1]) {
      pw.cyl(0, 0.005, 0.16, { x: s * 0.018, y: 0.11, z: 0.44, rx: 2.5, radial: 5 });
    }
    out.whiskers = pw.build();
  }
  {
    // 膜翼（小一号，轻盈）
    const w = wingGeometry(T, { boneL: 0.42, chord: 0.34, fingerN: 3, memT: 0.005, boneW: 0.020 });
    out.wingShBone = w.bone; out.wingShMem = w.mem;
    const w2 = wingGeometry(T, { boneL: 0.34, chord: 0.26, fingerN: 2, memT: 0.005, boneW: 0.016 });
    out.wingElBone = w2.bone; out.wingElMem = w2.mem;
    out.wingShBoneL = mirrorX(out.wingShBone); out.wingShMemL = mirrorX(out.wingShMem);
    out.wingElBoneL = mirrorX(out.wingElBone); out.wingElMemL = mirrorX(out.wingElMem);
  }
  {
    // 细尾三节（飘带尾巴：逐节细）
    const p1 = prims(T); p1.cyl(0.010, 0.028, 0.26, { rx: -Math.PI / 2, z: -0.13, radial: 5 });
    const p2 = prims(T); p2.cyl(0.006, 0.014, 0.22, { rx: -Math.PI / 2, z: -0.11, radial: 5 });
    const p3 = prims(T); p3.cyl(0.012, 0.006, 0.20, { rx: -Math.PI / 2, z: -0.10, radial: 5 });   // 尾梢小菱
    out.tailSeg = [p1.build(), p2.build(), p3.build()];
  }
  {
    // 细腿（后腿垂摆 / 前腿收拢同款）
    const p = parts(T);
    p.box(0.028, 0.12, 0.028, { y: -0.06, top: 1.05, bottom: 0.75 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(0.022, 0.12, 0.022, { y: -0.06, top: 1.05, bottom: 0.75 });
    out.shin = ps.build();
  }
  SPRITEGEO.set(P, out);
  return out;
}

export function buildSprite(spec, mats, actor) {
  const P = spec.proportions;
  const G = spriteGeometry(P);
  return buildDragonRig(spec, mats, actor, G, {
    torsoW: 0.17, torsoH: 0.17, torsoD: 0.60,
    neckY: 0.04, neckZ: 0.28,
    wingY: 0.08, wingSweep: 0.15, shLen: 0.42,
    legX: 0.06, legZ: -0.10, thighL: 0.12,
    tailL: [0.26, 0.22, 0.20],
  });
}

export const SPRITE = {
  id: 'sprite',
  name: 'Sprite（精灵龙）',

  speed: 2.4,
  scale: 1.0,
  height: 0.5,
  radius: 0.28,
  flyY: 1.7,

  palette: {
    wrap: 0x7ac4d8,      // 水蓝
    wrapDark: 0x4a90a8,  // 深青（吻/翼骨/腿/尾）
    deep: 0x12242c,
    eye: 0xd8f4ff,       // 冰白大眼
    eyeGlow: 0.55,
    accent: 0xd8e8ee,    // 银白耳/须
    tatter: 0x4a90a8,
  },

  proportions: {
    headH: 0.14,
    tatterRest: 0,
    tatters: [           // 尾三节（破布槽；side/px/pz 未用字段只为 makeGaitParams 契约）
      { x: 0, yaw: 0, out: 0, swing: 1.0 },
      { x: 0, yaw: 0, out: 0, swing: 1.2 },
      { x: 0, yaw: 0, out: 0, swing: 1.4 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 20.6,          // (TAU·8 - 0.8) / 2.4：拍频 8Hz
    fly: {
      flapRate: 8,
      flapAmp: 0.30,     // 小振幅快速扑翼
      bobAmp: 0.05, bobRate: 4,
      weave: 0.16,       // 大 weave：轻盈飘
      pitch: 0.05,
      wingPairs: 2, dihedral: 0.15,
      pairLag: 0.9, tipLag: 1.6, tipFold: 0.40,
      legs: true, legDangle: 0.25, legBend: 0.40,
      headUp: -0.12, headScan: 0.4,
    },
  },

  build: buildSprite,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种二：土龙 earth —— 葫芦（胖球身 + 小翼，1.5Hz 吃力深扇，flyY 低 bob 大）
// ---------------------------------------------------------------------------

const EARTHGEO = new Map();

function earthGeometry(P) {
  let out = EARTHGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：葫芦身——大腹球（后下）+ 小胸球（前上），两个 ellipsoid 交叠
    const p = prims(T);
    p.ellipsoid(0.26, 0.24, 0.28, { y: -0.06, z: -0.16, rings: 6, segs: 10 });   // 大腹
    p.ellipsoid(0.16, 0.15, 0.16, { y: 0.04, z: 0.14, rings: 5, segs: 8 });      // 小胸
    out.torso = p.build();
  }
  {
    // 短颈 + 圆头 + 钝吻 + 小角 + 圆眼（坐标均为颈关节局部系，与躯干前缘搭接）
    const p = prims(T);
    p.cyl(0.055, 0.070, 0.14, { rx: Math.PI / 2 - 0.35, y: 0.02, z: 0.10, radial: 6 });
    out.neckSeg = p.build();

    const ps = prims(T);
    ps.ellipsoid(0.095, 0.085, 0.095, { y: 0.12, z: 0.20, rings: 5, segs: 8 });
    out.skull = ps.build();

    const pn = prims(T);
    pn.ellipsoid(0.055, 0.045, 0.055, { y: 0.095, z: 0.28, rings: 4, segs: 6 });
    out.snout = pn.build();

    const ph = prims(T);
    for (const s of [-1, 1]) {
      ph.cyl(0, 0.016, 0.07, { x: s * 0.045, y: 0.195, z: 0.17, rx: -0.6, radial: 5 });
    }
    out.horns = ph.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.024, 0.026, 0.018, { x: s * 0.048, y: 0.135, z: 0.265, rings: 3, segs: 6 });
    out.eyes = pe.build();
  }
  {
    // 小翼（翼载不足的喜感：相对胖身明显偏小）
    const w = wingGeometry(T, { boneL: 0.24, chord: 0.20, fingerN: 2, memT: 0.006, boneW: 0.018 });
    out.wingShBone = w.bone; out.wingShMem = w.mem;
    const w2 = wingGeometry(T, { boneL: 0.20, chord: 0.15, fingerN: 2, memT: 0.006, boneW: 0.014 });
    out.wingElBone = w2.bone; out.wingElMem = w2.mem;
    out.wingShBoneL = mirrorX(out.wingShBone); out.wingShMemL = mirrorX(out.wingShMem);
    out.wingElBoneL = mirrorX(out.wingElBone); out.wingElMemL = mirrorX(out.wingElMem);
  }
  {
    // 短粗尾三节（葫芦屁股后的小短尾）
    const p1 = prims(T); p1.cyl(0.030, 0.060, 0.20, { rx: -Math.PI / 2, z: -0.10, radial: 6 });
    const p2 = prims(T); p2.cyl(0.014, 0.032, 0.16, { rx: -Math.PI / 2, z: -0.08, radial: 6 });
    const p3 = prims(T); p3.cyl(0, 0.014, 0.12, { rx: -Math.PI / 2, z: -0.06, radial: 5 });
    out.tailSeg = [p1.build(), p2.build(), p3.build()];
  }
  {
    // 短粗腿
    const p = parts(T);
    p.box(0.055, 0.12, 0.055, { y: -0.06, top: 1.05, bottom: 0.8 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(0.045, 0.11, 0.045, { y: -0.055, top: 1.05, bottom: 0.8 });
    out.shin = ps.build();
  }
  EARTHGEO.set(P, out);
  return out;
}

export function buildEarth(spec, mats, actor) {
  const P = spec.proportions;
  const G = earthGeometry(P);
  return buildDragonRig(spec, mats, actor, G, {
    torsoW: 0.34, torsoH: 0.30, torsoD: 0.56,
    neckY: 0.06, neckZ: 0.24,
    wingY: 0.14, wingSweep: 0.12, shLen: 0.24,
    legX: 0.16, legZ: -0.14, thighL: 0.12,
    tailL: [0.20, 0.16, 0.12],
  });
}

export const EARTH = {
  id: 'earth',
  name: 'Earth（土龙）',

  speed: 1.4,
  scale: 1.1,
  height: 0.7,
  radius: 0.42,
  flyY: 1.2,             // 低飞（翼载不足，飞不高）

  palette: {
    wrap: 0xb89a5a,      // 土黄
    wrapDark: 0x7a6238,  // 棕（翼骨/腿/尾）
    deep: 0x241a10,
    eye: 0xffd88a,       // 温黄圆眼
    eyeGlow: 0.45,
    accent: 0x8a6a34,    // 小角
    tatter: 0x7a6238,
  },

  proportions: {
    headH: 0.17,
    tatterRest: 0,
    tatters: [
      { x: 0, yaw: 0, out: 0, swing: 1.0 },
      { x: 0, yaw: 0, out: 0, swing: 1.2 },
      { x: 0, yaw: 0, out: 0, swing: 1.4 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 6.16,          // (TAU·1.5 - 0.8) / 1.4：拍频 1.5Hz
    fly: {
      flapRate: 1.5,
      flapAmp: 0.65,     // 吃力深扇
      bobAmp: 0.14,      // 大 bob：扇一下颠一下
      bobRate: 1.5,
      weave: 0.05, pitch: 0.12,
      wingPairs: 2, dihedral: 0.30,
      pairLag: 0.9, tipLag: 1.9, tipFold: 0.55,
      legs: true, legDangle: 0.15, legBend: 0.30,
      headUp: -0.05, headScan: 0.3,
    },
  },

  build: buildEarth,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种三：冰龙 frost —— 枯枝（骨架龙：肋梁外露 + 烂翼膜 + 冰蓝微光克制）
// ---------------------------------------------------------------------------

const FROSTGEO = new Map();

function frostGeometry(P) {
  let out = FROSTGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：骨架读法——脊梁 + 五对肋骨环梁（骨白几何，非贴图）+ 髋骨
    const p = prims(T);
    p.cyl(0.028, 0.034, 0.62, { rx: Math.PI / 2, radial: 6 });              // 脊梁
    out.torso = p.build();

    const pr = prims(T);
    for (let k = 0; k < 5; k++) {
      const z = -0.22 + k * 0.10;
      const w = 0.15 - Math.abs(k - 2) * 0.022;                              // 中段最宽
      pr.cyl(0.012, 0.012, w * 2, { z, rz: Math.PI / 2, radial: 5 });        // 肋横梁
      pr.cyl(0.010, 0.010, 0.10, { x: -w, z, rx: 0.6, radial: 5 });          // 肋侧梁 L
      pr.cyl(0.010, 0.010, 0.10, { x: w, z, rx: 0.6, radial: 5 });           // 肋侧梁 R
    }
    out.ribs = pr.build();

    const pp = prims(T);
    pp.ellipsoid(0.09, 0.06, 0.10, { y: -0.02, z: -0.32, rings: 4, segs: 6 });   // 髋骨
    out.pelvis = pp.build();
  }
  {
    // 长颈骨（三节骨节）+ 骷髅头 + 吻 + 双角 + 冰蓝眼窝（颈关节局部系）
    const p = prims(T);
    p.cyl(0.020, 0.026, 0.13, { rx: Math.PI / 2 - 0.4, y: 0.01, z: 0.06, radial: 5 });
    p.cyl(0.016, 0.020, 0.12, { rx: Math.PI / 2 - 0.2, y: 0.06, z: 0.16, radial: 5 });
    p.cyl(0.013, 0.016, 0.10, { rx: Math.PI / 2 - 0.1, y: 0.10, z: 0.25, radial: 5 });
    out.neckSeg = p.build();

    const ps = prims(T);
    ps.ellipsoid(0.058, 0.050, 0.075, { y: 0.13, z: 0.33, rings: 5, segs: 8 });
    out.skull = ps.build();

    const pn = prims(T);
    pn.cyl(0.010, 0.030, 0.12, { rx: Math.PI / 2 + 0.1, y: 0.115, z: 0.44, radial: 6 });
    out.snout = pn.build();

    const ph = prims(T);
    for (const s of [-1, 1]) {
      ph.cyl(0, 0.014, 0.16, { x: s * 0.04, y: 0.21, z: 0.29, rx: -0.9, rz: -s * 0.5, radial: 5 });   // 后弯双角
    }
    out.horns = ph.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.018, 0.020, 0.014, { x: s * 0.032, y: 0.145, z: 0.375, rings: 3, segs: 6 });
    out.eyes = pe.build();
  }
  {
    // 翼骨（膜残缺：只有骨与指，烂膜走破布槽 ragSpec）
    const w = wingGeometry(T, { boneL: 0.48, chord: 0.30, fingerN: 3, memT: 0.004, boneW: 0.014 });
    out.wingShBone = w.bone; out.wingShMem = null;   // 根部残膜片（小）
    const ps = parts(T);
    ps.box(0.24, 0.004, 0.12, { x: 0.16, z: -0.08, ry: -0.10 });
    out.wingShMem = ps.build();
    const w2 = wingGeometry(T, { boneL: 0.40, chord: 0.22, fingerN: 2, memT: 0.004, boneW: 0.011 });
    out.wingElBone = w2.bone; out.wingElMem = null;
    out.wingShBoneL = mirrorX(out.wingShBone); out.wingShMemL = mirrorX(out.wingShMem);
    out.wingElBoneL = mirrorX(out.wingElBone);
  }
  {
    // 骨尾三节（逐节细的骨节串）
    const p1 = prims(T); p1.cyl(0.012, 0.022, 0.24, { rx: -Math.PI / 2, z: -0.12, radial: 5 });
    const p2 = prims(T); p2.cyl(0.008, 0.014, 0.20, { rx: -Math.PI / 2, z: -0.10, radial: 5 });
    const p3 = prims(T); p3.cyl(0, 0.010, 0.18, { rx: -Math.PI / 2, z: -0.09, radial: 5 });
    out.tailSeg = [p1.build(), p2.build(), p3.build()];
  }
  {
    // 细骨腿
    const p = parts(T);
    p.box(0.030, 0.14, 0.030, { y: -0.07, top: 1.05, bottom: 0.75 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(0.024, 0.13, 0.024, { y: -0.065, top: 1.05, bottom: 0.75 });
    out.shin = ps.build();
  }
  FROSTGEO.set(P, out);
  return out;
}

export function buildFrost(spec, mats, actor) {
  const P = spec.proportions;
  const G = frostGeometry(P);
  return buildDragonRig(spec, mats, actor, G, {
    torsoW: 0.20, torsoH: 0.18, torsoD: 0.62,
    neckY: 0.02, neckZ: 0.31,
    wingY: 0.08, wingSweep: 0.18, shLen: 0.48,
    legX: 0.09, legZ: -0.18, thighL: 0.14,
    tailL: [0.24, 0.20, 0.18],
    ragSpec: [
      { side: -1, px: 0.18, pz: -0.16, w: 0.08, h: 0.22, cut: 2, swing: 1.4 },
      { side: -1, px: 0.34, pz: -0.12, w: 0.07, h: 0.18, cut: 1, swing: 1.2 },
      { side: 1, px: 0.18, pz: -0.16, w: 0.08, h: 0.22, cut: 2, swing: 1.4 },
      { side: 1, px: 0.34, pz: -0.12, w: 0.07, h: 0.18, cut: 1, swing: 1.2 },
    ],
  });
}

export const FROST = {
  id: 'frost',
  name: 'Frost（冰龙）',

  speed: 2.0,
  scale: 1.0,
  height: 0.6,
  radius: 0.35,
  flyY: 1.8,

  palette: {
    wrap: 0xb8b4a8,      // 暗白骨
    wrapDark: 0x6a6862,  // 灰骨（翼骨/尾/腿）
    deep: 0x14161a,
    eye: 0x9ad4e8,       // 冰蓝微光（克制：骨架龙唯一的「活气」）
    eyeGlow: 0.5,
    accent: 0x8a9498,    // 角
    tatter: 0x8a887e,    // 烂翼膜
  },

  proportions: {
    headH: 0.14,
    tatterRest: 0.10,
    tatters: [           // 尾三节 + 烂翼膜 ×4（破布槽预算 ≤8）
      { x: 0, yaw: 0, out: 0, swing: 1.0 },
      { x: 0, yaw: 0, out: 0, swing: 1.2 },
      { x: 0, yaw: 0, out: 0, swing: 1.4 },
      { x: -0.18, yaw: 0, out: 0.05, swing: 1.4 },
      { x: -0.34, yaw: 0, out: 0.05, swing: 1.2 },
      { x: 0.18, yaw: 0, out: 0.05, swing: 1.4 },
      { x: 0.34, yaw: 0, out: 0.05, swing: 1.2 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 9.0,           // (TAU·3 - 0.8) / 2.0：拍频 3Hz
    fly: {
      flapRate: 3,
      flapAmp: 0.22,     // 偏滑翔：小振幅
      bobAmp: 0.04, bobRate: 1.5,
      weave: 0.04, pitch: 0.03,   // 姿态稳
      wingPairs: 2, dihedral: 0.10,
      pairLag: 0.9, tipLag: 1.6, tipFold: 0.35,
      legs: true, legDangle: 0.20, legBend: 0.35,
      headUp: -0.08, headScan: 0.25,
    },
  },

  build: buildFrost,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种四：黑红大龙 draco —— 王座三角（黑身红膜大翼，翼展 ≥3m，1Hz 有力深扇）
// ---------------------------------------------------------------------------

const DRACOGEO = new Map();

function dracoGeometry(P) {
  let out = DRACOGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：壮硕黑身（前胸宽，向后收窄）
    const p = prims(T);
    p.lathe([
      [0.001, -0.42], [0.10, -0.38], [0.17, -0.20], [0.20, 0.02],
      [0.18, 0.20], [0.12, 0.34], [0.001, 0.42],
    ], { rx: Math.PI / 2, segs: 10 });
    out.torso = p.build();
  }
  {
    // 粗长颈（三节渐细）+ 大头 + 长吻 + 王冠三角 + 凶眼（颈关节局部系）
    const p = prims(T);
    p.cyl(0.055, 0.075, 0.22, { rx: Math.PI / 2 - 0.5, y: 0.02, z: 0.08, radial: 7 });
    p.cyl(0.042, 0.055, 0.20, { rx: Math.PI / 2 - 0.3, y: 0.11, z: 0.25, radial: 7 });
    p.cyl(0.034, 0.042, 0.16, { rx: Math.PI / 2 - 0.15, y: 0.19, z: 0.40, radial: 6 });
    out.neckSeg = p.build();

    const ps = prims(T);
    ps.ellipsoid(0.085, 0.072, 0.105, { y: 0.24, z: 0.52, rings: 5, segs: 8 });
    out.skull = ps.build();

    const pn = prims(T);
    pn.cyl(0.020, 0.048, 0.18, { rx: Math.PI / 2 + 0.12, y: 0.21, z: 0.68, radial: 7 });
    out.snout = pn.build();

    const ph = prims(T);
    for (const s of [-1, 1]) {
      ph.cyl(0, 0.022, 0.22, { x: s * 0.06, y: 0.34, z: 0.46, rx: -1.0, rz: -s * 0.45, radial: 6 });  // 主角
      ph.cyl(0, 0.014, 0.12, { x: s * 0.10, y: 0.29, z: 0.48, rx: -0.8, rz: -s * 0.9, radial: 5 });  // 侧角
    }
    out.horns = ph.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.024, 0.020, 0.016, { x: s * 0.045, y: 0.255, z: 0.585, rings: 3, segs: 6 });
    out.eyes = pe.build();
  }
  {
    // 大膜翼（翼展 ≥3m：肩段 0.75 + 肘段 0.75，4 指撑膜）
    const w = wingGeometry(T, { boneL: 0.75, chord: 0.55, fingerN: 3, memT: 0.006, boneW: 0.030 });
    out.wingShBone = w.bone; out.wingShMem = w.mem;
    const w2 = wingGeometry(T, { boneL: 0.72, chord: 0.42, fingerN: 3, memT: 0.006, boneW: 0.024 });
    out.wingElBone = w2.bone; out.wingElMem = w2.mem;
    out.wingShBoneL = mirrorX(out.wingShBone); out.wingShMemL = mirrorX(out.wingShMem);
    out.wingElBoneL = mirrorX(out.wingElBone); out.wingElMemL = mirrorX(out.wingElMem);
  }
  {
    // 粗长尾三节（三角剪影的底边）
    const p1 = prims(T); p1.cyl(0.045, 0.075, 0.42, { rx: -Math.PI / 2, z: -0.21, radial: 7 });
    const p2 = prims(T); p2.cyl(0.024, 0.048, 0.36, { rx: -Math.PI / 2, z: -0.18, radial: 7 });
    const p3 = prims(T); p3.cyl(0.035, 0.024, 0.30, { rx: -Math.PI / 2, z: -0.15, radial: 6 });   // 尾梢矛尖
    out.tailSeg = [p1.build(), p2.build(), p3.build()];
  }
  {
    // 粗腿
    const p = parts(T);
    p.box(0.075, 0.20, 0.075, { y: -0.10, top: 1.05, bottom: 0.8 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(0.060, 0.18, 0.060, { y: -0.09, top: 1.05, bottom: 0.8 });
    out.shin = ps.build();
  }
  DRACOGEO.set(P, out);
  return out;
}

export function buildDraco(spec, mats, actor) {
  const P = spec.proportions;
  const G = dracoGeometry(P);
  return buildDragonRig(spec, mats, actor, G, {
    torsoW: 0.40, torsoH: 0.36, torsoD: 0.84,
    neckY: 0.08, neckZ: 0.40,
    wingY: 0.14, wingSweep: 0.20, shLen: 0.75,
    legX: 0.16, legZ: -0.22, thighL: 0.20,
    tailL: [0.42, 0.36, 0.30],
  });
}

export const DRACO = {
  id: 'draco',
  name: 'Draco（黑红大龙）',

  speed: 2.0,
  scale: 1.35,
  height: 1.1,
  radius: 0.55,
  flyY: 2.4,

  palette: {
    wrap: 0x1a1516,      // 黑身
    wrapDark: 0x2c2224,  // 深灰黑（翼骨/腿/尾）
    deep: 0x0c0a0c,
    eye: 0xff3020,       // 红瞳
    eyeGlow: 0.7,
    accent: 0x8a1a12,    // 红膜翼
    tatter: 0x2c2224,
  },

  proportions: {
    headH: 0.20,
    tatterRest: 0,
    tatters: [
      { x: 0, yaw: 0, out: 0, swing: 1.0 },
      { x: 0, yaw: 0, out: 0, swing: 1.2 },
      { x: 0, yaw: 0, out: 0, swing: 1.4 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 2.74,          // (TAU·1 - 0.8) / 2.0：拍频 1Hz
    fly: {
      flapRate: 1,
      flapAmp: 0.60,     // 有力深扇
      bobAmp: 0.06, bobRate: 1,
      weave: 0.05, pitch: 0.08,   // 姿态稳
      wingPairs: 2, dihedral: 0.15,
      pairLag: 0.9, tipLag: 1.9, tipFold: 0.55,
      legs: true, legDangle: 0.30, legBend: 0.50,
      headUp: -0.10, headScan: 0.3,
    },
  },

  build: buildDraco,
  animate: animateFlyer,
};
