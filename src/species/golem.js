/**
 * 元素魔像谱系（golem.js）：岩石 rockgolem / 熔岩 magmagolem / 冰霜
 * frostgolem / 水晶 crystalgolem。精英/Boss 层：重甲巨物、低频砸地步、
 * 大体型（scale 1.5~2.3，不超过 draco 2.8 铁律）。四剪影词：圆石桶（灰褐
 * 苔痕）/ 黑岩裂炉（橙红裂缝）/ 苍白冰塔（半透明冰甲）/ 紫晶悬浮（碎晶环）。
 *
 * 借与自写的分界（范式照 dragons.js / undead.js 顶部契约）：
 *   - 借：parts()（core/anatomy.js）、contactShadow（core/contact.js）、
 *     WRAP_TILES/linenMaps（core/wraps.js）、prims（pipeline/prims.js）、
 *     mkActorTools/flyBlob/animateFlyer（flyers.js）、MUMMY.animate
 *     （core/mummy.js 人形步态）、strut（undead.js）、surfaceStrips/
 *     mkRadiusFn/makeLatheSurf/quadStrips（dragons.js 贴面游走器）、
 *     makeZombieMaterialsFrom（zombies_ex.js）。
 *   - 自写：魔像 rig（buildGolem 行走三种 + buildCrystalgolem 悬浮一种，
 *     骨架对齐人形契约）+ **可破坏装甲板机制**（见下）。
 *
 * 可破坏装甲板（本谱系的核心机制，pipeline 纯增量、旧物种零变化）：
 *   - 板 = 挂在**扩展关节位**（ARM2/EL2 槽 20-23，行走魔像用不到第二对臂）
 *     的独立 pivot 上：胸甲 ARM2_L(20) / 腹甲 EL2_L(21) / 背甲 ARM2_R(22) /
 *     肩披 EL2_R(23)。动画不接管这些槽（恒零旋转，姿态烘进几何）。
 *   - 判定：板 mesh 标 userData.plate → bake 产 part 'plate' 独立盒
 *     （PART_MULT.plate=0.3 减伤壳）；核心 mesh region 'core' → part 'core'
 *     独立盒（×3 要害，与爆头同档），挂在躯干叶上但按「叶×部位」分键合并，
 *     不被躯干盒吞掉（bake.js 合并键改动，旧物种同叶恒同部位、结果不变）。
 *   - 脱落：shooter.html 按 (实例, 关节) 计数，板中弹 PLATE_HITS=3 次 →
 *     severLimb 置 severMask 位（顶点塌缩逐实例生效，断肢现成通路）+
 *     碎块走残肢飞舞池（baked.debris 对 20-23 槽照常产出）。
 *   - 板掉之后：hitvol.js 的 raycastLocal 跳过链上含掩码位的盒（列 0.z
 *     读回 severMask）——板盒消失，射线直达核心盒吃 ×3。**这一跳通同时也
 *     修了旧物种的潜在问题：断掉的手臂此前仍留幽灵盒挡子弹**（现在同源）。
 *   - 布娃娃/死亡：板关节不进 ragdoll 模板（只读标准 11 关节），尸体保留
 *     脱落状态；crystalgolem 走 fly 悬浮种的失速螺旋坠落。
 *   取舍：板位就 4 个（ARM2/EL2 槽占满；LEG2/LEG3 槽会触发断腿降速语义，
 *   不可用）；板计数阈值全场统一（3）；板盒只做 slab 壳不做逐块血量条。
 *
 * 配色防染：四种全用 linenMaps 中性基底（fleshMaps 绿染坑；冰霜/水晶是
 * 彩色 palette 必换）。发光裂纹/核心走 eye 槽克制（0.8~1.05），深色皴裂/
 * 苔痕走 deep 槽，装饰件一律 noHit，六材质槽不破。
 */

import * as THREE from 'three';
import { parts } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES, linenMaps } from '../core/wraps.js';
import { MUMMY } from '../core/mummy.js';
import { prims } from '../prims.js';
import { mkActorTools, flyBlob, animateFlyer } from './flyers.js';
import { strut } from './undead.js';
import { surfaceStrips, mkRadiusFn, makeLatheSurf } from './dragons.js';
import { makeZombieMaterialsFrom } from './zombies_ex.js';

// ---------------------------------------------------------------------------
// 魔像共享几何/Rig
// ---------------------------------------------------------------------------

/** 直立桶身（lathe，轴 +Y）表面参数化：P(a,y) = (r·cos a, y, r·sin a)，
 *  a=0 → 正前（+z）/ a=π 背 / a=±π/2 两侧。给 surfaceStrips 贴裂纹用。 */
function makeBarrelSurf(rFn) {
  return (a, y) => {
    const r = rFn(y);
    return { p: [r * Math.cos(a), y, r * Math.sin(a)], n: [Math.cos(a), 0, Math.sin(a)] };
  };
}

/**
 * 魔像几何总装（按 proportions 记录缓存，G 字典）：
 *   pelvis/thigh/shin（石柱腿）/ torso（lathe 桶身）+ shoulderRock（肩头岩）
 *   upper/fore（巨石臂）/ head 三件套（岩颅 + 眉檐 + 发光目缝 eye）
 *   cracks（species 贴面纹，槽位由 D 布局决定）/ core（eye 发光核心）
 *   plateChest/plateBelly/plateBack/plateMantle（四块装甲板，pivot 局部系）
 * P 自定义字段：torsoProfile（lathe 半径表，裂纹贴面共用）、fistW、
 *   plateStyle = { w, h, t }（板尺寸基调）。
 */
function golemGeometry(P) {
  let out = GOLEMGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  const rFn = mkRadiusFn(P.torsoProfile);
  {
    // 骨盆：厚岩盘
    const p = parts(T);
    p.box(P.hipW, 0.30, P.bodyD * 0.9, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  {
    // 石柱腿：大腿收、小腿更粗（魔像的腿是承重仓柱）
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW, { y: -P.thighL / 2, top: 1.15, bottom: 0.9 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(P.legW * 1.1, P.shinL, P.legW * 1.1, { y: -P.shinL / 2, top: 0.95, bottom: 1.1 });
    // 石板大脚（踩地的重读法全靠它）
    ps.box(P.legW * 1.5, 0.12, P.legW * 2.0, { y: -P.shinL + 0.05, z: P.legW * 0.35, top: 1.0, bottom: 0.95 });
    out.shin = ps.build();
  }
  {
    // 桶身：lathe 圆桶（岩身主剪影）+ 肩头两块圆岩
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
    const pk = prims(T);
    for (const s of [-1, 1]) {
      pk.ellipsoid(P.shoulderRockR, P.shoulderRockR * 0.8, P.shoulderRockR * 0.9,
        { x: s * P.shoulderX * 0.92, y: P.chestH * 0.92, z: 0, rings: 4, segs: 7 });
    }
    out.shoulderRock = pk.build();
  }
  {
    // 巨石臂：上臂岩块 + 前臂厚板 + 石拳
    const p = parts(T);
    p.box(P.armW * 1.3, P.upperL, P.armW * 1.25, { y: -P.upperL / 2, top: 1.2, bottom: 0.85 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 1.5, P.foreL, P.armW * 1.4, { y: -P.foreL / 2, top: 0.9, bottom: 1.1 });
    pf.box(P.armW * P.fistW, P.armW * P.fistW, P.armW * P.fistW, { y: -P.foreL - P.armW * P.fistW * 0.4, top: 0.9, bottom: 0.9 });
    out.fore = pf.build();
  }
  {
    // 头：小岩颅（埋进肩线的巨物头）+ 眉檐 + 目缝（eye 发光槽）
    const p = prims(T);
    p.ellipsoid(P.headW * 0.5, P.headH * 0.45, P.headD * 0.48, { y: P.headH * 0.45, rings: 4, segs: 7 });
    // 颈岩：桶顶到头底的衔接块（头抬出桶顶是爆头可达铁律，不是造型选择）
    p.ellipsoid(P.headW * 0.36, 0.09, P.headD * 0.36, { y: -0.04, rings: 3, segs: 6 });
    out.skull = p.build();
    const pb = parts(T);
    pb.box(P.headW * 1.15, P.headH * 0.22, P.headD * 0.55, { y: P.headH * 0.62, z: P.headD * 0.28, top: 1.0, bottom: 0.85 });
    out.brow = pb.build();
    const pe = parts(T);
    pe.box(P.headW * 0.72, P.headH * 0.10, 0.02, { y: P.headH * 0.44, z: P.headD * 0.52, chamfer: 0.002 });
    out.eyes = pe.build();
  }
  {
    // 发光核心（eye 槽；挂躯干叶、region 'core' 独立要害盒）：晶核 + 内芯
    const p = prims(T);
    p.ellipsoid(0.085, 0.10, 0.05, { y: P.chestH * 0.52, z: rFn(P.chestH * 0.52) + 0.005, rings: 4, segs: 7 });
    p.ellipsoid(0.045, 0.055, 0.028, { y: P.chestH * 0.52, z: rFn(P.chestH * 0.52) + 0.035, rings: 3, segs: 6 });
    out.core = p.build();
  }
  {
    // 四块装甲板（accent 槽；pivot 局部系，板面法线朝外）：
    // 胸甲大板 / 腹甲小板 / 背甲大板 / 肩披横板——各自的盒就是各自的判定盒
    // 胸甲几何中心只微垂（yOff -0.15h）：胸甲必须把核心（chestH*0.52）整个
    // 盖住——垂低了核心会从板上缘探出来（首轮实拍踩出：yOff -0.4h 时核心
    // 上半截外露，「打掉壳片露出核心」的前提没了）
    const st = P.plateStyle;
    const mk = (w, h, t, yOff = -0.4) => {
      const p = parts(T);
      p.box(w, h, t, { y: yOff * h, top: 0.95, bottom: 1.05 });
      // 板面加一道棱（两块板拼出的厚度差读作「锻造板」而非「片」）
      p.box(w * 0.86, h * 0.2, t * 1.6, { y: yOff * h + h * 0.05, chamfer: 0.006 });
      return p.build();
    };
    out.plateChest = mk(st.w, st.h * 1.15, st.t, -0.15);
    out.plateBelly = mk(st.w * 0.72, st.h * 0.55, st.t);
    out.plateBack = mk(st.w * 0.95, st.h * 0.9, st.t);
    out.plateMantle = mk(st.w * 1.5, st.h * 0.5, st.t);
  }
  GOLEMGEO.set(P, out);
  return out;
}
const GOLEMGEO = new Map();

/** 行走魔像的动画壳：MUMMY.animate 会把 rig.arms 全数当手臂写——板 pivot
 *  （arms[2]/[3]）没有 bias 字段，reach=NaN 会把板矩阵毒成 NaN（首轮实拍
 *  板整片消失即此）。写后把板 pivot 复位到 bind 恒等（与烘焙零姿态一致，
 *  instanced 路径的零四元数语义天然恒等，无需管线侧任何改动）。 */
function golemAnimate(rig, spec, s) {
  MUMMY.animate(rig, spec, s);
  for (let ai = 2; ai < rig.arms.length; ai++) {
    rig.arms[ai].shoulder.rotation.set(0, 0, 0);
    rig.arms[ai].elbow.rotation.set(0, 0, 0);
  }
}

/**
 * 行走魔像 rig（rock/magma/frost 共用）：人形契约 + 四板 pivot 占
 * ARM2/EL2 扩展槽（arms[2]/[3]，各带空 elbow 子节点凑 bake 的对位契约——
 * 空槽无几何不写纹理行）。G.plate* 网格标 userData.plate，核心标
 * region 'core'（bake.js 的部位覆盖通路）。
 */
function buildGolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = golemGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  // R = 逐实例随机：工厂（createZombieEx）withSeed 流内调用，保持原样
  const R = () => Math.random();

  // 抖动方案照抄 buildHumanoid/buildBoneHumanoid 的分布（怪海复算侧同分布）
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

  // 石柱腿（站位一前一后，同人形契约）
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

  // 躯干（桶身 + 肩岩 + 贴面裂纹）
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  torso.rotation.y = asym.reach * 0.85;
  hips.add(torso);
  add(torso, G.torso, mats.wrap, 'body').scale.set(j.chestW, j.chest, j.chestW);
  add(torso, G.shoulderRock, mats.wrapDark, 'body').scale.set(j.chestW, j.chest, j.chestW);
  if (G.cracks) add(torso, G.cracks, P.crackMat === 'deep' ? mats.deep : mats.eye, 'body', true);   // 贴面纹 noHit

  // 发光核心（胸甲之后）：region 'core' → 独立要害盒
  const mc = add(torso, G.core, mats.eye, 'body');
  mc.userData.region = 'core';

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

  // 装甲板四块：arms[2]/[3] 占 ARM2/EL2 槽。pivot 位置 = 贴桶身皮
  // （rFn 读共享半径表）；板姿态烘进几何，注册关节恒零
  const rFn = mkRadiusFn(P.torsoProfile);
  const chestP = new THREE.Group();
  chestP.position.set(0, P.chestH * 0.60, rFn(P.chestH * 0.60) * j.chestW + 0.035);
  torso.add(chestP);
  add(chestP, G.plateChest, mats.accent, 'body').userData.plate = true;
  const bellyP = new THREE.Group();
  bellyP.position.set(0, -P.chestH * 0.40, -0.02);
  chestP.add(bellyP);
  add(bellyP, G.plateBelly, mats.accent, 'body').userData.plate = true;
  const backP = new THREE.Group();
  backP.position.set(0, P.chestH * 0.60, -rFn(P.chestH * 0.60) * j.chestW - 0.035);
  torso.add(backP);
  add(backP, G.plateBack, mats.accent, 'body').userData.plate = true;
  const mantleP = new THREE.Group();
  mantleP.position.set(0, P.chestH * 0.30, 0.02);
  backP.add(mantleP);
  add(mantleP, G.plateMantle, mats.accent, 'body').userData.plate = true;
  // 注册进 arms[2]/[3]（bake jmap：arms[2]=ARM2_L/EL2_L，arms[3]=ARM2_R/EL2_R）
  arms[2] = { shoulder: chestP, elbow: bellyP, side: -1 };
  arms[3] = { shoulder: backP, elbow: mantleP, side: 1 };

  // 头（岩颅埋进肩线；爆头仍须可达——头盒心探出桶身顶缘）
  const neck = new THREE.Group();
  neck.position.y = P.headY * j.chest;
  neck.scale.setScalar(j.head);
  neck.rotation.y = -asym.reach * 1.15;
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.brow, mats.wrapDark, 'head');
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

// ---------------------------------------------------------------------------
// 物种一：岩石魔像 rockgolem —— 圆石桶（灰褐巨岩拼合，苔痕/深色皴裂 deep 槽，
// 慢而沉的基石精英）
// ---------------------------------------------------------------------------

/** 桶身半径表（lathe profile 与裂纹贴面共用）：鼓腹收肩的岩桶 */
const ROCK_PROFILE = [[0.001, -0.02], [0.30, 0.02], [0.38, 0.22], [0.40, 0.44],
  [0.34, 0.62], [0.24, 0.72], [0.001, 0.76]];

export function buildRockgolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = golemGeometry(P);
  if (!G.cracks) {
    // 深色皴裂 + 苔痕（deep 槽不发光）：桶身两侧+正面三条主裂 + 顶部苔斑纹
    G.cracks = surfaceStrips(20260827, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.5, 0.04, 0.15, 0.60, 6, 0.020],                    // 右前主裂
      [Math.PI - 0.5, 0.06, Math.PI + 0.3, 0.56, 6, 0.020], // 左前主裂
      [Math.PI * 0.5, 0.05, Math.PI * 0.5, 0.58, 5, 0.024], // 背脊主裂
      [0.8, 0.30, 0.2, 0.42, 3, 0.013],                     // 支裂
      [Math.PI - 0.8, 0.26, Math.PI - 0.15, 0.40, 3, 0.013],
      [1.35, 0.62, 1.8, 0.70, 3, 0.016],                    // 顶部苔痕（沿肩线漫）
    ]);
  }
  return buildGolem(spec, mats, actor);
}

export const ROCKGOLEM = {
  id: 'rockgolem',
  name: 'Rockgolem（岩石魔像）',

  speed: 0.9,
  scale: 1.6,
  height: 3.0,
  radius: 0.62,

  palette: {
    wrap: 0x8a7a62,      // 灰褐岩身
    wrapDark: 0x5a4c3c,  // 深岩（小腿/前臂/肩岩/眉檐）
    deep: 0x2c2a1c,      // 皴裂+苔痕（深褐绿）
    eye: 0xffc86a,       // 琥珀目缝 + 核心
    eyeGlow: 0.6,
    accent: 0x6e6558,    // 石板甲
    accentRough: 0.85,
    accentMetal: 0.05,
    tatter: 0x4a4438,
  },

  proportions: {
    hipY: 1.05, hipW: 0.55, bodyD: 0.50,
    legX: 0.20, legW: 0.22, thighL: 0.52, shinL: 0.53,   // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.80, chestH: 0.75,
    torsoProfile: ROCK_PROFILE,
    shoulderX: 0.45, shoulderY: 0.55, shoulderRockR: 0.17,
    armW: 0.16, upperL: 0.50, foreL: 0.55, fistW: 1.7,
    headY: 0.93, headW: 0.22, headH: 0.26, headD: 0.24,
    plateStyle: { w: 0.52, h: 0.44, t: 0.045 },
    crackMat: 'deep',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.65,          // 低频重踏（每一步都砸地）
    stride: 0.52,
    armSwing: 0.26,      // 巨石臂钟摆
    armReach: 0.05,      // 手臂垂落
    armSplay: 0.30,      // 宽桶身撑开
    elbowBend: -0.08,
    lean: -0.06,         // 接近直立：巨物的稳
    sway: 0.13,
    hipTwist: 0.05,
    bob: 0.085,
    headLoll: 0.05,
    headDroop: -0.10,
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildRockgolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种二：熔岩魔像 magmagolem —— 黑岩裂炉（Boss 档 scale 2.3：黑玄武岩身 +
// 熔岩裂缝 eye 发光纹（surfaceStrips 范式）+ 关节缝渗光）
// ---------------------------------------------------------------------------

const MAGMA_PROFILE = [[0.001, -0.02], [0.32, 0.02], [0.40, 0.24], [0.42, 0.46],
  [0.36, 0.64], [0.26, 0.74], [0.001, 0.78]];

export function buildMagmagolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = golemGeometry(P);
  if (!G.cracks) {
    // 熔岩裂缝（eye 发光槽；黑岩面要透出，glow 定档 1.05 同 draco 思路）：
    // 正面两主枝 + 背一枝 + 关节方向短枝（裂缝往肩/髋「渗」）
    G.cracks = surfaceStrips(20260828, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.4, 0.02, 0.1, 0.62, 7, 0.024],
      [Math.PI - 0.4, 0.04, Math.PI - 0.05, 0.60, 7, 0.024],
      [Math.PI * 0.5, 0.06, Math.PI * 0.5, 0.62, 6, 0.028],
      [0.9, 0.55, 1.3, 0.70, 3, 0.016],                     // 往肩渗
      [Math.PI - 0.9, 0.52, Math.PI - 1.3, 0.68, 3, 0.016],
      [0.2, 0.20, -0.3, 0.34, 3, 0.015],                    // 支裂
      [Math.PI + 0.2, 0.24, Math.PI + 0.6, 0.38, 3, 0.015],
    ]);
  }
  const rig = buildGolem(spec, mats, actor);
  const { add, count } = rig.tools;
  // 关节缝渗光（eye 槽小件，肩/髋缝一圈）：读作「岩石拼合处透出炉光」
  const seams = prims(WRAP_TILES);
  for (const s of [-1, 1]) {
    seams.ellipsoid(0.035, 0.022, 0.035, { x: s * P.shoulderX, y: P.torsoY + P.shoulderY - 0.06, z: 0.02, rings: 3, segs: 5 });
    seams.ellipsoid(0.030, 0.020, 0.030, { x: s * P.legX, y: -0.04, z: 0.04, rings: 3, segs: 5 });
  }
  const seamGeo = seams.build();
  add(rig.torso, seamGeo, mats.eye, 'body', true);    // 细长渗光件 noHit
  rig.triangles = count();
  return rig;
}

export const MAGMAGOLEM = {
  id: 'magmagolem',
  name: 'Magmagolem（熔岩魔像）',

  speed: 0.7,            // Boss 的缓慢逼近
  scale: 2.3,            // Boss 梯队：> bonebrute 2.3 平级、< draco 2.8 铁律
  height: 4.2,
  radius: 0.85,

  palette: {
    wrap: 0x1e1b1c,      // 黑玄武岩
    wrapDark: 0x322c2e,  // 深灰黑（腿/臂/肩岩）
    deep: 0x0c0a0c,
    eye: 0xff5a16,       // 熔岩橙红（裂缝/目缝/核心/关节渗光同槽）
    eyeGlow: 1.05,       // 裂缝要透出近黑岩面（draco 1.1 同款定档）
    accent: 0x3c3638,    // 玄武岩甲板
    accentRough: 0.8,
    accentMetal: 0.1,
    tatter: 0x2c282a,
  },

  proportions: {
    hipY: 1.06, hipW: 0.60, bodyD: 0.54,
    legX: 0.22, legW: 0.24, thighL: 0.53, shinL: 0.53,   // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.84, chestH: 0.78,
    torsoProfile: MAGMA_PROFILE,
    shoulderX: 0.48, shoulderY: 0.58, shoulderRockR: 0.19,
    armW: 0.17, upperL: 0.52, foreL: 0.58, fistW: 1.8,
    headY: 0.95, headW: 0.23, headH: 0.27, headD: 0.25,
    plateStyle: { w: 0.56, h: 0.46, t: 0.05 },
    crackMat: 'eye',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.58,
    stride: 0.50,
    armSwing: 0.24,
    armReach: 0.06,
    armSplay: 0.32,
    elbowBend: -0.06,
    lean: -0.04,
    sway: 0.12,
    hipTwist: 0.04,
    bob: 0.09,
    headLoll: 0.04,
    headDroop: -0.12,
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildMagmagolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种三：冰霜魔像 frostgolem —— 苍白冰塔（苍白蓝冰岩 + 冰白发光裂纹 +
// 半透明冰晶甲板/冰锥饰件——wraith 趟过的半透明方案：transparent +
// depthWrite:false；accent 单面不涉及双面双 pass 问题）
// ---------------------------------------------------------------------------

const FROST_PROFILE = [[0.001, -0.02], [0.28, 0.02], [0.36, 0.22], [0.38, 0.44],
  [0.33, 0.62], [0.23, 0.72], [0.001, 0.76]];

export function buildFrostgolem(spec, mats, actor) {
  const P = spec.proportions;
  const G = golemGeometry(P);
  if (!G.cracks) {
    // 冰白发光裂纹（eye 槽；比熔岩细纹窄一号，冰面裂纹读法）
    G.cracks = surfaceStrips(20260829, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.45, 0.04, 0.1, 0.58, 6, 0.016],
      [Math.PI - 0.45, 0.06, Math.PI - 0.08, 0.56, 6, 0.016],
      [Math.PI * 0.5, 0.08, Math.PI * 0.55, 0.60, 5, 0.018],
      [0.85, 0.30, 0.3, 0.44, 3, 0.011],
      [Math.PI - 0.85, 0.28, Math.PI - 0.25, 0.42, 3, 0.011],
    ]);
  }
  const rig = buildGolem(spec, mats, actor);
  const { add, count } = rig.tools;
  // 肩背冰锥簇（accent 半透明冰件；装饰 noHit）：冰塔剪影的「塔尖」读法
  const sp = prims(WRAP_TILES);
  for (const s of [-1, 1]) {
    sp.cyl(0, 0.05, 0.30, { x: s * P.shoulderX * 0.95, y: P.chestH * 1.02, z: -0.06, rx: -0.4, rz: -s * 0.5, radial: 5 });
    sp.cyl(0, 0.035, 0.20, { x: s * P.shoulderX * 0.7, y: P.chestH * 1.05, z: 0.08, rx: 0.2, rz: -s * 0.3, radial: 5 });
  }
  sp.cyl(0, 0.04, 0.26, { x: 0, y: P.chestH * 0.98, z: -0.24, rx: -0.7, radial: 5 });
  add(rig.torso, sp.build(), mats.accent, 'body', true);
  rig.triangles = count();
  return rig;
}

/** 冰霜材质：基底六槽照常，accent 槽（冰甲板/冰锥）换半透明冰 */
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
  height: 2.9,
  radius: 0.60,

  palette: {
    wrap: 0xc8d8e2,      // 苍白蓝冰岩
    wrapDark: 0x8aa2b2,  // 灰蓝冰
    deep: 0x1a2430,
    eye: 0xd8f4ff,       // 冰白发光（裂纹/目缝/核心同槽）
    eyeGlow: 0.8,
    accent: 0xbfe0f0,    // 半透明冰甲板/冰锥（makeFrostMaterials 换透明）
    accentRough: 0.25,
    accentMetal: 0.0,
    tatter: 0x8aa2b2,
  },

  proportions: {
    hipY: 1.04, hipW: 0.52, bodyD: 0.48,
    legX: 0.19, legW: 0.21, thighL: 0.51, shinL: 0.53,   // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.76, chestH: 0.74,
    torsoProfile: FROST_PROFILE,
    shoulderX: 0.43, shoulderY: 0.54, shoulderRockR: 0.16,
    armW: 0.15, upperL: 0.50, foreL: 0.54, fistW: 1.6,
    headY: 0.92, headW: 0.21, headH: 0.25, headD: 0.23,
    plateStyle: { w: 0.50, h: 0.42, t: 0.04 },
    crackMat: 'eye',
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.68,
    stride: 0.52,
    armSwing: 0.25,
    armReach: 0.04,
    armSplay: 0.28,
    elbowBend: -0.08,
    lean: -0.05,
    sway: 0.12,
    hipTwist: 0.05,
    bob: 0.08,
    headLoll: 0.05,
    headDroop: -0.08,
  },

  makeMaterials: makeFrostMaterials,
  build: buildFrostgolem,
  animate: golemAnimate,
};

// ---------------------------------------------------------------------------
// 物种四：水晶魔像 crystalgolem —— 紫晶悬浮（暗紫岩身 + 紫晶簇 + 悬浮碎晶环
// 绕肩缓转 + 半悬浮巨物：fly 悬浮支 flapAmp=0，石柱腿垂落，死亡走失速螺旋
// 坠落。装甲板同款四板机制）
// ---------------------------------------------------------------------------

const CRYSTAL_PROFILE = [[0.001, -0.02], [0.30, 0.02], [0.37, 0.22], [0.39, 0.44],
  [0.33, 0.62], [0.24, 0.72], [0.001, 0.76]];

function crystalGeometry(P) {
  const G = golemGeometry(P);
  if (G.ringShards) return G;
  const T = WRAP_TILES;
  if (!G.cracks) {
    // 紫青发光脉络（eye 槽）：比裂纹更直的「晶脉」读法（低抖动）
    G.cracks = surfaceStrips(20260830, makeBarrelSurf(mkRadiusFn(P.torsoProfile)), [
      [0.4, 0.06, 0.1, 0.60, 6, 0.014, 0.12],
      [Math.PI - 0.4, 0.08, Math.PI - 0.06, 0.58, 6, 0.014, 0.12],
      [Math.PI * 0.5, 0.10, Math.PI * 0.55, 0.58, 5, 0.016, 0.12],
      [0.9, 0.56, 1.25, 0.68, 3, 0.010, 0.12],
      [Math.PI - 0.9, 0.54, Math.PI - 1.25, 0.66, 3, 0.010, 0.12],
    ]);
  }
  {
    // 晶簇（accent 紫晶；肩/背锥簇，装饰 noHit）
    const p = prims(T);
    for (const s of [-1, 1]) {
      p.cyl(0, 0.055, 0.32, { x: s * P.shoulderX * 0.95, y: P.chestH * 1.0, z: 0.02, rx: -0.2, rz: -s * 0.55, radial: 5 });
      p.cyl(0, 0.04, 0.22, { x: s * P.shoulderX * 0.72, y: P.chestH * 0.94, z: -0.14, rx: -0.6, rz: -s * 0.25, radial: 5 });
      p.cyl(0, 0.030, 0.16, { x: s * P.shoulderX * 0.6, y: P.chestH * 0.8, z: 0.16, rx: 0.4, rz: -s * 0.4, radial: 4 });
    }
    p.cyl(0, 0.045, 0.28, { x: 0, y: P.chestH * 0.9, z: -0.26, rx: -0.75, radial: 5 });
    G.clusters = p.build();
  }
  {
    // 悬浮碎晶环（破布槽 spin 通道）：五片菱晶绕肩线一圈，pivot 局部系
    const p = prims(T);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const R = 0.62;
      // 菱形双锥（两段锥台对接）
      p.cyl(0, 0.045, 0.10, { x: Math.cos(a) * R, y: 0.055, z: Math.sin(a) * R, radial: 5, capBot: false });
      p.cyl(0.045, 0, 0.10, { x: Math.cos(a) * R, y: -0.055, z: Math.sin(a) * R, radial: 5, capTop: false });
    }
    G.ringShards = p.build();
  }
  return G;
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
  add(hips, G.pelvis, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.shoulderRock, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.cracks, mats.eye, 'body', true);              // 晶脉 noHit
  add(torso, G.clusters, mats.accent, 'body', true);         // 晶簇装饰 noHit
  const mc = add(torso, G.core, mats.eye, 'body');
  mc.userData.region = 'core';

  // 垂落的石柱腿（fly.legs 通道微摆）
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX * jw, 0, 0);
    hips.add(hip);
    add(hip, G.thigh, mats.wrap, 'body');
    const knee = new THREE.Group();
    knee.position.y = -P.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    legs.push({ hip, knee, side });
  }
  // 巨石臂（静态垂落，姿态烘进几何；flapAmp=0 时臂通道静默）
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
    add(elbow, G.fore, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });
  }

  // 装甲板四块（与行走魔像同契约：ARM2/EL2 槽）
  const rFn = mkRadiusFn(P.torsoProfile);
  const chestP = new THREE.Group();
  chestP.position.set(0, P.chestH * 0.60, rFn(P.chestH * 0.60) * jw + 0.035);
  torso.add(chestP);
  add(chestP, G.plateChest, mats.accent, 'body').userData.plate = true;
  const bellyP = new THREE.Group();
  bellyP.position.set(0, -P.chestH * 0.40, -0.02);
  chestP.add(bellyP);
  add(bellyP, G.plateBelly, mats.accent, 'body').userData.plate = true;
  const backP = new THREE.Group();
  backP.position.set(0, P.chestH * 0.60, -rFn(P.chestH * 0.60) * jw - 0.035);
  torso.add(backP);
  add(backP, G.plateBack, mats.accent, 'body').userData.plate = true;
  const mantleP = new THREE.Group();
  mantleP.position.set(0, P.chestH * 0.30, 0.02);
  backP.add(mantleP);
  add(mantleP, G.plateMantle, mats.accent, 'body').userData.plate = true;
  arms[2] = { shoulder: chestP, elbow: bellyP, side: -1 };
  arms[3] = { shoulder: backP, elbow: mantleP, side: 1 };

  // 头（岩颅 + 紫晶目缝）
  const neck = new THREE.Group();
  neck.position.y = P.headY;
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.brow, mats.wrapDark, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // 悬浮碎晶环：破布槽 spin 通道（fillFly/animateFlyer 双端同款）
  const tatters = [];
  {
    const pivot = new THREE.Group();
    pivot.position.set(0, P.chestH * 0.72, 0);
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
  height: 3.2,
  radius: 0.65,
  flyY: 0.9,             // 半悬浮：垂腿距地 ~0.3m（读作「浮不起来的巨物」）

  palette: {
    wrap: 0x4a4258,      // 暗紫岩身
    wrapDark: 0x342e40,  // 深紫岩
    deep: 0x16121e,
    eye: 0xb08aff,       // 紫青晶脉/目缝/核心同槽
    eyeGlow: 0.9,
    accent: 0x7a5ac8,    // 紫水晶簇/碎晶环/甲板
    accentRough: 0.35,
    accentMetal: 0.3,
    tatter: 0x342e40,
  },

  proportions: {
    hipW: 0.54, bodyD: 0.50,
    legX: 0.20, legW: 0.21, thighL: 0.50, shinL: 0.52,
    torsoY: 0.10, chestW: 0.78, chestH: 0.75,
    torsoProfile: CRYSTAL_PROFILE,
    shoulderX: 0.44, shoulderY: 0.55, shoulderRockR: 0.17,
    armW: 0.155, upperL: 0.50, foreL: 0.55, fistW: 1.7,
    headY: 0.97, headW: 0.21, headH: 0.25, headD: 0.23,
    plateStyle: { w: 0.52, h: 0.44, t: 0.045 },
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
      weave: 0.04, pitch: 0.02,   // 巨物姿态稳
      wingPairs: 0,
      legs: true, legDangle: 0.12, legBend: 0.25,   // 垂落石柱腿微摆
      headUp: -0.06, headScan: 0.3,
      hoverPitch: -0.03,
      hoverHeadUp: 0.10,          // 悬停低头俯视（精英的压迫感）
    },
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildCrystalgolem,
  animate: animateFlyer,
};
