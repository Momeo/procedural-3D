/**
 * 肉蛆 Maggot：几何语言扩展（src/prims.js）的有机物种样例——
 * 全身没有一个盒子，剪影完全由 lathe 体节 + ellipsoid 头 + cyl 刺构成，
 * 与 roster 里的盒族（人形/爬行者）与机器人族零混淆。
 *
 * rig 范式（无四肢有机种，骨架层级仍对齐人形契约，bake.js 零改动可烘）：
 *   group → body(静态壳) → hips[J.HIPS, position.y=rideHeight，扛后半身]
 *         → torso[J.TORSO，扛前半身] → neck[J.NECK，扛头]
 *   legs: [] / arms: []（bake.js 的空数组守卫跳过四肢注册；bake 把注册关节
 *   旋转归零再烘，静止姿态全部烘进几何）。
 *
 * 步态（gait.kind:'slug'，animateMaggot 与 src/gait.js 的
 * fillSlugJoints 逐行对应）：无腿蠕动——蠕动正弦波从髋传到头（逐节相位
 * 滞后 waveLag），三节 pitch 叠加出推进浪；bob 小幅；转向靠 torso.yaw
 * 缓慢蛇形摆动。攻击 = windup 前段弓起抬头 → strike 向前下啄；受击趔趄
 * 折进 hips/torso（无四肢，全身上下就这三节），落点抽动打头。
 *
 * 断肢：颈部可断（断头 = 蛆头掉落，debris[J.NECK] 收头+牙+眼子树）；
 * 无四肢自然无四肢断肢；布娃娃走非人形回退（gait.kind 非空，同 crawler/
 * 机器人在 shooter 的倾倒+沉入路径）。
 *
 * 材质：复用 zombie.js 的腐肉贴图集（fleshMaps，createZombieEx 缺省
 * makeMaterials 就是它），palette 调肉粉/脓黄色系，眼是两颗浑浊小点。
 */

import * as THREE from 'three';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES } from '../core/wraps.js';
import { prims } from '../prims.js';

// ---------------------------------------------------------------------------
// 几何（按 proportions 记录缓存，同 crawler_true.js 的 RIG_GEO 约定）
// ---------------------------------------------------------------------------

const MGEO = new Map();

/** 体节轮廓：尾端（profile 底）钝圆、头端（顶）收窄，相邻节互插叠合。 */
function segProfile(r, L) {
  return [
    [0.001,  -L * 0.50],
    [r * 0.55, -L * 0.46],
    [r * 0.92, -L * 0.26],
    [r,        -L * 0.04],
    [r * 0.97,  L * 0.16],
    [r * 0.72,  L * 0.36],
    [r * 0.40,  L * 0.47],
    [0.001,   L * 0.50],
  ];
}

function maggotGeometry(P) {
  let out = MGEO.get(P);
  if (out) return out;

  const T = WRAP_TILES;
  out = {};
  const L = P.segL;

  // 四体节分两组烘进所属关节的局部系（几何里直接带 rx/z，挂到关节原点即可）。
  // lathe 局部轴 +Y，rx=π/2 躺平到 Z：profile 底（尾）→ -Z，顶（头端）→ +Z。
  {
    const p = prims(T);
    p.lathe(segProfile(P.segR[0], L), { rx: Math.PI / 2, z: -P.segGap * 0.5 });
    p.lathe(segProfile(P.segR[1], L), { rx: Math.PI / 2, z: +P.segGap * 0.5, u: 0.31, v: 0.17 });
    out.rearSegs = p.build();
  }
  {
    const p = prims(T);
    p.lathe(segProfile(P.segR[2], L), { rx: Math.PI / 2, z: -P.segGap * 0.5, u: 0.53, v: 0.29 });
    p.lathe(segProfile(P.segR[3], L), { rx: Math.PI / 2, z: +P.segGap * 0.5, u: 0.11, v: 0.43 });
    out.frontSegs = p.build();
  }
  {
    // 头：ellipsoid 头颅（探出前节剪影之外，爆头才打得到）+ cyl 小尖牙一对
    // （deep 槽，指向前下）+ 浑浊小眼两点（eye 槽）
    const p = prims(T);
    p.ellipsoid(P.headW / 2, P.headH / 2, P.headD / 2, { z: P.headD * 0.42, rings: 5, segs: 8 });
    out.head = p.build();

    const pf = prims(T);
    for (const s of [-1, 1]) {
      pf.cyl(0, 0.013, P.fangL, {
        x: s * P.headW * 0.16, y: -P.headH * 0.22, z: P.headD * 0.80,
        rx: Math.PI / 2 + 0.38, radial: 6,
      });
    }
    out.fangs = pf.build();

    const pe = prims(T);
    for (const s of [-1, 1]) {
      pe.ellipsoid(0.017, 0.014, 0.011, {
        x: s * P.headW * 0.24, y: P.headH * 0.14, z: P.headD * 0.72, rings: 3, segs: 6,
      });
    }
    out.eyes = pe.build();
  }
  {
    // 背部稀疏短刚毛：cyl 锥刺（rTop=0），分挂 hips/torso 两节，逐根角度错开
    const rear = prims(T);
    const BRISTLES_REAR = [
      [0.00, -P.segGap * 0.55, -0.35], [-0.06, -P.segGap * 0.30, -0.5],
      [0.05, P.segGap * 0.10, -0.25], [-0.04, P.segGap * 0.45, -0.55],
    ];
    for (const [x, z, rx] of BRISTLES_REAR) {
      rear.cyl(0, 0.0075, 0.055, { x, y: P.segR[1] * 0.82, z, rx, radial: 5 });
    }
    out.rearBristles = rear.build();

    const front = prims(T);
    const BRISTLES_FRONT = [
      [0.04, -P.segGap * 0.40, -0.4], [-0.05, -P.segGap * 0.05, -0.3],
      [0.03, P.segGap * 0.35, -0.5],
    ];
    for (const [x, z, rx] of BRISTLES_FRONT) {
      front.cyl(0, 0.007, 0.05, { x, y: P.segR[3] * 0.85, z, rx, radial: 5 });
    }
    out.frontBristles = front.build();
  }

  MGEO.set(P, out);
  return out;
}

// ---------------------------------------------------------------------------
// 骨架（无四肢；静止姿态烘进几何，注册关节只扛蠕动波动画）
// ---------------------------------------------------------------------------

export function buildMaggot(spec, mats, actor) {
  const P = spec.proportions;
  const G = maggotGeometry(P);
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

  // R = 逐实例随机：本函数只经 spec.build 在工厂（createZombieEx）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();               // 静态壳（bob/受击下沉走动画）
  group.add(body);
  const hips = new THREE.Group();               // J.HIPS：后半身（体节 0/1）
  hips.position.set(0, P.rideHeight, -P.segGap);
  body.add(hips);
  const torso = new THREE.Group();              // J.TORSO：前半身（体节 2/3）
  torso.position.set(0, 0, P.segGap * 2);
  hips.add(torso);

  add(hips, G.rearSegs, mats.wrap, 'body');
  add(hips, G.rearBristles, mats.accent, 'body', true);   // 刚毛：细长件 noHit
  add(torso, G.frontSegs, mats.wrap, 'body');
  add(torso, G.frontBristles, mats.accent, 'body', true);

  // --- 头：J.NECK，挂在前节前端（头位坐标是几何/动画共享的结构值） ------------
  const neck = new THREE.Group();
  neck.position.set(0, 0.01, P.segGap * 1.15);
  torso.add(neck);
  add(neck, G.head, mats.wrap, 'head');
  add(neck, G.fangs, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  const blob = contactShadow((spec.radius ?? 0.3) * 1.9);
  blob.position.y = 0.02;
  group.add(blob);

  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs: [], arms: [], tatters: [], meshes,
    triangles, asym, lead: 1, blob,
    // 无腿：不声明 stepSpan，stepRate 走 spec 常量兜底
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

// ---------------------------------------------------------------------------
// 步态：无腿蠕动（与 src/gait.js 的 fillSlugJoints 逐行对应）
// 蠕动波从髋传到头（逐节相位滞后 waveLag），三节 pitch 叠出推进浪。
// ---------------------------------------------------------------------------

export function animateMaggot(rig, spec, s) {
  const g = spec.gait;
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.waveAmp * (rig.gait ? rig.gait.stride : 1) * (0.35 + 0.65 * drive);
  // 攻击/受击字段契约同 animateCrawler：windup 前段弓起抬头 → strike 前啄；
  // 趔趄折进 hips/torso，hit 落点抽动打在头上
  const wu = s.windup || 0, stk = s.strike || 0;
  const stg = s.stagger || 0;
  const sRoll = s.staggerRoll || 0, sPitch = s.staggerPitch || 0;
  const hk = s.hit || 0;
  const lag = g.waveLag;

  let hipsX = Math.sin(p) * amp;
  let torsoX = Math.sin(p - lag) * amp;
  let neckX = g.headUp + Math.sin(p - lag * 2) * amp * 0.9;
  if (wu > 0) {                       // 前段弓起抬头（盯着猎物蓄力）
    torsoX -= wu * 0.30;
    neckX -= wu * 0.45;
  } else if (stk > 0) {               // 向前下啄
    torsoX += (1 - stk) * 0.22;
    neckX += (1 - stk) * 0.40;
  }
  hipsX += sPitch * 0.8;
  torsoX += sPitch * 1.1;
  neckX += hk * 0.45;

  rig.hips.rotation.set(hipsX, 0, sRoll * 0.5);
  rig.torso.rotation.x = torsoX;
  rig.torso.rotation.y = Math.sin(p - lag * 0.5) * g.swayYaw * drive;   // 缓慢蛇形
  rig.torso.rotation.z = sRoll * 1.1;
  rig.neck.rotation.x = neckX;
  rig.neck.rotation.y = Math.sin(p * 0.47) * g.headScan;
  rig.neck.rotation.z = 0;

  rig.body.position.y = Math.abs(Math.sin(p - lag)) * g.bob * drive - stg * 0.03;
  rig.body.rotation.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// 物种 spec
// ---------------------------------------------------------------------------

export const MAGGOT = {
  id: 'maggot',
  name: 'Maggot',

  speed: 0.8,            // 蠕动缓慢——成群贴地爬过来的压迫感靠数量不靠速度
  scale: 1.0,
  height: 0.45,          // 贴地长条（站姿等高参考）
  radius: 0.30,

  palette: {
    wrap: 0xd98a80,      // 肉粉（偏红一号：腐肉贴图底子偏绿，乘法混合要补偿）
    wrapDark: 0x8a7a52,  // 脓黄（备用槽，几何未用）
    deep: 0x241512,      // 尖牙
    eye: 0xd4d8c0,       // 浑浊小眼（微弱自发光，makeZombieMaterialsFrom 定档 0.38）
    accent: 0x584a3a,    // 背部刚毛
    tatter: 0x4e463c,
  },

  proportions: {
    rideHeight: 0.155,                 // 体轴离地：腹面贴地但剪影托得住
    segR: [0.150, 0.158, 0.138, 0.110],   // 四体节半径（尾→头，中后段最肥）
    segL: 0.26, segGap: 0.20,          // 节长 > 节距：相邻节互插叠合
    headW: 0.20, headH: 0.16, headD: 0.18,   // headH 是 index.html 黄点契约字段
    fangL: 0.075,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'slug',        // src/gait.js 分派到 fillSlugJoints
    rate: 1.3,           // 蠕动波频（无腿：stepRate 走 spec 常量兜底）
    waveAmp: 0.16,       // 蠕动波关节角幅（rad）
    waveLag: 1.0,        // 髋→躯干→头相位滞后（波从尾向头推进）
    swayYaw: 0.10,       // 躯干缓慢蛇形
    bob: 0.015,
    headUp: -0.08,       // 头微抬朝前
    headScan: 0.30,      // 错拍扫视
  },

  build: buildMaggot,
  animate: animateMaggot,
};
