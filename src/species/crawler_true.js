/**
 * 真·爬行者 Crawler：借 core 引擎的壳体六足机器
 * 的范式做的四足贴地爬尸——双足 rig 做不到的事（zombies_ex.js 曾验证过，
 * 腿没有水平化通道，最多到「长臂佝行」）。
 *
 * 借与自写的分界：
 *   - 引擎壳体六足机器的 build/animate 不 export（core 一行未改），借的是
 *     **范式**：静态外张 mount Group（splay 烘进几何，不在动画关节上）+
 *     两级腿（hip→knee 嵌套 Group，肢体网格从关节向下长）+ 相位表步态。
 *     几何原语 parts()/tornStrip、接触影 contactShadow、WRAP_TILES 都是
 *     core/ 已有的 export，直接用。
 *   - 自写：四足骨架（人形躯干横放 + 四肢反关节撑地）、对角爬行走姿
 *     （animateCrawler：LF+RR / RF+LR 对角对，不是甲虫的六足 tripod）。
 *
 * 剪影词：「贴地蜘蛛」——躯干水平贴地，四肢反关节撑开（肘/膝拐点高过
 * 背线），头从躯干前端抬起前伸。侧视是「低平长条 + 四个高拐点」，
 * 俯视是 X 形撑开，正面是压扁的十字——与 roster 里所有直立种零混淆。
 *
 * 骨架层级刻意对齐人形契约（bake.js 的关节表零改动可烘）：
 *   group → body(静态) → hips[J.HIPS, position.y=rideHeight]
 *         → torso[J.TORSO] → { 躯干/骨盆 mesh, neck[J.NECK]→头,
 *             mount(静态) → hip/shoulder[J.*] → knee/elbow[J.*] → 肢体 mesh,
 *             tatter pivots[J.TATTER..] } ; blob 挂 group 为静态槽。
 * 凡挂在注册关节上的**静止姿态**（肘/膝的反折角、头的抬起角）必须由
 * animateCrawler / src/gait.js 的 fillCrawlJoints 每帧赋值还原——
 * bake 会把所有注册关节的旋转归零再烘（破布 restZ 同款契约）。
 */

import * as THREE from 'three';
import { parts, tornStrip } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES } from '../core/wraps.js';
import { makeZombieMaterialsFrom } from './zombies_ex.js';

// ---------------------------------------------------------------------------
// 几何（按 proportions 记录缓存，同 mummy.js 的 RIG_GEO 约定）
// ---------------------------------------------------------------------------

const CGEO = new Map();

function crawlerGeometry(P) {
  let out = CGEO.get(P);
  if (out) return out;

  const T = WRAP_TILES;
  out = {};

  {
    // 躯干：横放的胸廓 + 肩部一截加宽（趴下后肩线仍是最宽处）
    const p = parts(T);
    p.box(P.torsoW, P.torsoH, P.torsoD, { z: 0.08, top: 0.92, bottom: 1.0 });
    p.box(P.torsoW * 1.12, P.torsoH * 0.85, P.torsoD * 0.42,
      { z: 0.08 + P.torsoD * 0.30, top: 0.9, bottom: 1.0 });
    out.torso = p.build();
  }
  {
    // 骨盆：破裤裆（wrapDark），比躯干窄，垂得略低
    const p = parts(T);
    p.box(P.torsoW * 0.86, P.torsoH * 1.05, P.torsoD * 0.5,
      { y: -0.03, z: 0.08 - P.torsoD * 0.52, top: 1.0, bottom: 0.92 });
    out.pelvis = p.build();
  }
  {
    // 头：腐肉颅 + 眼窝暗带 + 双眼，人形头的趴姿缩版（local +Z 朝前）
    const p = parts(T);
    p.box(P.headW, P.headH, P.headD, { y: 0.02, top: 0.95, bottom: 0.85, depthTop: 0.95, depthBottom: 0.88 });
    p.box(P.headW * 1.03, P.headH * 0.28, P.headD * 1.02, { y: P.headH * 0.32, top: 0.8, bottom: 1.0 });
    out.head = p.build();

    const pd = parts(T);
    pd.box(P.headW * 0.88, P.headH * 0.20, P.headD * 1.02, { y: -P.headH * 0.05 });
    out.skullBand = pd.build();

    const pe = parts(T);
    for (const s of [-1, 1]) {
      pe.box(P.headW * 0.17, P.headH * 0.10, 0.03,
        { x: s * P.headW * 0.23, y: -P.headH * 0.05, z: P.headD * 0.53, chamfer: 0 });
    }
    out.eyes = pe.build();
  }
  {
    // 上臂 / 大腿：从肩/髋关节向下长（关节在网格顶端的契约同 buildHumanoid）
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW * 1.05, { y: -P.upperL / 2, top: 1.05, bottom: 0.8 });
    out.upper = p.build();
  }
  {
    // 前臂 + 撑地的手
    const p = parts(T);
    p.box(P.armW * 0.82, P.foreL, P.armW * 0.85, { y: -P.foreL / 2, top: 1.05, bottom: 0.72 });
    p.box(P.armW * 0.95, 0.08, P.armW * 1.4, { y: -P.foreL - 0.03, z: 0.03, top: 0.9, bottom: 0.9 });
    out.fore = p.build();
  }
  {
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW * 1.05, { y: -P.thighL / 2, top: 1.05, bottom: 0.8 });
    out.thigh = p.build();
  }
  {
    // 小腿 + 脚（爬尸的脚是拖着翻过来的脚背）
    const p = parts(T);
    p.box(P.legW * 0.85, P.shinL, P.legW * 0.9, { y: -P.shinL / 2, top: 1.05, bottom: 0.7 });
    p.box(P.legW * 0.9, 0.07, P.legW * 1.7, { y: -P.shinL - 0.02, z: -0.04, top: 0.9, bottom: 0.9 });
    out.shin = p.build();
  }

  CGEO.set(P, out);
  return out;
}

// ---------------------------------------------------------------------------
// 骨架
// ---------------------------------------------------------------------------

export function buildCrawler(spec, mats, actor) {
  const P = spec.proportions;
  const G = crawlerGeometry(P);
  const meshes = [];
  let triangles = 0;

  const add = (parent, g, mat, region) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    m.userData.region = region;
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
  const body = new THREE.Group();               // 静态壳（受击下沉/死亡用）
  group.add(body);
  const hips = new THREE.Group();               // J.HIPS：position 扛 rideHeight
  hips.position.y = P.rideHeight;
  body.add(hips);
  const torso = new THREE.Group();              // J.TORSO：爬行时身体拧滚
  hips.add(torso);

  const jw = 0.92 + R() * 0.16;                 // 躯干宽窄的逐实例抖动
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.pelvis, mats.wrapDark, 'body').scale.set(jw, 1, 1);

  // --- 头：抬起前伸（抬起角是动画值，不在 build 里写死） ----------------------
  const neck = new THREE.Group();
  neck.position.set(0, P.torsoH * 0.45, 0.08 + P.torsoD * 0.62);
  torso.add(neck);
  add(neck, G.head, mats.wrap, 'head');
  add(neck, G.skullBand, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // --- 四肢：静态 mount 扛外张（烘进几何），注册关节只扛动画 ------------------
  // 反关节：mount 把近段指向外上方（拐点高过背线），knee/elbow 的静止反折
  // 角由动画每帧还原（gait.elBend / gait.knBend），远端指回地面。
  const legs = [];   // 后肢（腿），契约同 buildHumanoid 的 { hip, knee, side }
  const arms = [];   // 前肢（臂），契约同 { shoulder, elbow, side }
  for (const side of [-1, 1]) {
    // 前肢（臂）：肩线在躯干前 1/3
    const mountA = new THREE.Group();
    mountA.position.set(side * P.torsoW * 0.56 * jw, 0, 0.08 + P.torsoD * 0.22);
    mountA.rotation.z = side * P.splayArm;
    mountA.rotation.y = -side * 0.12;
    torso.add(mountA);
    const shoulder = new THREE.Group();
    mountA.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL;
    shoulder.add(elbow);
    add(elbow, G.fore, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });

    // 后肢（腿）：骨盆两侧，向后外张
    const mountL = new THREE.Group();
    mountL.position.set(side * P.torsoW * 0.44 * jw, -P.torsoH * 0.12, 0.08 - P.torsoD * 0.42);
    mountL.rotation.z = side * P.splayLeg;
    mountL.rotation.y = side * 0.30;
    torso.add(mountL);
    const hip = new THREE.Group();
    mountL.add(hip);
    add(hip, G.thigh, mats.wrap, 'body');
    const knee = new THREE.Group();
    knee.position.y = -P.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    legs.push({ hip, knee, side });
  }

  // --- 背上破布（tatter 契约同人形：pivot 注册进 rig.tatters，动画每帧写）-----
  const tatters = [];
  for (const t of P.tatters) {
    const pivot = new THREE.Group();
    pivot.position.set(t.x * jw, t.y, t.z);
    const restZ = (t.out || 0) * (t.x < 0 ? -1 : 1);
    pivot.rotation.y = t.yaw || 0;
    pivot.rotation.z = restZ;
    torso.add(pivot);
    const m = new THREE.Mesh(tornStrip(t.w, t.h, t.cut || 0, 7, WRAP_TILES), mats.tatter);
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);
    tatters.push({ pivot, restZ, phase: R() * 6.283, swing: t.swing ?? 1 });
    triangles += m.geometry.attributes.position.count / 3;
  }

  const blob = contactShadow((spec.radius ?? 0.45) * 1.8);
  blob.position.y = 0.02;
  group.add(blob);

  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters, meshes, triangles,
    asym, lead: 1, blob,
    // 对角爬行一步的地面覆盖：前后肢平均展开长（strideRate 的步频推导用）
    stepSpan: 2 * ((P.upperL + P.foreL + P.thighL + P.shinL) / 4) * 0.8,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

// ---------------------------------------------------------------------------
// 走姿：对角爬行（LF+RR 半拍，RF+LR 半拍）——爬人是对角不是甲虫的 tripod
// ---------------------------------------------------------------------------

export function animateCrawler(rig, spec, s) {
  const g = spec.gait;
  const P = spec.proportions;
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * (rig.gait ? rig.gait.stride : 1) * (0.35 + 0.65 * drive);
  // 攻击/受击（与 src/gait.js fillCrawlJoints 逐行对应）：windup 弓身
  // 抬头 + 前两肢扬起后收 → strike 双前肢向前下扑扫 + 躯干前压 + 头埋进
  // 扑咬；staggerRoll/Pitch 趔趄折进 hips/torso，hit 落点抽动打在头上。
  const wu = s.windup || 0, stk = s.strike || 0;
  const stg = s.stagger || 0;
  const sRoll = s.staggerRoll || 0, sPitch = s.staggerPitch || 0;
  const hk = s.hit || 0;

  // 对角相位：左前+右后同相，右前+左后反相
  const limbs = [
    { j: rig.arms[0], off: 0, front: true },        // 左前
    { j: rig.arms[1], off: Math.PI, front: true },  // 右前
    { j: rig.legs[0], off: Math.PI },               // 左后
    { j: rig.legs[1], off: 0 },                     // 右后
  ];
  for (const { j: limb, off, front } of limbs) {
    const A = limb.shoulder || limb.hip;
    const B = limb.elbow || limb.knee;
    const side = limb.side;
    const bend = limb.shoulder ? g.elBend : g.knBend;
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));   // 前摆半拍抬腿
    // 静止反折角：与 mount 外张反向，把远端掰回指向地面（mount 正=外上，
    // 关节负=内下；左右镜像由 -side 承担）
    if (front && wu > 0) {                 // 前肢扬起蓄力（步态衰减让位）
      A.rotation.x = sw * amp * (1 - wu) - 0.55 * wu;
      A.rotation.z = -side * (lift * g.lift * drive + wu * 0.75);
      B.rotation.z = -side * bend * (1 + wu * 0.35) - side * lift * g.flex * drive * (1 - wu);
    } else if (front && stk > 0) {         // 扑扫：从蓄力位抡到前下方打穿
      A.rotation.x = 0.85 - 1.50 * stk;
      A.rotation.z = -side * 0.25 * stk;
      B.rotation.z = -side * bend * (0.45 + 0.55 * stk);
    } else {
      A.rotation.x = sw * amp;                       // 前后扒地
      A.rotation.z = -side * lift * g.lift * drive;  // 抬起方向沿外张轴
      B.rotation.z = -side * bend - side * lift * g.flex * drive;  // 摆动时远端收拢
    }
    B.rotation.x = 0;
  }

  // 身体随对角支撑拧滚 + 贴地起伏
  let torsoX = Math.sin(p * 2) * 0.04 * drive;
  if (wu > 0) torsoX -= wu * 0.28;               // 弓身：前段抬起
  else if (stk > 0) torsoX += (1 - stk) * 0.32;  // 前压扑下
  torsoX += sPitch * 1.2;
  rig.torso.rotation.x = torsoX;
  rig.torso.rotation.y = Math.sin(p) * g.swayYaw * drive;
  rig.torso.rotation.z = Math.sin(p) * g.swayRoll * drive + sRoll * 1.2;
  rig.hips.rotation.set(sPitch * 0.5, 0, sRoll * 0.5);   // 趔趄折进 hips（复算侧同款）
  rig.body.position.y = Math.abs(Math.sin(p)) * g.bob * drive
    + wu * 0.06 - (stk > 0 ? (1 - stk) * 0.05 : 0) - stg * 0.05;
  rig.body.rotation.set(0, 0, 0);

  // 头：抬起前伸 + 与步频错拍的左右扫视（爬尸找人的读法）
  let neckX = g.headUp + Math.sin(p * 2) * 0.06 * drive;
  if (wu > 0) neckX -= wu * 0.30;                // 头抬更狠（盯着猎物）
  else if (stk > 0) neckX += (1 - stk) * 0.28;   // 头埋进扑咬
  rig.neck.rotation.x = neckX + hk * 0.45;
  rig.neck.rotation.y = Math.sin(p * 0.47) * g.headScan;
  rig.neck.rotation.z = 0;

  for (const t of rig.tatters) {
    const lag = Math.sin(p - 0.8 + t.phase) * t.swing;
    t.pivot.rotation.x = lag * 0.28 * drive + P.tatterRest;
    t.pivot.rotation.z = t.restZ + Math.sin(p * 0.7 + t.phase) * 0.18 * drive;
  }
}

// ---------------------------------------------------------------------------
// 物种 spec
// ---------------------------------------------------------------------------

export const CRAWLER_TRUE = {
  id: 'crawler',
  name: 'Crawler',

  speed: 2.4,            // 爬得比走快——贴地扑过来的压迫感全靠速度
  scale: 1.0,
  height: 0.8,           // 站姿等高参考（实际是贴地的）
  radius: 0.5,

  palette: {
    wrap: 0x707558,      // 腐肉灰绿（与 zombie 同族，略偏土）
    wrapDark: 0x4c443a,  // 破裤/残袖
    deep: 0x171512,
    eye: 0xc9d4a8,
    eyeGlow: 0.5,        // 贴地高度眼睛是唯一的亮点，要读得出「在看你」
    accent: 0x3a332c,
    tatter: 0x4e463c,
  },

  proportions: {
    rideHeight: 0.34,                    // 躯干离地：贴地但四肢撑得住
    torsoW: 0.38, torsoH: 0.20, torsoD: 0.56,
    headW: 0.23, headH: 0.21, headD: 0.24,
    armW: 0.10, upperL: 0.36, foreL: 0.42,
    legW: 0.12, thighL: 0.38, shinL: 0.46,
    splayArm: 2.10,                      // 前肢外张到指向上外（肘高过背）
    splayLeg: 2.05,                      // 后肢更倒，向后外撑
    tatterRest: 0.5,
    tatters: [
      // 背上两条破衣，垂过体侧扫到地
      { on: 'torso', x: 0.16, y: 0.10, z: -0.10, w: 0.20, h: 0.42, yaw: -0.4, cut: 1, swing: 1.1, out: 0.2 },
      { on: 'torso', x: -0.10, y: 0.08, z: 0.10, w: 0.17, h: 0.34, yaw: 0.5, cut: 2, swing: 1.3, out: 0.18 },
    ],
  },

  gait: {
    crawl: true,         // src/gait.js 的 fillJoints 分派依据
    rate: 1.15,
    stride: 0.55,        // 前后扒地幅度（rad）
    lift: 0.30,          // 前摆半拍沿外张轴抬腿
    flex: 0.55,          // 摆动时肘/膝收拢
    elBend: 2.50,        // 肘/膝静止反折角（动画每帧还原，bake 会归零）
    knBend: 2.35,
    swayRoll: 0.09,      // 身体随对角支撑拧滚
    swayYaw: 0.10,       // 爬行时身体小幅蛇行
    bob: 0.035,
    headUp: -0.95,       // 头抬起前伸（-x 把脸从朝地掰到朝前）
    headScan: 0.5,       // 与步频错拍的左右扫视
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, null, rng),
  build: buildCrawler,
  animate: animateCrawler,
};
