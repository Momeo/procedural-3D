/**
 * 飞行物种系列：尸鹫 carrion / 瘟蛾 moth / 毒蜂 hornet / 浮游机 hoverdrone。
 * 纯代码零资产，四剪影词互不冲突：大字（翼展）/ 灯笼（肥腹四翼）/ 飞镖
 * （蜂腰毒刺）/ 碟眼（悬浮飞碟 + 大眼 + 自旋环）。
 *
 * 借与自写的分界（范式照 crawler_true.js / robots.js 顶部契约）：
 *   - 借：parts()/tornStrip（core/anatomy.js）、contactShadow（core/contact.js）、
 *     WRAP_TILES（core/wraps.js）、prims（pipeline/prims.js）、材质工厂
 *     （zombies_ex.js 的 makeZombieMaterialsFrom / robots.js 的 makeRobotMaterials）。
 *   - 自写：四个飞行 rig（骨架层级对齐人形契约：group→body→hips→torso→neck，
 *     翅膀注册为 arms——carrion 一对翼占 arms[0..1]（SH/EL 槽），moth/hornet
 *     两对翼占 arms[0..3]（SH/EL + ARM2/EL2 槽），hoverdrone 无翼）+
 *     animateFlyer（与 pipeline/gait.js 的 fillFlyJoints 逐行对应）。
 *
 * 飞行高度契约（spec.flyY）：
 *   hips.position.y = spec.flyY——与 crawler 的 rideHeight 同款，bake 保留进
 *   几何（hitboxes/粗筛球随之抬到飞行高度，射击判定零改动）；instanceMatrix
 *   仍是 y=0，horde/shooter 排矩阵路径不动。接触影 blob 保持贴地 y≈0，
 *   随 flyY 放大并变淡（克隆共享材质后调 opacity/scale，不动 core）。
 *
 * 烘焙铁律：翼的静态外展角（dihedral）不写 build，由 animateFlyer/fillFlyJoints
 * 每帧还原（bake 归零注册关节）；mount 只扛后掠朝向。自旋环（hoverdrone）
 * 不做注册关节——破布槽的 tspec.spin 通道承载（yaw = p·spin）。
 *
 * 爆头可达铁律：四种的头/眼传感器的盒心都探出躯干盒之外（前伸），
 * 触须/尾刺/桅杆等细长装饰件一律 mesh.userData.noHit。
 */

import * as THREE from 'three';
import { parts, tornStrip } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES } from '../core/wraps.js';
import { prims } from '../prims.js';

// ---------------------------------------------------------------------------
// 共享小件
// ---------------------------------------------------------------------------

function mkActorTools(mats, actor) {
  const meshes = [];
  let triangles = 0;
  const add = (parent, g, mat, region, noHit) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    m.userData.region = region;
    if (noHit) m.userData.noHit = true;
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    triangles += g.attributes.position.count / 3;
    return m;
  };
  return { meshes, add, count: () => triangles };
}

/** 接触影：见 flyBlob。镜像工具：+x 单侧几何 → -x 镜像（顶点/法线取反 +
 * 逐三角形交换 v1/v2 翻回绕向，负 scale 会让面片背对相机，不能用）。 */
export function mirrorX(src) {
  const g = src.clone();
  const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
  for (let i = 0; i < pa.length; i += 3) { pa[i] = -pa[i]; na[i] = -na[i]; }
  for (let v = 0; v + 2 < pa.length / 3; v += 3) {
    for (let c = 0; c < 3; c++) {
      let t = pa[(v + 1) * 3 + c]; pa[(v + 1) * 3 + c] = pa[(v + 2) * 3 + c]; pa[(v + 2) * 3 + c] = t;
      t = na[(v + 1) * 3 + c]; na[(v + 1) * 3 + c] = na[(v + 2) * 3 + c]; na[(v + 2) * 3 + c] = t;
    }
    for (let c = 0; c < 2; c++) {
      const t = ua[(v + 1) * 2 + c]; ua[(v + 1) * 2 + c] = ua[(v + 2) * 2 + c]; ua[(v + 2) * 2 + c] = t;
    }
  }
  return g;
}

// dragons.js 复用（导出不影响本文件内部引用）
export { mkActorTools, flyBlob };

/** 飞行种接触影：贴地 y≈0 不动，随 flyY 放大并变淡（克隆共享 MAT，不动 core）。 */
function flyBlob(spec, baseR) {
  const k = 1 + (spec.flyY || 0) * 0.25;
  const blob = contactShadow(baseR * k);
  blob.material = blob.material.clone();
  blob.material.opacity = Math.max(0.3, 1 - (spec.flyY || 0) * 0.28);
  blob.position.y = 0.02;
  return blob;
}

// ---------------------------------------------------------------------------
// 走姿：animateFlyer —— 与 pipeline/gait.js 的 fillFlyJoints 逐行对应
// （相位时钟由页面 strideRate 推进：飞行种 rig 不声明 stepSpan，走
//   (0.8+speed·gait.rate) 常量支，gait.rate 按巡航速度 = flapRate·TAU 调好）
// ---------------------------------------------------------------------------

export function animateFlyer(rig, spec, s) {
  const g = spec.gait;
  const fly = g.fly || {};
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const flapDrive = 0.55 + 0.45 * drive;     // 悬停也保持过半振幅
  const clockHz = fly.flapRate || 0.9;       // flapRate=0（悬浮种）的时钟兜底
  const bobP = p * (fly.bobRate || 1) / clockHz;
  const wu = s.windup || 0, stk = s.strike || 0, stg = s.stagger || 0;
  const sRoll = s.staggerRoll || 0, sPitch = s.staggerPitch || 0;
  const hk = s.hit || 0;

  // 翅膀：rig.arms[0..1] 第 0 对 / arms[2..3] 第 1 对；flapAmp=0 静默
  const amp = (fly.flapAmp || 0) * flapDrive;
  rig.arms.forEach((arm, ai) => {
    const pair = ai >> 1;
    if (pair >= (fly.wingPairs || 0) || amp === 0) return;
    const side = arm.side;
    const lag = pair * (fly.pairLag ?? 0.9);
    let shZ = side * ((fly.dihedral || 0) + Math.sin(p - lag) * amp);
    const elZ = side * Math.sin(p - lag - (fly.tipLag ?? 1.9)) * amp * (fly.tipFold ?? 0.55);
    if (wu > 0) shZ += side * wu * 0.5;              // 仰身张翼蓄力
    else if (stk > 0) shZ -= side * (1 - stk) * 0.6; // 扑翼下压
    arm.shoulder.rotation.set(0, 0, shZ);
    arm.elbow.rotation.set(0, 0, elZ);
  });

  // 双腿（carrion 垂爪）：垂落微摆，无步态周期
  if (fly.legs) {
    rig.legs.forEach((leg, li) => {
      const off = li === 0 ? 0 : Math.PI;
      leg.hip.rotation.set(fly.legDangle + Math.sin(bobP * 0.5 + off) * 0.06, 0, 0);
      leg.knee.rotation.set(fly.legBend + Math.sin(bobP * 0.4 + off) * 0.05, 0, 0);
    });
  }

  // 身体：前进俯仰 + weave 横摆；攻击 = windup 仰身 → strike 前扑下压
  const wv = fly.weave || 0;
  let torsoX = (fly.pitch || 0) + Math.sin(bobP * 0.5) * 0.03 * drive;
  if (wu > 0) torsoX -= wu * 0.35;
  else if (stk > 0) torsoX += (1 - stk) * 0.45;
  torsoX += sPitch * 1.2;
  rig.hips.rotation.set(sPitch * 0.5, Math.sin(p * 0.31) * wv * 0.8, sRoll * 0.5);
  rig.torso.rotation.set(torsoX, Math.sin(p * 0.23) * wv * 0.6,
    Math.sin(bobP) * wv + sRoll * 1.2);
  rig.neck.rotation.set((fly.headUp ?? -0.15) + hk * 0.45,
    Math.sin(p * 0.47) * (fly.headScan ?? 0.3), 0);
  rig.body.position.y = Math.sin(bobP) * (fly.bobAmp || 0)
    + wu * 0.05 - (stk > 0 ? (1 - stk) * 0.12 : 0) - stg * 0.05;
  rig.body.rotation.set(0, 0, 0);

  // 破布槽：spin = 自旋环（hoverdrone 稳定环）；其余 = 烂翼膜抖动
  for (const t of rig.tatters) {
    if (t.spin) { t.pivot.rotation.set(0, p * t.spin, 0); continue; }
    const lag = Math.sin(p * 0.5 - 0.8 + t.phase) * t.swing;
    t.pivot.rotation.x = lag * 0.25 + (spec.proportions.tatterRest || 0);
    t.pivot.rotation.z = t.restZ + Math.sin(p * 0.35 + t.phase) * 0.18;
  }
}

// ---------------------------------------------------------------------------
// 物种一：尸鹫 carrion —— 大字（翼展 ~2.3m，慢扇大振幅，烂翼膜 + 秃头垂颈 + 垂爪）
// ---------------------------------------------------------------------------

const CARRIONGEO = new Map();

function carrionGeometry(P) {
  let out = CARRIONGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 躯干：微前倾的纺锤身（wrap 腐羽）+ 尾羽三片（wrapDark，向后下展开）
    const p = parts(T);
    p.box(P.torsoW, P.torsoH, P.torsoD, { z: 0.02, top: 0.95, bottom: 1.0 });
    out.torso = p.build();

    const pt = parts(T);
    for (const k of [-1, 0, 1]) {
      pt.box(0.07, 0.016, 0.30, { x: k * 0.06, y: -0.02, z: -P.torsoD * 0.5 - 0.12, ry: k * 0.28, rx: 0.10 });
    }
    out.tail = pt.build();
  }
  {
    // 头颈（秃鹫长脖垂头是标志）：颈节斜向前下 + 小 skull 垂在颈端 +
    // 钩喙两段 + 浊眼；头盒心探出躯干盒前缘（爆头可达铁律）
    const p = prims(T);
    p.ellipsoid(0.075, 0.068, 0.085, { z: 0.26, y: -0.17, rings: 5, segs: 8 });
    out.skull = p.build();

    const pn = parts(T);
    pn.box(0.085, 0.085, 0.24, { z: 0.11, y: -0.07, rx: 0.42, chamfer: 0.008 });   // 长颈段
    out.neckSeg = pn.build();

    const pb = prims(T);
    pb.cyl(0.012, 0.034, 0.12, { rx: Math.PI / 2 + 0.55, y: -0.195, z: 0.345, radial: 6 });   // 喙上前伸下压
    pb.cyl(0.0, 0.013, 0.07, { rx: Math.PI / 2 + 1.30, y: -0.235, z: 0.395, radial: 6 });     // 喙尖回钩
    out.beak = pb.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.016, 0.014, 0.012, { x: s * 0.048, y: -0.145, z: 0.305, rings: 3, segs: 6 });
    out.eyes = pe.build();
  }
  {
    // 翼（r3：正视/45° 锐度找回——更薄、展弦比更夸张、taper 更极端、翼指更分明；
    // 保留 r2 治好的侧视长颈垂头）：内段两级 + 外段两级 + 五根分明翼指（wrapDark）
    const p = parts(T);
    p.box(0.30, 0.014, 0.40, { x: 0.15, z: -0.03 });                    // 翼根：更长更薄
    p.box(0.26, 0.012, 0.24, { x: 0.40, z: -0.08, ry: -0.14 });         // 中段急收
    out.wingIn = p.build();

    const po = parts(T);
    po.box(0.28, 0.010, 0.15, { x: 0.14, z: -0.05, ry: -0.18 });        // 外段薄刃
    po.box(0.26, 0.008, 0.09, { x: 0.36, z: -0.12, ry: -0.28 });        // 翼尖极窄
    out.wingOut = po.build();

    const pf = parts(T);
    for (let k = 0; k < 5; k++) {
      pf.box(0.28, 0.008, 0.034, { x: 0.50 + k * 0.045, z: -0.06 - k * 0.055, ry: -0.26 - k * 0.16 });
    }
    out.feathers = pf.build();
    // 左翼镜像件（绕向已翻正；几何缓存两份）
    out.wingInL = mirrorX(out.wingIn);
    out.wingOutL = mirrorX(out.wingOut);
    out.feathersL = mirrorX(out.feathers);
  }
  {
    // 垂爪：小腿 + 三趾利爪（accent 骨白）
    const p = parts(T);
    p.box(0.055, 0.16, 0.06, { y: -0.08, top: 1.05, bottom: 0.8 });
    out.thigh = p.build();

    const ps = parts(T);
    ps.box(0.045, 0.15, 0.045, { y: -0.075, top: 1.05, bottom: 0.8 });
    out.shin = ps.build();

    const pc = prims(T);
    for (const k of [-1, 0, 1]) {
      pc.cyl(0, 0.011, 0.075, { rx: Math.PI / 2 - 0.25, x: k * 0.026, y: -0.155, z: 0.035, radial: 5 });
    }
    out.claws = pc.build();
  }
  CARRIONGEO.set(P, out);
  return out;
}

export function buildCarrion(spec, mats, actor) {
  const P = spec.proportions;
  const G = carrionGeometry(P);
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
  add(torso, G.tail, mats.wrapDark, 'body').scale.set(jw, 1, 1);

  // 头：长颈垂头是秃鹫标志（抬起角是动画值）；头盒心探出躯干盒前缘（爆头可达铁律）
  const neck = new THREE.Group();
  neck.position.set(0, 0.10, P.torsoD * 0.5);
  torso.add(neck);
  add(neck, G.neckSeg, mats.wrapDark, 'head');
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.beak, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // 翼一对（arms[0..1]）：mount 扛后掠朝向，静态外展角由动画每帧还原
  const legs = [];
  const arms = [];
  const tatters = [];
  for (const side of [-1, 1]) {
    const mountA = new THREE.Group();
    mountA.position.set(side * P.torsoW * 0.5 * jw, 0.10, 0.05);
    mountA.rotation.y = -side * 0.18;          // 后掠加大（ taper 翼形配套）
    torso.add(mountA);
    const shoulder = new THREE.Group();
    mountA.add(shoulder);
    add(shoulder, side > 0 ? G.wingIn : G.wingInL, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.x = side * 0.50;
    shoulder.add(elbow);
    add(elbow, side > 0 ? G.wingOut : G.wingOutL, mats.wrap, 'body');
    add(elbow, side > 0 ? G.feathers : G.feathersL, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });

    // 烂翼膜：破布条挂翼骨（elbow），tatter 关节槽承载，随翼拍动
    for (const t of P.tatters.filter(tt => tt.side === side)) {
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

    // 垂爪（legs[0..1]）：利爪垂落，飞行中微摆
    const mountL = new THREE.Group();
    mountL.position.set(side * 0.09, -P.torsoH * 0.45, -0.10);
    torso.add(mountL);
    const hip = new THREE.Group();
    mountL.add(hip);
    add(hip, G.thigh, mats.wrapDark, 'body');
    const knee = new THREE.Group();
    knee.position.y = -0.16;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    add(knee, G.claws, mats.accent, 'body');
    legs.push({ hip, knee, side });
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.5) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters, meshes,
    triangles: count(), asym, lead: 1, blob,
    // 不声明 stepSpan：stepRate 走 (0.8+speed·rate) 常量支 = 拍翅时钟
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const CARRION = {
  id: 'carrion',
  name: 'Carrion（尸鹫）',

  speed: 2.2,
  scale: 1.0,
  height: 0.9,           // 体高参考（shooter 受击落点归一用），飞行高度在 flyY
  radius: 0.5,
  flyY: 2.2,             // 体底离地间隙要压过垂爪长度（怪海高机位下也读得出悬空）

  palette: {
    wrap: 0x6d725a,      // 腐绿羽（zombie 同族）
    wrapDark: 0x4c443a,  // 暗褐翼指/垂爪
    deep: 0x171512,
    eye: 0xd8cf9a,       // 浊黄死眼
    eyeGlow: 0.5,
    accent: 0x8a7a5a,    // 骨白利爪
    tatter: 0x5a5044,    // 烂翼膜
  },

  proportions: {
    torsoW: 0.30, torsoH: 0.27, torsoD: 0.60,   // r3：瘦身——「翼大肉少」比例
    headH: 0.15,                    // index.html 黄点探针契约字段
    tatterRest: 0.15,
    tatters: [                       // 烂翼膜 ×4（两翼各二，挂 elbow 随翼拍动）
      { side: -1, px: 0.15, pz: -0.17, w: 0.09, h: 0.24, cut: 2, swing: 1.4, yaw: 0, out: 0.05, x: -0.15 },
      { side: -1, px: 0.33, pz: -0.14, w: 0.08, h: 0.20, cut: 1, swing: 1.2, yaw: 0, out: 0.05, x: -0.33 },
      { side: 1, px: 0.15, pz: -0.17, w: 0.09, h: 0.24, cut: 2, swing: 1.4, yaw: 0, out: 0.05, x: 0.15 },
      { side: 1, px: 0.33, pz: -0.14, w: 0.08, h: 0.20, cut: 1, swing: 1.2, yaw: 0, out: 0.05, x: 0.33 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 3.06,          // (TAU·1.2 - 0.8) / 2.2：巡航速度下相位角速度 = 拍频 1.2Hz·TAU
    fly: {
      flapRate: 1.2,     // 慢扇
      flapAmp: 0.55,     // 大振幅
      bobAmp: 0.10, bobRate: 1.2,
      weave: 0.06, pitch: 0.10,
      wingPairs: 1, dihedral: 0.18,   // V 形加大：侧视两翼错开可读（修型轮）
      tipLag: 1.9,       // 翼尖滞后翼根 ~0.3 拍
      tipFold: 0.60,     // 大振幅肘部折叠感
      legs: true, legDangle: 0.30, legBend: 0.55,
      headUp: -0.10, headScan: 0.35,
    },
  },

  build: buildCarrion,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种二：瘟蛾 moth —— 灯笼（肥腹下垂 + 四翼高频扑棱 + 毒斑翼 + 触角 noHit）
// ---------------------------------------------------------------------------

const MOTHGEO = new Map();

function mothGeometry(P) {
  let out = MOTHGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 肥腹（hips）：下垂后拖的大椭球——「灯笼」剪影的灯罩（修型轮加肥一档）
    const p = prims(T);
    p.ellipsoid(P.abdR, P.abdR * 0.92, P.abdR * 1.45, { y: -0.06, z: -P.abdR * 1.3, rings: 6, segs: 10 });
    out.abdomen = p.build();
  }
  {
    // 胸（torso）：小球
    const p = prims(T);
    p.ellipsoid(P.thoR, P.thoR * 0.95, P.thoR * 1.2, { rings: 5, segs: 8 });
    out.thorax = p.build();
  }
  {
    // 头：小颅 + 两瓣大眼 + 双触角（accent，noHit）
    const p = prims(T);
    p.ellipsoid(0.080, 0.072, 0.075, { z: 0.05, rings: 5, segs: 8 });
    out.skull = p.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.038, 0.048, 0.032, { x: s * 0.052, y: 0.015, z: 0.095, rings: 4, segs: 6 });
    out.eyes = pe.build();

    const pa = prims(T);
    for (const s of [-1, 1]) {
      pa.cyl(0, 0.007, 0.15, { x: s * 0.030, y: 0.075, z: 0.085, rx: -0.75, rz: -s * 0.55, radial: 5 });
    }
    out.antennae = pa.build();
  }
  {
    // 翼两对（修型轮加宽加大——蛾翼相对身体面积很大）：前对大（wrap + 毒斑
    // accent 菱块，宽弦 + 圆收翼尖）/ 后对小一号（wrapDark）
    const p = parts(T);
    p.box(0.46, 0.012, 0.32, { x: 0.23, z: -0.06 });                    // 宽弦主翼面
    p.box(0.20, 0.012, 0.24, { x: 0.50, z: -0.12, ry: -0.30 });         // 圆收翼尖
    out.wingFront = p.build();

    const ps = parts(T);
    for (const k of [[0.28, -0.04], [0.42, -0.12]]) {
      ps.box(0.055, 0.016, 0.055, { x: k[0], y: 0.004, z: k[1], ry: 0.6 });
    }
    out.spots = ps.build();

    const pb = parts(T);
    pb.box(0.32, 0.012, 0.22, { x: 0.16, z: -0.06 });
    out.wingBack = pb.build();
    // 左翼镜像件
    out.wingFrontL = mirrorX(out.wingFront);
    out.spotsL = mirrorX(out.spots);
    out.wingBackL = mirrorX(out.wingBack);
  }
  MOTHGEO.set(P, out);
  return out;
}

export function buildMoth(spec, mats, actor) {
  const P = spec.proportions;
  const G = mothGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const jw = 0.94 + R() * 0.12;
  add(hips, G.abdomen, mats.wrap, 'body');                 // 肥腹挂 hips（part hips）
  add(torso, G.thorax, mats.wrap, 'body').scale.set(jw, 1, 1);

  // 头：探出胸球前缘；触角 noHit
  const neck = new THREE.Group();
  neck.position.set(0, 0.04, P.thoR * 1.35);
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.eyes, mats.eye, 'head');
  add(neck, G.antennae, mats.accent, 'head', true);

  // 四翼 = arms[0..3]（前对 SH/EL 槽，后对 ARM2/EL2 槽）。注册顺序契约
  // （bake.js jmap）：arms[0/1] = 前对 L/R，arms[2/3] = 后对 L/R——对优先、
  // 侧在内，别按侧循环连推（会错槽）。
  const arms = [];
  for (const pair of [0, 1]) {
    for (const side of [-1, 1]) {
      const front = pair === 0;
      const mount = new THREE.Group();
      mount.position.set(side * P.thoR * (front ? 0.8 : 0.7), front ? 0.07 : 0.05, front ? 0.05 : -0.09);
      mount.rotation.y = -side * (front ? 0.16 : 0.24);   // 后掠（修型轮加大，侧视留翼面）
      torso.add(mount);
      const shoulder = new THREE.Group();
      mount.add(shoulder);
      if (front) {
        add(shoulder, side > 0 ? G.wingFront : G.wingFrontL, mats.wrap, 'body');
        add(shoulder, side > 0 ? G.spots : G.spotsL, mats.accent, 'body', true);   // 毒斑贴面 noHit
      } else {
        add(shoulder, side > 0 ? G.wingBack : G.wingBackL, mats.wrapDark, 'body');
      }
      const elbow = new THREE.Group();
      elbow.position.x = side * (front ? 0.30 : 0.20);
      shoulder.add(elbow);
      arms.push({ shoulder, elbow, side });
    }
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.35) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs: [], arms, tatters: [], meshes,
    triangles: count(), asym, lead: 1, blob,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const MOTH = {
  id: 'moth',
  name: 'Moth（瘟蛾）',

  speed: 1.7,
  scale: 1.0,
  height: 0.6,
  radius: 0.35,
  flyY: 1.8,

  palette: {
    wrap: 0x9a8f6a,      // 病黄绿绒
    wrapDark: 0x6a5f4a,  // 后翼暗绒
    deep: 0x1a1512,
    eye: 0xe8b23a,       // 灯笼黄大眼
    eyeGlow: 0.6,
    accent: 0x6a3a7a,    // 毒斑紫
    tatter: 0x6a5f4a,
  },

  proportions: {
    abdR: 0.175, thoR: 0.125,   // 修型轮：更毛茸圆胖（腹部/胸部各加一档）
    headH: 0.15,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'fly',
    rate: 21.7,          // (TAU·6 - 0.8) / 1.7：拍频 6Hz
    fly: {
      flapRate: 6,
      flapAmp: 0.85,     // 扑棱：大振幅高频
      bobAmp: 0.05, bobRate: 3,
      weave: 0.10, pitch: 0.04,
      wingPairs: 2, dihedral: -0.15,  // 四翼略下垂（修型轮：侧视也有翼面可读）
      pairLag: 0.9,      // 后对错前半拍，四翼扑棱读法
      tipLag: 1.4, tipFold: 0.40,
      headUp: -0.05, headScan: 0.4,
    },
  },

  build: buildMoth,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种三：毒蜂 hornet —— 飞镖（蜂腰 + 黄黑警戒腹节 + 毒刺 + 高频小振幅）
// ---------------------------------------------------------------------------

const HORNETGEO = new Map();

function hornetGeometry(P) {
  let out = HORNETGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 胸（torso）：小黄球
    const p = prims(T);
    p.ellipsoid(0.085, 0.082, 0.105, { z: 0.04, rings: 5, segs: 8 });
    out.thorax = p.build();
  }
  {
    // 头（deep 黑）+ 复眼两瓣（eye 暗红）+ 小颚（noHit）
    const p = prims(T);
    p.ellipsoid(0.068, 0.060, 0.062, { z: 0.03, rings: 5, segs: 8 });
    out.skull = p.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.026, 0.034, 0.024, { x: s * 0.040, y: 0.018, z: 0.062, rings: 4, segs: 6 });
    out.eyes = pe.build();

    const pm = prims(T);
    for (const s of [-1, 1]) {
      pm.cyl(0, 0.008, 0.045, { x: s * 0.020, y: -0.045, z: 0.075, rx: Math.PI / 2 + 0.6, radial: 5 });
    }
    out.mandibles = pm.build();
  }
  {
    // 蜂腰（hips）：细到剪影可读的连接杆（修型轮再抽细拉长）
    const p = prims(T);
    p.cyl(0.011, 0.015, 0.10, { rx: Math.PI / 2, z: -0.10, radial: 6 });
    out.waist = p.build();
  }
  {
    // 警戒腹节（hips）：四节黄黑相间锥台，半径胖瘦交替让剪影侧有节奏
    // （修型轮：鼓-收-鼓-收），毒刺（deep，探出但标 noHit——细长件不撑腹盒）
    const p = prims(T);
    const SEGS = [
      [0.048, 0.070], [0.070, 0.056], [0.056, 0.074], [0.074, 0.020],
    ];
    out.abdA = null; out.abdB = null;
    const pa = prims(T);   // 黄节（1/3）
    const pb = prims(T);   // 黑节（2/4）
    SEGS.forEach(([r0, r1], k) => {
      const dst = k % 2 === 0 ? pa : pb;
      dst.cyl(r1, r0, 0.062, { rx: -Math.PI / 2, z: -0.155 - k * 0.058, radial: 8 });
    });
    out.abdA = pa.build();
    out.abdB = pb.build();

    const ps = prims(T);
    ps.cyl(0, 0.013, 0.095, { rx: -Math.PI / 2, z: -0.425, radial: 6 });
    out.sting = ps.build();
  }
  {
    // 翼两对（r3：回滚 r1 的大尺寸量级——PUNCHIER 判 r2 缩小变碎是倒退——
    // 面积/高度不小于 r1，只做「形」的改良：矩形板 → 后掠叶片；顶视两片大翼
    // 主导，不许读成放射腿）：根段宽 + 尖段后掠收窄，前对明显大于后对
    const p = parts(T);
    p.box(0.20, 0.010, 0.11, { x: 0.10, z: -0.02, ry: -0.10 });         // 根段（≥r1 弦宽）
    p.box(0.16, 0.010, 0.075, { x: 0.27, z: -0.06, ry: -0.35 });        // 尖段后掠叶片
    out.wingFront = p.build();

    const pb = parts(T);
    pb.box(0.17, 0.010, 0.08, { x: 0.085, z: -0.04, ry: -0.30 });       // 后对（≈r1 尺寸）
    out.wingBack = pb.build();
    // 左翼镜像件
    out.wingFrontL = mirrorX(out.wingFront);
    out.wingBackL = mirrorX(out.wingBack);
  }
  HORNETGEO.set(P, out);
  return out;
}

export function buildHornet(spec, mats, actor) {
  const P = spec.proportions;
  const G = hornetGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  add(torso, G.thorax, mats.wrap, 'body');
  add(hips, G.waist, mats.deep, 'body');
  add(hips, G.abdA, mats.wrap, 'body');        // 黄节
  add(hips, G.abdB, mats.deep, 'body');        // 黑节
  add(hips, G.sting, mats.deep, 'body', true); // 毒刺：细长件 noHit

  const neck = new THREE.Group();
  neck.position.set(0, 0.01, 0.155);
  torso.add(neck);
  add(neck, G.skull, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');
  add(neck, G.mandibles, mats.deep, 'head', true);

  // 注册顺序契约同 moth：arms[0/1] = 前对 L/R，arms[2/3] = 后对 L/R
  const arms = [];
  for (const pair of [0, 1]) {
    for (const side of [-1, 1]) {
      const front = pair === 0;
      const mount = new THREE.Group();
      mount.position.set(side * (front ? 0.06 : 0.05), front ? 0.07 : 0.06, front ? 0.075 : -0.01);
      mount.rotation.y = -side * (front ? 0.25 : 0.35);   // 后掠加大（r3：顶视读翼不读腿）
      torso.add(mount);
      const shoulder = new THREE.Group();
      mount.add(shoulder);
      add(shoulder,
        front ? (side > 0 ? G.wingFront : G.wingFrontL) : (side > 0 ? G.wingBack : G.wingBackL),
        mats.wrapDark, 'body');
      const elbow = new THREE.Group();
      elbow.position.x = side * (front ? 0.18 : 0.12);
      shoulder.add(elbow);
      arms.push({ shoulder, elbow, side });
    }
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.22) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs: [], arms, tatters: [], meshes,
    triangles: count(), asym, lead: 1, blob,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const HORNET = {
  id: 'hornet',
  name: 'Hornet（毒蜂）',

  speed: 2.8,
  scale: 1.0,
  height: 0.5,
  radius: 0.22,
  flyY: 1.9,

  palette: {
    wrap: 0xc9a52a,      // 警戒黄
    wrapDark: 0x3a2e1a,  // 翼膜烟褐
    deep: 0x14100c,      // 警戒黑
    eye: 0xd83a20,       // 暗红复眼
    eyeGlow: 0.5,
    accent: 0x8a6a34,
    tatter: 0x3a2e1a,
  },

  proportions: {
    headH: 0.12,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'fly',
    rate: 26.6,          // (TAU·12 - 0.8) / 2.8：拍频 12Hz
    fly: {
      flapRate: 12,      // 高频
      flapAmp: 0.38,     // 小振幅
      bobAmp: 0.03, bobRate: 6,
      weave: 0.12, pitch: 0.14,
      wingPairs: 2, dihedral: 0.35,
      pairLag: 0.5, tipLag: 1.2, tipFold: 0.30,
      headUp: -0.10, headScan: 0.5,
    },
  },

  build: buildHornet,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种四：浮游机 hoverdrone —— 碟眼（无翼悬浮 + 大眼传感器 + 自旋稳定环）
// 机器人系材质（makeRobotMaterials 经 createRobot 工厂）。自旋环走破布槽的
// tspec.spin 通道（fillFlyJoints/animateFlyer 双端同款），不占注册关节。
// ---------------------------------------------------------------------------

const DRONEGEO = new Map();

function droneGeometry(P) {
  let out = DRONEGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 碟身（torso）：lathe 飞碟轮廓
    const p = prims(T);
    p.lathe([
      [0.001, 0.035], [0.10, 0.035], [0.20, 0.005], [0.26, -0.025],
      [0.20, -0.055], [0.10, -0.065], [0.001, -0.050],
    ], { segs: 12 });
    out.disc = p.build();
  }
  {
    // 大眼传感器（neck）：deep 基座 + 发光大眼（eye 半球）；探出碟缘前（爆头可达）
    const p = parts(T);
    p.box(0.12, 0.09, 0.09, { z: 0.01, chamfer: 0.010 });
    out.eyeBase = p.build();

    const pe = prims(T);
    pe.ellipsoid(0.072, 0.072, 0.045, { z: 0.075, rings: 5, segs: 10 });
    out.eye = pe.build();
  }
  {
    // 底部三喷口（eye 槽发光，克制）+ 顶部小桅杆（accent，noHit）+ 警示灯（eye）
    const p = prims(T);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      p.cyl(0.020, 0.042, 0.06, {
        x: Math.cos(a) * 0.15, y: -0.085, z: Math.sin(a) * 0.15,
        rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35, radial: 6,
      });
    }
    out.nozzles = p.build();

    const pm = prims(T);
    pm.cyl(0, 0.008, 0.10, { y: 0.085, radial: 5 });
    out.mast = pm.build();

    const pb = parts(T);
    pb.box(0.030, 0.022, 0.030, { y: 0.045, z: -0.10, chamfer: 0.005 });
    out.beacon = pb.build();
  }
  {
    // 自旋稳定环（破布槽 spin 通道）：lathe 环带 + 四片稳定鳍（accent）
    const p = prims(T);
    p.lathe([[0.30, -0.018], [0.35, -0.018], [0.35, 0.018], [0.30, 0.018], [0.30, -0.018]], { segs: 12 });
    out.ring = p.build();

    const pf = parts(T);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      pf.box(0.055, 0.050, 0.014, { x: Math.cos(a) * 0.325, z: Math.sin(a) * 0.325, ry: -a, chamfer: 0.006 });
    }
    out.fins = pf.build();
  }
  DRONEGEO.set(P, out);
  return out;
}

export function buildHoverdrone(spec, mats, actor) {
  const P = spec.proportions;
  const G = droneGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  add(torso, G.disc, mats.wrap, 'body');
  add(torso, G.nozzles, mats.eye, 'body');       // 喷口发光（eyeGlow 定档克制）
  add(torso, G.beacon, mats.eye, 'body');
  add(torso, G.mast, mats.accent, 'body', true); // 桅杆：细长件 noHit

  // 大眼传感器：探出碟缘（头盒心在躯干盒外，爆头可达铁律）
  const neck = new THREE.Group();
  neck.position.set(0, 0.0, 0.27);
  torso.add(neck);
  add(neck, G.eyeBase, mats.deep, 'head');
  add(neck, G.eye, mats.eye, 'head');

  // 自旋稳定环：破布槽 spin 通道（双端同款公式），不做注册关节
  const tatters = [];
  {
    const pivot = new THREE.Group();
    torso.add(pivot);
    add(pivot, G.ring, mats.wrapDark, 'body');
    add(pivot, G.fins, mats.accent, 'body', true);   // 鳍尖探出件 noHit
    tatters.push({ pivot, restZ: 0, phase: 0, swing: 1, spin: P.tatters[0].spin });
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.3) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs: [], arms: [], tatters, meshes,
    triangles: count(), asym, lead: 1, blob,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const HOVERDRONE = {
  id: 'hoverdrone',
  name: 'Hoverdrone（浮游机）',

  speed: 1.6,
  scale: 1.0,
  height: 0.5,
  radius: 0.3,
  flyY: 2.0,
  texSeed: 2,            // stencil 风格（armorMaps 四选一）

  palette: {
    wrap: 0x9aa2a8,      // 钢灰碟身
    wrapDark: 0x9ba3ac,  // 银灰稳定环
    deep: 0x0e1013,
    eye: 0x2ad4ff,       // 青色大眼 + 喷口
    eyeGlow: 1.4,        // 大眼焦点；喷口共用此槽故克制
    seamGlow: 0.7,
    accent: 0x8a6a34,    // 黄铜稳定鳍/桅杆
    tatter: 0x9ba3ac,
  },

  proportions: {
    headH: 0.15,
    tatterRest: 0,
    tatters: [{ x: 0, y: 0, z: 0, w: 0, h: 0, spin: 1.2 }],   // 稳定环自旋速率
  },

  gait: {
    kind: 'fly',
    rate: 3.03,          // (TAU·0.9 - 0.8) / 1.6：悬浮时钟 0.9Hz（无拍翅）
    fly: {
      flapRate: 0,       // 无翼悬浮：翅膀通道静默（fillFly 除零护栏）
      flapAmp: 0,
      bobAmp: 0.06, bobRate: 0.9,
      weave: 0.08, pitch: 0.0,
      wingPairs: 0,
      headUp: -0.05, headScan: 0.6,
    },
  },

  build: buildHoverdrone,
  animate: animateFlyer,
};
