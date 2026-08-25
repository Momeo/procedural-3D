/**
 * 亡灵/骷髅谱系（undead.js）：骷髅卒 skeltrooper / 骷髅猎犬 bonehound /
 * 怨灵 wraith / 尸巫 lich / 墓穴骑士 graveknight / 骸骨巨像 bonebrute。
 * 六剪影词互不冲突：瘦骨持械（杂兵）/ 低矮骨兽（快速四足）/ 破碎飘带
 * （半透明悬浮幽灵）/ 袍三角+杖（实体化施法者）/ 甲盒+盾剑（精英）/
 * 巨骨刺塔（Boss，scale 2.3 < draco 2.8）。
 *
 * 借与自写的分界（范式照 dragons.js / crawler_true.js 顶部契约）：
 *   - 借：parts()/tornStrip（core/anatomy.js）、contactShadow（core/contact.js）、
 *     WRAP_TILES/linenMaps（core/wraps.js）、prims（pipeline/prims.js）、
 *     mkActorTools/mirrorX/flyBlob/animateFlyer（flyers.js）、
 *     animateCentaurbot（robots.js）、makeZombieMaterialsFrom（zombies_ex.js）、
 *     MUMMY.animate（core/mummy.js 人形步态，经 MUMMY  spec 引用）。
 *   - 自写：骨骼人形 rig（buildBoneHumanoid，对齐 buildHumanoid 契约——
 *     hips/torso/neck + legs[{hip,knee}] + arms[{shoulder,elbow,bias}] +
 *     tatters/asym/lead/stepSpan/twistBase/neckBase，动画直用 MUMMY.animate
 *     与 gait.js 人形支，pipeline 一行未动）+ 骨感几何助手（strut 两点骨梁 /
 *     boneSeg 关节头细骨 / ribCage 肋笼 / skullGeo 骷髅头）+ 幽灵半透明材质
 *     （makeGhostMaterials，见「半透明取舍」段）。
 *
 * 骨感读法（骨架 vs parts() 盒子肉感）：细圆柱骨干 + 两端关节头膨大
 * （髁）是「骨」与「棍」的分界；小腿/前臂用双骨并排（胫腓骨/尺桡骨）；
 * 躯干不填肉——脊柱 + 肋笼镂空，剪影能读出身后背景。frost 冰龙是骨感
 * 龙（肋骨梁先例），本系是骨感人/兽，配色冷白灰骨 + 幽蓝/幽绿魂火，
 * 与 frost 的暖灰骨+冰蓝眼区分开（剪影更无从混淆）。
 *
 * 发光眼窝/魂火是本系标志读法，亮度克制（eyeGlow 0.5~0.85，draco 裂纹
 * 1.1 的先例之下）。装饰件（武器/盾/骨刺/獠牙/杖）一律 noHit。
 *
 * 半透明取舍（wraith）：wrap/wrapDark/deep/tatter 四槽 transparent +
 * depthWrite:false，opacity 0.42~0.55。三处兼容论证：
 *   1. 六材质槽不破：只是材质属性，槽位数不变，怪海 draw call 公式不动；
 *   2. instancing 路径：透明实例在同一 InstancedMesh 内不做逐实例深度排序
 *      （three 只按 mesh 排序）——depthWrite:false + 低 opacity 下，幽灵叠
 *      幽灵的错误读作「更亮更实」，方向正确可接受；叠不透明场景因不透明
 *      先写深度，遮挡关系正确；
 *   3. 受击闪白（vFlash 混白）与断肢塌缩都是顶点/片元内的局部操作，
 *      与透明度正交。
 *   弃选方案：additive 发光混合（在日光下洗白成雾，且丢失骨相细节）；
 *   镂空 alphaTest（破下摆已由 tatter 几何承担，不需要材质层镂空）。
 *   其余五种全不透明——半透明只给怨灵一种，是本系的「稀有色」。
 *
 * 猎犬步态：gait.kind='centaur' 复用半人马对角四足复算（矢状面摆腿 +
 * 膝向后折，符合犬腿；fillCentaurJoints 的臂通道对本种无臂 rig 静默——
 * 槽位无几何挂载，写入无害），单体侧 animateCentaurbot 对空 arms 数组
 * 同样安全。攻击 = 人形通道的仰身立起/前扑下压，读作扑咬。长尾 = 2 节
 * 链式破布槽（dragons 先例），但 centaur 支不写破布列——尾定格在 bind
 * 直伸姿态（几何内烘后翘弧度），属已知取舍。
 */

import * as THREE from 'three';
import { parts, tornStrip } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES, linenMaps } from '../core/wraps.js';
import { MUMMY } from '../core/mummy.js';
import { prims } from '../prims.js';
import { mkActorTools, flyBlob, animateFlyer } from './flyers.js';
import { animateCentaurbot } from './robots.js';
import { makeZombieMaterialsFrom } from './zombies_ex.js';

// ---------------------------------------------------------------------------
// 骨感几何助手（物种内共享，dragons.js 表面纹理助手的同位先例；
// 确证六种都吃这套读法才留在物种层，泛化到 pipeline/ 留给下一个需求方）
// ---------------------------------------------------------------------------

/** 两点间骨梁：cyl 局部 +Y 轴对准 a→b。欧拉 XYZ 序（M=Rx·Ry·Rz，z 先转），
 *  取 rz=acos(dy/len)、ry=atan2(dz,-dx) 即可覆盖任意方向（推导见本文件
 *  设计笔记；rx 恒 0）。golem.js 复用（导出不影响本文件内部引用）。 */
export function strut(p, a, b, r, radial = 5) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return;
  const c = Math.max(-1, Math.min(1, dy / len));
  p.cyl(r, r, len, {
    x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2,
    ry: Math.atan2(dz, -dx), rz: Math.acos(c), radial, capTop: false, capBot: false,
  });
}

/** 细骨肢段（prims 累积器内追加）：上端关节头膨大 + 骨干 + 下端髁——
 *  「骨」与「棍」的剪影分界就在这两处膨大。挂关节向下长，y∈[-len, 0]。 */
function boneSeg(p, len, r) {
  p.cyl(r * 1.55, r * 1.30, r * 1.7, { y: -r * 0.7, radial: 6 });          // 关节头
  p.cyl(r * 0.72, r * 0.66, len - r * 2.2, { y: -len / 2, radial: 6 });    // 骨干
  p.cyl(r * 1.05, r * 1.25, r * 1.8, { y: -len + r * 0.8, radial: 6 });    // 髁
}

/** 双骨肢段（小腿胫腓骨 / 前臂尺桡骨）：两条并排细骨 + 上下关节头。 */
function boneSegTwin(p, len, r, gap) {
  for (const s of [-1, 1]) {
    strut(p, [s * gap, -r * 1.2, 0], [s * gap * 0.7, -len + r * 1.4, 0], r * 0.52, 5);
  }
  p.cyl(r * 1.5, r * 1.3, r * 1.6, { y: -r * 0.7, radial: 6 });
  p.cyl(r * 1.0, r * 1.2, r * 1.7, { y: -len + r * 0.8, radial: 6 });
}

/** 肋笼（镂空躯干 = 骨感第一读法）：脊柱 + 椎节珠 + N 对肋（每侧两根
 *  骨梁：脊柱→体侧→胸骨）+ 胸骨 + 锁骨。坐标在 torso 局部系（y 0..chestH）。
 *  cfg: { ribN, ribR, drop（肋垂弧） } */
function ribCage(p, P, cfg = {}) {
  const W = P.chestW, H = P.chestH, D = P.bodyD;
  const r = cfg.ribR ?? P.boneR;
  // 脊柱 + 椎节珠
  p.cyl(r * 1.05, r * 0.95, H, { y: H * 0.5, z: -D * 0.30, radial: 6 });
  for (let k = 1; k <= 4; k++) {
    p.ellipsoid(r * 1.7, r * 1.3, r * 1.7, { y: H * k / 5, z: -D * 0.30, rings: 3, segs: 5 });
  }
  // 肋骨：中段最宽，底肋收窄（胸廓梯形的骨版）
  const n = cfg.ribN ?? 5;
  const drop = cfg.drop ?? 0.05;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const y = H * (0.30 + 0.58 * t);
    const w = W * (0.60 + 0.40 * Math.sin(Math.PI * (0.10 + 0.80 * t)));
    for (const s of [-1, 1]) {
      strut(p, [s * r * 1.2, y + 0.012, -D * 0.30], [s * w, y, -D * 0.02], r * 0.72);   // 后段
      strut(p, [s * w, y, -D * 0.02], [s * w * 0.42, y - drop, D * 0.34], r * 0.66);     // 前段（垂弧）
    }
  }
  // 胸骨（肋前端的纵梁）+ 锁骨横担
  const sy0 = H * 0.30 - drop, sy1 = H * 0.88 - drop;
  strut(p, [0, sy0, D * 0.34], [0, sy1, D * 0.36], r * 0.8, 5);
  strut(p, [-W * 0.86, H * 0.96, 0], [W * 0.86, H * 0.96, 0], r * 0.8, 5);
}

/** 骷髅头（neck 局部系，y 0..headH）：颅穹 + 颜面 + 下颌 + 颧弓 +
 *  眼窝暗板（deep 槽）+ 发光目（eye 槽）。返回 { skull, sockets, eyes, jaw } */
function skullGeo(T, P) {
  const W = P.headW, H = P.headH, D = P.headD;
  const out = {};
  {
    const p = prims(T);
    // 颅穹（额高颌窄的椭圆穹）+ 顶脊
    p.ellipsoid(W * 0.50, H * 0.46, D * 0.50, { y: H * 0.60, z: -D * 0.04, rings: 5, segs: 8 });
    p.ellipsoid(W * 0.30, H * 0.16, D * 0.34, { y: H * 0.86, z: -D * 0.02, rings: 3, segs: 6 });
    // 颜面（上颌骨）：前倾小台
    p.ellipsoid(W * 0.30, H * 0.20, D * 0.26, { y: H * 0.28, z: D * 0.30, rings: 3, segs: 6 });
    // 鼻甲小梁 + 颧弓
    strut(p, [0, H * 0.42, D * 0.50], [0, H * 0.26, D * 0.54], W * 0.045, 5);
    for (const s of [-1, 1]) {
      strut(p, [s * W * 0.10, H * 0.40, D * 0.46], [s * W * 0.44, H * 0.42, D * 0.16], W * 0.05, 5);
    }
    out.skull = p.build();
  }
  {
    // 下颌（wrapDark 槽，与颅骨分色读作「另一块骨头」）
    const pj = parts(T);
    pj.box(W * 0.56, H * 0.10, D * 0.52, { y: H * 0.06, z: D * 0.16, top: 0.9, bottom: 1.0 });
    // 下颌枝（耳前支）
    for (const s of [-1, 1]) {
      pj.box(W * 0.08, H * 0.30, D * 0.12, { x: s * W * 0.28, y: H * 0.16, z: D * 0.02, rx: 0.25, chamfer: 0.004 });
    }
    out.jaw = pj.build();
  }
  {
    // 眼窝暗板（deep 槽）：一条横板，比颅窄、比颜面前缘微凸——眼窝读作凹陷
    const p = parts(T);
    p.box(W * 0.80, H * 0.20, D * 0.10, { y: H * 0.52, z: D * 0.42, chamfer: 0.004 });
    out.sockets = p.build();
  }
  {
    // 发光目（eye 槽）：眼窝内两点魂火（比暗板面再凸出一线，防被吞没）
    const p = prims(T);
    for (const s of [-1, 1]) {
      p.ellipsoid(W * 0.085, H * 0.075, W * 0.07, { x: s * W * 0.20, y: H * 0.52, z: D * 0.475, rings: 3, segs: 6 });
    }
    out.eyes = p.build();
  }
  return out;
}

/** 武器/装饰小件通用：锈蚀刀（accent 槽，挂肘端，noHit 由装配处标） */
function rustSwordGeo(T, len, w) {
  const p = parts(T);
  p.box(w * 0.5, len * 0.16, w * 0.5, { y: -len * 0.02, chamfer: 0.004 });            // 柄
  p.box(w * 3.2, len * 0.05, w * 0.8, { y: -len * 0.12, chamfer: 0.004 });            // 镡
  p.box(w * 2.0, len * 0.80, w * 0.42, { y: -len * 0.12 - len * 0.42, top: 1.0, bottom: 0.12, chamfer: 0.005 });  // 刃（渐收成尖）
  return p.build();
}

// ---------------------------------------------------------------------------
// 骨骼人形 rig：buildHumanoid 契约的骨感重写（几何全换，骨架/抖动/动画契约
// 逐项对齐——动画直接吃 MUMMY.animate 与 gait.js 人形支，核心一行不改）。
// G = boneHumanoidGeometry(P) 按 proportions 记录缓存（同 mummy.js RIG_GEO）。
// 返回 rig 附 tools（mkActorTools 的 add/count），物种 build 后挂装饰件后
// 必须重算 rig.triangles = rig.tools.count()。
// ---------------------------------------------------------------------------

const BONEGEO = new Map();

function boneHumanoidGeometry(P) {
  let out = BONEGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  const r = P.boneR;
  {
    // 骨盆（wrapDark）：扁椭球髋骨 + 双髋臼 + 骶骨尾椎
    const p = prims(T);
    p.ellipsoid(P.hipW * 0.52, 0.085, P.bodyD * 0.46, { y: 0.02, rings: 4, segs: 8 });
    for (const s of [-1, 1]) {
      p.ellipsoid(0.045, 0.05, 0.045, { x: s * P.hipW * 0.42, y: -0.02, rings: 3, segs: 6 });
    }
    strut(p, [0, 0.04, -P.bodyD * 0.2], [0, -0.09, -P.bodyD * 0.30], r * 0.9, 5);
    out.pelvis = p.build();
  }
  {
    // 躯干骨（wrap）：肋笼整件（脊柱+肋+胸骨+锁骨）
    const p = prims(T);
    ribCage(p, P, P.cage || {});
    out.cage = p.build();
  }
  {
    // 大腿（单骨 + 股骨头/膝髁）
    const p = prims(T);
    boneSeg(p, P.thighL, r * 1.15);
    out.thigh = p.build();
  }
  {
    // 小腿（双骨）+ 足（跖骨片 + 跟结节）
    const p = prims(T);
    boneSegTwin(p, P.shinL, r, r * 0.85);
    const w = r * 2.4;
    const pf = parts(T);
    pf.box(w, 0.045, w * 2.6, { y: -P.shinL - 0.012, z: w * 0.8, top: 0.85, bottom: 1.0 });
    pf.box(w * 0.7, 0.05, w * 0.8, { y: -P.shinL - 0.005, z: -w * 0.6, chamfer: 0.004 });
    out.shin = mergeGeos([p.build(), pf.build()]);
  }
  {
    // 上臂（单骨 + 肩肱骨头）
    const p = prims(T);
    boneSeg(p, P.upperL, r * 0.95);
    out.upper = p.build();
  }
  // 前臂（双骨）+ 手（掌骨片 + 三节指骨爪，分侧建——负 scale 镜像翻绕向不可用）
  for (const side of [-1, 1]) {
    const p = prims(T);
    boneSegTwin(p, P.foreL, r * 0.82, r * 0.72);
    const hy = -P.foreL;
    // 掌骨
    const pp = parts(T);
    pp.box(r * 2.6, r * 3.2, r * 1.6, { y: hy - r * 1.6, z: r * 0.3, top: 1.0, bottom: 0.9 });
    const g1 = p.build(), g2 = pp.build();
    // 指骨三根（前扣爪）：strut 两节
    const pf = prims(T);
    for (const k of [-1, 0, 1]) {
      const x0 = k * r * 0.95, y0 = hy - r * 3.1;
      strut(pf, [x0, y0, r * 0.5], [x0 * 1.15, y0 - r * 1.7, r * 1.3], r * 0.34, 4);
      strut(pf, [x0 * 1.15, y0 - r * 1.7, r * 1.3], [x0 * 1.2, y0 - r * 2.6, r * 0.9], r * 0.30, 4);
    }
    out[side < 0 ? 'foreL' : 'foreR'] = mergeGeos([g1, g2, pf.build()]);
  }
  Object.assign(out, skullGeo(T, P));
  BONEGEO.set(P, out);
  return out;
}

/** 极简几何合并（同材质同关节的组件并成一个 BufferGeometry；bake 按材质
 *  再合并一次，这里只为省 mesh 数。只读 position/normal/uv，与 bake 契约一致）。 */
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let off = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    uv.set(g.attributes.uv.array, off * 2);
    off += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function buildBoneHumanoid(spec, mats, actor) {
  const P = spec.proportions;
  const G = boneHumanoidGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  // R = 逐实例随机：本函数只经 spec.build 在工厂（createZombieEx）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();

  // 逐实例抖动方案照抄 buildHumanoid 的分布（gait.js makeGaitParams 复算侧
  // 同款分布，怪海个体差才能与人形种一致）
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
    tilt: (R() - 0.5) * 0.34,
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

  // 双腿（站位一前一后，非台架立正——buildHumanoid 同款读法）
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

  // 躯干（肋笼）+ 永久脊柱扭转（动画每帧写 torso.y，扭转底数在这里）
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  torso.rotation.y = asym.reach * 0.85;
  hips.add(torso);
  add(torso, G.cage, mats.wrap, 'body').scale.set(j.chestW, j.chest, j.chestW);

  // 双臂（lead 侧更外更前，bias 进动画契约）
  const arms = [];
  for (const side of [-1, 1]) {
    const w = side === lead ? 1.11 : 0.93;
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.shoulderX * j.chestW * w,
      P.shoulderY * j.chest + side * asym.droop,
      side === lead ? P.shoulderX * 0.20 : -P.shoulderX * 0.12);
    torso.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body').scale.set(j.girth, j.arm, j.girth);
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL * j.arm;
    shoulder.add(elbow);
    add(elbow, side < 0 ? G.foreL : G.foreR, mats.wrapDark, 'body')
      .scale.set(j.girth, j.arm, j.girth);
    arms.push({ shoulder, elbow, side, bias: side * asym.reach });
  }

  // 头（骷髅三件套 + 发光目；neck 抖动缩放同人形契约）
  const neck = new THREE.Group();
  neck.position.set(0, P.headY * j.chest, P.headZ || 0);
  neck.scale.setScalar(j.head);
  neck.rotation.y = -asym.reach * 1.15;
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.jaw, mats.wrapDark, 'head');
  add(neck, G.sockets, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // 破布（残余裹尸布/衣物；确定性全保留——烘焙共享几何的前提是数量恒定）
  const tatters = [];
  for (const t of (P.tatters || [])) {
    const pivot = new THREE.Group();
    pivot.position.set(t.x * j.chestW, (t.y || 0) * j.chest, t.z || 0);
    pivot.rotation.y = (t.yaw || 0) + (R() - 0.5) * 0.5;
    const restZ = (t.out || 0) * (t.x < 0 ? -1 : 1);
    pivot.rotation.z = restZ;
    (t.on === 'arm' ? arms[t.side > 0 ? 1 : 0].elbow : torso).add(pivot);
    const m = new THREE.Mesh(tornStrip(t.w, t.h, t.cut || 0, 7, WRAP_TILES), mats.tatter);
    m.scale.set(0.82 + R() * 0.4, 0.8 + R() * 0.45, 1);
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);
    meshes.push(m);
    tatters.push({ pivot, restZ, phase: R() * 6.283, swing: (t.swing ?? 1) * gait.swing });
  }

  const blob = contactShadow((spec.radius ?? 0.45) * 1.75);
  blob.position.y = 0.03;
  group.add(blob);

  const rig = {
    group, body, hips, torso, neck, legs, arms, tatters, meshes,
    triangles: 0, asym, gait, lead, blob,
    stepSpan: 2 * ((P.thighL || 0.44) + (P.shinL || 0.48)) * j.leg,
    twistBase: torso.rotation.y,
    neckBase: neck.rotation.y,
    tools: { add, count },          // 物种后挂装饰用（非公契约字段）
  };
  rig.triangles = count();
  return rig;
}

// ---------------------------------------------------------------------------
// 物种一：骷髅卒 skeltrooper —— 瘦骨持械（基础杂兵：纤细骨架 + 锈蚀刀 +
// 腰间残余裹布；幽绿魂火眼）
// ---------------------------------------------------------------------------

export function buildSkeltrooper(spec, mats, actor) {
  const rig = buildBoneHumanoid(spec, mats, actor);
  const { add, count } = rig.tools;
  // 锈蚀刀挂右手（肘端 = 手下缘；noHit 细长装饰件铁律——不撑前臂盒）
  add(rig.arms[1].elbow, rustSwordGeo(WRAP_TILES, 0.62, 0.030), mats.accent, 'arm', true)
    .position.set(0, -spec.proportions.foreL - 0.05, 0.02);
  rig.triangles = count();
  return rig;
}

export const SKELTROOPER = {
  id: 'skeltrooper',
  name: 'Skeltrooper（骷髅卒）',

  speed: 1.3,
  scale: 1.0,
  height: 1.8,
  radius: 0.38,

  palette: {
    wrap: 0xd6d0bc,      // 冷白灰骨（linen 中性基底才挂得上这口冷白）
    wrapDark: 0x8f887a,  // 灰骨（小腿/前臂/下颌/骨盆）
    deep: 0x14161c,      // 冷黑眼窝
    eye: 0x8cffb4,       // 幽绿魂火（卒/猎犬/巨像同色系，wraith 更亮一档）
    eyeGlow: 0.6,
    accent: 0x6e4f30,    // 锈蚀刀（accentMetal 半金属：锈不是亮铁）
    accentRough: 0.62,
    accentMetal: 0.45,
    tatter: 0x5a5348,    // 残余裹布
  },

  proportions: {
    hipY: 0.92, hipW: 0.30, bodyD: 0.24, boneR: 0.020,
    legX: 0.10, thighL: 0.45, shinL: 0.47,          // hipY=thighL+shinL，铁律
    torsoY: 0.11, chestW: 0.36, chestH: 0.52,
    cage: { ribN: 5, drop: 0.05 },
    shoulderX: 0.235, shoulderY: 0.46, upperL: 0.40, foreL: 0.42,
    headY: 0.60, headW: 0.19, headH: 0.24, headD: 0.21,
    tatterRest: 0.30,
    tatters: [
      // 腰间一截裹尸布残片 + 肩上一条
      { on: 'torso', x: 0.06, y: -0.02, z: 0.03, w: 0.26, h: 0.42, yaw: 0.3, cut: 1, swing: 0.8, out: 0.16 },
      { on: 'torso', x: -0.14, y: 0.30, z: -0.10, w: 0.16, h: 0.48, yaw: -0.5, cut: 2, swing: 1.1, out: 0.20 },
    ],
  },

  gait: {
    rate: 0.9,
    stride: 0.52,
    armSwing: 0.30,
    armReach: -0.18,     // 持刀手不前伸（刀垂握）；差异由 asym.reach 承担
    armSplay: 0.16,
    elbowBend: -0.12,
    lean: -0.14,         // 微佝：骨架没有要藏的佝偻肉，挺一点才读得出「架子」
    sway: 0.15,
    hipTwist: 0.08,
    bob: 0.05,
    headLoll: 0.10,
    headDroop: -0.04,
  },

  // 冷白灰骨上彩色防染同款：腐肉 fleshMaps 偏绿会乘染骨白，换 linen 中性基底
  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildSkeltrooper,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种二：骷髅猎犬 bonehound —— 低矮骨兽（快速四足：横放肋笼 + 吻颅 +
// 四细腿 + 骨尾两节；gait.kind='centaur' 矢状面四足，arms 空表）
// ---------------------------------------------------------------------------

const HOUNDGEO = new Map();

function houndGeometry(P) {
  let out = HOUNDGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  const r = P.boneR;
  {
    // 躯干：水平脊柱 + 肋笼（横放版，肋骨弧朝腹下）+ 肩胛/骨盆结节
    const p = prims(T);
    const D = P.torsoD, W = P.torsoW, H = P.torsoH;
    strut(p, [0, H * 0.30, -D * 0.5], [0, H * 0.34, D * 0.42], r * 1.0, 6);   // 脊柱（沿背线）
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = -D * 0.28 + t * D * 0.62;
      const w = W * (0.55 + 0.45 * Math.sin(Math.PI * (0.15 + 0.7 * t)));
      for (const s of [-1, 1]) {
        strut(p, [s * r, H * 0.32, z], [s * w, H * 0.10, z + D * 0.02], r * 0.7);
        strut(p, [s * w, H * 0.10, z + D * 0.02], [s * w * 0.30, -H * 0.42, z + D * 0.05], r * 0.62);
      }
    }
    // 腹下胸骨纵梁
    strut(p, [0, -H * 0.44, -D * 0.20], [0, -H * 0.46, D * 0.34], r * 0.7, 5);
    out.cage = p.build();
  }
  {
    // 骨盆 + 肩胛板（wrapDark 分色）
    const p = prims(T);
    p.ellipsoid(P.torsoW * 0.52, P.torsoH * 0.42, P.torsoD * 0.16, { z: -P.torsoD * 0.44, y: P.torsoH * 0.18, rings: 4, segs: 6 });
    out.pelvis = p.build();
    const ps = prims(T);
    for (const s of [-1, 1]) {
      // 肩胛骨：两片斜立的扁三角读法（扁椭球压出来）
      ps.ellipsoid(0.016, P.torsoH * 0.55, P.torsoD * 0.16,
        { x: s * P.torsoW * 0.34, y: P.torsoH * 0.30, z: P.torsoD * 0.28, rz: s * 0.25, rings: 3, segs: 5 });
    }
    out.scapula = ps.build();
  }
  {
    // 头颈（neck 局部系，+Z 朝前）：颈骨斜前伸 + 颅 + 长吻 + 獠牙 + 发光目
    const p = prims(T);
    p.cyl(r * 1.1, r * 1.3, 0.16, { rx: Math.PI / 2 - 0.35, y: 0.03, z: 0.06, radial: 6 });
    out.neckSeg = p.build();

    const ps = prims(T);
    ps.ellipsoid(0.070, 0.062, 0.075, { y: 0.085, z: 0.16, rings: 4, segs: 7 });
    out.skull = ps.build();

    const pn = prims(T);
    pn.cyl(0.020, 0.042, 0.15, { rx: Math.PI / 2 + 0.12, y: 0.055, z: 0.30, radial: 6 });   // 吻
    // 獠牙四颗（吻端下扣；短粗件并头盒——是脸的一部分不是天线）
    for (const s of [-1, 1]) {
      pn.cyl(0, 0.008, 0.035, { x: s * 0.020, y: 0.010, z: 0.355, rx: Math.PI - 0.25, radial: 4 });
      pn.cyl(0, 0.006, 0.028, { x: s * 0.014, y: 0.045, z: 0.365, rx: 0.3, radial: 4 });
    }
    out.snout = pn.build();

    const pe = prims(T);
    for (const s of [-1, 1]) pe.ellipsoid(0.016, 0.014, 0.012, { x: s * 0.042, y: 0.095, z: 0.205, rings: 3, segs: 5 });
    out.eyes = pe.build();
  }
  {
    // 腿：前腿（肩下）与后腿（髋下，大腿更壮）分两套骨
    const pf = prims(T);
    boneSeg(pf, P.upperL, r * 0.9);                       // 前臂骨（前腿上段）
    out.frontUp = pf.build();
    const pfl = prims(T);
    boneSegTwin(pfl, P.foreL, r * 0.72, r * 0.55);
    out.frontLo = pfl.build();
    const pt = prims(T);
    pt.cyl(r * 1.6, r * 1.1, P.thighL * 0.55, { y: -P.thighL * 0.28, radial: 6 });   // 后腿股骨肉垫（骨盆肌）
    boneSeg(pt, P.thighL, r * 1.0);
    out.rearUp = pt.build();
    const pr = prims(T);
    boneSegTwin(pr, P.shinL, r * 0.75, r * 0.55);
    out.rearLo = pr.build();
    // 爪（四腿共用小掌片）
    const pw = parts(T);
    pw.box(r * 2.6, 0.03, r * 3.6, { y: -0.015, z: r * 1.0, top: 0.8, bottom: 1.0 });
    out.paw = pw.build();
  }
  {
    // 骨尾两节（破布槽链式 pivot；centaur 支不写破布列，定格 bind 直伸——
    // 后翘弧度烘进几何）
    const p1 = prims(T);
    p1.cyl(r * 0.55, r * 0.8, 0.17, { rx: -Math.PI / 2 + 0.45, y: 0.035, z: -0.075, radial: 5 });
    out.tail1 = p1.build();
    const p2 = prims(T);
    p2.cyl(r * 0.30, r * 0.52, 0.15, { rx: -Math.PI / 2 + 0.30, y: 0.020, z: -0.068, radial: 5 });
    out.tail2 = p2.build();
  }
  HOUNDGEO.set(P, out);
  return out;
}

export function buildBonehound(spec, mats, actor) {
  const P = spec.proportions;
  const G = houndGeometry(P);
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = P.rideHeight;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const jw = 0.92 + R() * 0.16;
  add(torso, G.cage, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.pelvis, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.scapula, mats.wrapDark, 'body').scale.set(jw, 1, 1);

  // 头：颈关节扛抬起角（动画每帧写 headDroop，同 centaur 契约）
  const neck = new THREE.Group();
  neck.position.set(0, P.torsoH * 0.30, P.torsoD * 0.48);
  torso.add(neck);
  add(neck, G.neckSeg, mats.wrap, 'head', true);    // 颈节 noHit（不撑头盒）
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.snout, mats.wrapDark, 'head');
  add(neck, G.eyes, mats.eye, 'head');

  // 四腿：centaur 槽位约定 legs[0..1] = 前对（HIP/KNEE）、legs[2..3] = 后对
  // （LEG2）；外张/后掠全走静态 mount 烘进几何，注册关节只扛步态。
  const legs = [];
  for (const side of [-1, 1]) {
    // 前腿：肩胛下，近垂直
    const mountF = new THREE.Group();
    mountF.position.set(side * P.torsoW * 0.42 * jw, -P.torsoH * 0.05, P.torsoD * 0.30);
    mountF.rotation.z = side * 0.10;
    torso.add(mountF);
    const hipF = new THREE.Group();
    mountF.add(hipF);
    add(hipF, G.frontUp, mats.wrap, 'body');
    const kneeF = new THREE.Group();
    kneeF.position.y = -P.upperL;
    hipF.add(kneeF);
    add(kneeF, G.frontLo, mats.wrapDark, 'body');
    add(kneeF, G.paw, mats.wrapDark, 'body').position.y = -P.foreL;
    legs.push({ hip: hipF, knee: kneeF, side });

    // 后腿：骨盆下，略后掠（犬科站式）
    const mountR = new THREE.Group();
    mountR.position.set(side * P.torsoW * 0.40 * jw, -P.torsoH * 0.02, -P.torsoD * 0.40);
    mountR.rotation.z = side * 0.12;
    mountR.rotation.x = 0.18;
    torso.add(mountR);
    const hipR = new THREE.Group();
    mountR.add(hipR);
    add(hipR, G.rearUp, mats.wrap, 'body');
    const kneeR = new THREE.Group();
    kneeR.position.y = -P.thighL;
    hipR.add(kneeR);
    add(kneeR, G.rearLo, mats.wrapDark, 'body');
    add(kneeR, G.paw, mats.wrapDark, 'body').position.y = -P.shinL;
    legs.push({ hip: hipR, knee: kneeR, side });
  }

  // 骨尾：2 节链式破布 pivot（tail2 挂 tail1 末端；noHit，不进碰撞盒）
  const tatters = [];
  {
    const p1 = new THREE.Group();
    p1.position.set(0, P.torsoH * 0.28, -P.torsoD * 0.52);
    torso.add(p1);
    add(p1, G.tail1, mats.wrapDark, 'body', true);
    const p2 = new THREE.Group();
    p2.position.set(0, 0.07, -0.145);
    p1.add(p2);
    add(p2, G.tail2, mats.wrapDark, 'body', true);
    tatters.push({ pivot: p1, restZ: 0, phase: R() * 6.283, swing: 1 });
    tatters.push({ pivot: p2, restZ: 0, phase: R() * 6.283, swing: 1 });
  }

  const blob = contactShadow((spec.radius ?? 0.4) * 1.8);
  blob.position.y = 0.02;
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms: [], tatters, meshes,
    triangles: count(), asym, lead: 1, blob,
    // 对角对一步的地面覆盖：四腿平均展开长（strideRate 步频推导用）
    stepSpan: 2 * ((P.upperL + P.foreL + P.thighL + P.shinL) / 4) * 0.85,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const BONEHOUND = {
  id: 'bonehound',
  name: 'Bonehound（骷髅猎犬）',

  speed: 3.4,            // 全 roster 最快（快过 runner 3.0）——猎犬的玩法角色就是速度
  scale: 0.85,
  height: 0.9,
  radius: 0.42,

  palette: {
    wrap: 0xd0cab6,      // 冷白灰骨（比卒偏暖一丝，群居走兽与士兵分开）
    wrapDark: 0x87816f,
    deep: 0x13151a,
    eye: 0x8cffb4,       // 幽绿魂火（与卒同系）
    eyeGlow: 0.65,
    accent: 0x6e4f30,
    tatter: 0x5a5348,
  },

  proportions: {
    rideHeight: 0.50,                       // 低伏但不贴地（crawler 是 0.34 贴地）
    torsoW: 0.24, torsoH: 0.24, torsoD: 0.58, boneR: 0.017,
    upperL: 0.26, foreL: 0.24, thighL: 0.28, shinL: 0.26,
    headH: 0.16,                            // 头部件总高参考（黄点探针契约字段）
    tatterRest: 0,
    // 尾两节（破布槽契约字段；x 仅用于 restZ 符号，本种 restZ 恒 0）
    tatters: [{ x: 0, yaw: 0, out: 0, swing: 1 }, { x: 0, yaw: 0, out: 0, swing: 1 }],
  },

  gait: {
    kind: 'centaur',     // 矢状面对角四足（fillCentaurJoints / animateCentaurbot）
    rate: 1.25,
    stride: 0.72,        // 大跨幅小快步=跑犬读法
    knBend: 0.42,        // 膝静止后折角（动画每帧还原）
    flex: 0.55,          // 摆动收拢
    bob: 0.045,
    swayRoll: 0.06, swayYaw: 0.10,
    lean: 0.02,
    headDroop: -0.30,    // 头抬平前视（-x = 抬起）
    headScan: 0.35,
    // 臂通道对本种无几何挂载（静默），但 fillCentaurJoints 攻击支会读这些字段
    // ——必须给齐，否则 windup 时四元数写 NaN 进纹理行（空槽，无害但不干净）
    armReach: 0, armSplay: 0, elBend: 0, armSwing: 0,
    arm2Reach: 0, arm2Splay: 0, el2Bend: 0, arm2Swing: 0,
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildBonehound,
  animate: animateCentaurbot,   // arms 空数组：臂循环零迭代，安全复用
};

// ---------------------------------------------------------------------------
// 幽灵半透明材质（wraith 专用；六槽契约不变——只是属性，不是新槽）
// ---------------------------------------------------------------------------

function makeGhostMaterials(spec, rng) {
  const dh = (rng() - 0.5) * 0.04;
  const dl = (rng() - 0.5) * 0.08;
  const ghost = (hex, opacity) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex).offsetHSL(dh, 0, dl),
    transparent: true,
    opacity,
    depthWrite: false,          // 透明幽灵不写深度：叠不透明场景遮挡正确，
                                // 幽灵叠幽灵读作「更亮更实」，方向可接受
    roughness: 0.55,
    metalness: 0.0,
    emissive: new THREE.Color(hex).multiplyScalar(0.16),   // 幽体自发光底线
  });
  const wrap = ghost(spec.palette.wrap, 0.55);
  const wrapDark = ghost(spec.palette.wrapDark, 0.46);
  const deep = ghost(spec.palette.deep, 0.62);
  const eye = new THREE.MeshStandardMaterial({
    color: 0x10181c,
    roughness: 0.5,
    metalness: 0.0,
    emissive: spec.palette.eye,
    emissiveIntensity: spec.palette.eyeGlow ?? 0.7,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: spec.palette.accent, roughness: 0.7, metalness: 0.0,
  });
  const tatter = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.palette.tatter).offsetHSL(dh, 0, dl),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,          // tornStrip 带 color attribute 的契约
    emissive: new THREE.Color(spec.palette.tatter).multiplyScalar(0.10),
  });
  // 双面透明在 three 里默认分两次渲染（背面一遍正面一遍）——怪海里会破
  // 「calls = Σparts+2」契约（每种 +1）。强制单遍：薄片飘带的内部正背
  // 排序损失在这种尺寸下读不出来
  tatter.forceSinglePass = true;
  return { wrap, wrapDark, deep, eye, accent, tatter };
}

// ---------------------------------------------------------------------------
// 悬浮种共享 rig（wraith/lich，fly 悬浮支契约）：hips=flyY 烘进几何；
// 双臂注册 SH/EL 槽但 flapAmp=0 时动画不接管——前伸持物姿态由静态 mount
// 扛（烘进几何，注册关节恒零旋转）。tatters 由 fillFly/animateFlyer 写
// （下摆飘带的漂移感全靠它）。
// ---------------------------------------------------------------------------

function buildGhostRig(spec, mats, actor, G, D) {
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = spec.flyY;                 // 悬浮高度（bake 保留进几何）
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const jw = 0.94 + R() * 0.12;
  if (G.cage) add(torso, G.cage, mats.wrap, 'body').scale.set(jw, 1, 1);
  if (G.robe) add(torso, G.robe, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  if (G.soulFire) add(torso, G.soulFire, mats.eye, 'body');          // 胸口魂火
  if (G.pelvis) add(hips, G.pelvis, mats.wrapDark, 'body').scale.set(jw, 1, 1);

  // 头：颅 + 眼窝 + 魂火目（+ 尸巫的兜帽）
  const neck = new THREE.Group();
  neck.position.set(0, D.neckY, D.neckZ);
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  if (G.jaw) add(neck, G.jaw, mats.wrapDark, 'head');
  add(neck, G.sockets, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');
  if (G.hood) add(neck, G.hood, mats.wrapDark, 'head');   // 兜帽贴颅不撑盒太多，保留判定

  // 双臂：mount 扛前伸角（静态烘进几何），注册关节恒零（flapAmp=0 不写臂列）
  const arms = [];
  for (const side of [-1, 1]) {
    const mount = new THREE.Group();
    mount.position.set(side * D.shoulderX * jw, D.shoulderY, 0);
    mount.rotation.x = D.armMountRx;             // 前伸/拢袍姿态
    mount.rotation.z = side * (D.armMountRz ?? 0.10);
    torso.add(mount);
    const shoulder = new THREE.Group();
    mount.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -D.upperL;
    shoulder.add(elbow);
    add(elbow, side < 0 ? G.foreL : G.foreR, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });
  }

  // 下摆飘带 / 袖摆（破布槽；proportions.tatters 的 px/pz/yaw 定位，其余
  // 字段（x/out/swing）走 makeGaitParams 契约）
  const tatters = [];
  for (const t of spec.proportions.tatters) {
    const pivot = new THREE.Group();
    pivot.position.set(t.px || 0, t.py || 0, t.pz || 0);
    pivot.rotation.y = t.yaw || 0;
    pivot.rotation.z = (t.out || 0) * ((t.x || 0) < 0 ? -1 : 1);
    (t.on === 'arm' ? arms[t.side > 0 ? 1 : 0].elbow : (t.on === 'hips' ? hips : torso)).add(pivot);
    const m = new THREE.Mesh(tornStrip(t.w, t.h, t.cut || 0, 6, WRAP_TILES), mats.tatter);
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);
    meshes.push(m);
    tatters.push({ pivot, restZ: pivot.rotation.z, phase: R() * 6.283, swing: t.swing ?? 1 });
  }

  const blob = flyBlob(spec, (spec.radius ?? 0.4) * 1.8);
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  const rig = {
    group, body, hips, torso, neck, legs: [], arms, tatters, meshes,
    triangles: 0, asym, lead: 1, blob,
    // 不声明 stepSpan：悬浮种走 (0.8+speed·rate) 常量支 = 悬浮时钟
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
    tools: { add, count },
  };
  rig.triangles = count();
  return rig;
}

// ---------------------------------------------------------------------------
// 物种三：怨灵 wraith —— 破碎飘带（半透明幽体：镂空肋笼悬在半空，无腿，
// 下摆六条破碎飘带拖出「没有下半身」的读法；幽绿魂火最亮的一档）
// ---------------------------------------------------------------------------

const WRAITHGEO = new Map();

function wraithGeometry(P) {
  let out = WRAITHGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  const r = P.boneR;
  {
    // 半身肋笼（镂空幽体上身：比人形少两条底肋，下摆直接断进飘带）
    const p = prims(T);
    ribCage(p, P, { ribN: 4, drop: 0.06 });
    out.cage = p.build();
  }
  {
    // 残骨盆（半截，髋以下消失——幽灵没有腿这件事的第一读点）
    const p = prims(T);
    p.ellipsoid(P.hipW * 0.5, 0.06, P.bodyD * 0.42, { y: 0.0, rings: 3, segs: 6 });
    out.pelvis = p.build();
  }
  {
    const p = prims(T);
    boneSeg(p, P.upperL, r * 0.95);
    out.upper = p.build();
  }
  for (const side of [-1, 1]) {
    const p = prims(T);
    boneSegTwin(p, P.foreL, r * 0.8, r * 0.7);
    // 鬼爪：三节长指（比人形手长一倍，怨灵的「抓」读法）
    const hy = -P.foreL;
    for (const k of [-1, 0, 1]) {
      const x0 = k * r * 1.0;
      strut(p, [x0, hy, 0], [x0 * 1.3, hy - r * 2.2, r * 1.2], r * 0.36, 4);
      strut(p, [x0 * 1.3, hy - r * 2.2, r * 1.2], [x0 * 1.5, hy - r * 4.0, r * 0.8], r * 0.30, 4);
      strut(p, [x0 * 1.5, hy - r * 4.0, r * 0.8], [x0 * 1.55, hy - r * 5.4, r * 0.2], r * 0.24, 4);
    }
    out[side < 0 ? 'foreL' : 'foreR'] = p.build();
  }
  Object.assign(out, skullGeo(T, P));
  WRAITHGEO.set(P, out);
  return out;
}

export function buildWraith(spec, mats, actor) {
  const P = spec.proportions;
  const G = wraithGeometry(P);
  return buildGhostRig(spec, mats, actor, G, {
    neckY: P.chestH + 0.06, neckZ: 0.02,
    shoulderX: P.chestW * 0.62, shoulderY: P.chestH * 0.92,
    armMountRx: -0.72,           // 双臂前伸抓扑姿态（静态烘进几何）
    armMountRz: 0.14,
    upperL: P.upperL,
  });
}

export const WRAITH = {
  id: 'wraith',
  name: 'Wraith（怨灵）',

  speed: 1.6,
  scale: 1.05,
  height: 1.5,
  radius: 0.40,
  flyY: 1.05,            // 悬浮高：下摆飘带梢扫过头顶高度带的下缘

  palette: {
    wrap: 0xc4dce2,      // 幽白青（半透明材质着色；保持低饱和，叠加不糊）
    wrapDark: 0x7c98a4,  // 幽体暗部
    deep: 0x0c1418,      // 眼窝深洞（半透明，透出背后）
    eye: 0x9dffc8,       // 幽绿魂火（本系最亮一档——幽灵的唯一实体感来源）
    eyeGlow: 0.85,
    accent: 0x8f887a,
    tatter: 0x8fb2bc,    // 下摆飘带（同体色浅一档）
  },

  proportions: {
    hipW: 0.26, bodyD: 0.22, boneR: 0.017,
    chestW: 0.32, chestH: 0.46,
    upperL: 0.34, foreL: 0.34,
    headW: 0.18, headH: 0.23, headD: 0.20,
    tatterRest: 0.10,
    tatters: [
      // 下摆六条破碎飘带（挂 hips 底圈，围一圈；yaw 切向、out 外撇）
      { on: 'hips', px: 0.10, py: -0.04, pz: 0.02, x: 0.10, yaw: 0.2, w: 0.15, h: 0.62, cut: 1, swing: 1.2, out: 0.22 },
      { on: 'hips', px: -0.10, py: -0.04, pz: 0.02, x: -0.10, yaw: -0.2, w: 0.14, h: 0.56, cut: 2, swing: 1.1, out: 0.22 },
      { on: 'hips', px: 0.05, py: -0.05, pz: -0.09, x: 0.05, yaw: 2.4, w: 0.16, h: 0.70, cut: 0, swing: 1.3, out: 0.10 },
      { on: 'hips', px: -0.05, py: -0.05, pz: -0.09, x: -0.05, yaw: -2.4, w: 0.15, h: 0.66, cut: 1, swing: 1.25, out: 0.10 },
      { on: 'hips', px: 0.0, py: -0.03, pz: 0.10, x: 0.01, yaw: 3.1, w: 0.13, h: 0.50, cut: 2, swing: 1.0, out: 0.12 },
      // 右袖口一条袖摆（攻击扑抓时甩动）
      { on: 'arm', side: 1, px: 0, py: -0.30, pz: 0, x: 0.01, yaw: 0.6, w: 0.12, h: 0.34, cut: 1, swing: 1.4, out: 0.15 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 3.9,           // (TAU·0.9 - 0.8) / 1.6：悬浮时钟 0.9Hz（无拍翅）
    fly: {
      flapRate: 0,       // 无翼悬浮（时钟兜底 0.9Hz，fillFly 除零护栏）
      flapAmp: 0,
      bobAmp: 0.09, bobRate: 0.9,
      weave: 0.10, pitch: 0.05,
      wingPairs: 0,
      headUp: -0.08, headScan: 0.45,
      hoverPitch: -0.06,     // 悬停微仰（逼近时上身直起盯人）
      hoverHeadUp: 0.10,
    },
  },

  makeMaterials: makeGhostMaterials,
  build: buildWraith,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种四：尸巫 lich —— 袍三角+杖（实体化的施法者：罩袍剪影 + 兜帽 +
// 胸口魂火 + 骨杖；幽蓝魂火与 wraith 的幽绿分家，悬浮更低更稳）
// ---------------------------------------------------------------------------

const LICHGEO = new Map();

function lichGeometry(P) {
  let out = LICHGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  const r = P.boneR;
  {
    // 罩袍（wrapDark 槽）：lathe 自肩线向下张开成 A 字三角——袍子是本种剪影词，
    // 下摆不封口（敞口，魂火与飘带从下摆里透出）
    const p = prims(T);
    p.lathe([
      [0.30, -0.62], [0.26, -0.42], [0.20, -0.18], [0.165, 0.06],
      [0.155, 0.26], [0.13, 0.40], [0.05, 0.47],
    ], { segs: 10 });
    // 肩部斗篷翻领
    p.lathe([
      [0.19, 0.30], [0.165, 0.40], [0.10, 0.46],
    ], { segs: 10 });
    out.robe = p.build();
  }
  {
    // 胸口魂火（eye 槽）：袍襟前的一点幽蓝（比袍面凸出一线，防被吞没）
    const p = prims(T);
    p.ellipsoid(0.042, 0.052, 0.030, { y: 0.16, z: 0.155, rings: 4, segs: 7 });
    // 火苗尾（上挑小锥）
    p.cyl(0, 0.016, 0.06, { y: 0.24, z: 0.150, rx: -0.2, radial: 5 });
    out.soulFire = p.build();
  }
  {
    // 半身肋笼（袍内撑形；被袍罩住大半，剪影主要靠袍）
    const p = prims(T);
    ribCage(p, P, { ribN: 3, drop: 0.04 });
    out.cage = p.build();
  }
  {
    const p = prims(T);
    boneSeg(p, P.upperL, r * 0.95);
    // 袖袍（wrapDark 槽的手肘以下罩袖——嗽叭口，与前臂骨同挂肘关节）
    out.upper = p.build();
  }
  for (const side of [-1, 1]) {
    const p = prims(T);
    boneSegTwin(p, P.foreL, r * 0.8, r * 0.7);
    const hy = -P.foreL;
    for (const k of [-1, 0, 1]) {
      const x0 = k * r * 0.95;
      strut(p, [x0, hy, 0], [x0 * 1.2, hy - r * 1.8, r * 1.1], r * 0.34, 4);
      strut(p, [x0 * 1.2, hy - r * 1.8, r * 1.1], [x0 * 1.3, hy - r * 2.8, r * 0.7], r * 0.28, 4);
    }
    out[side < 0 ? 'foreL' : 'foreR'] = p.build();
    // 喇叭袖（罩住前臂上半；profile 自下而上——宽口在腕端）
    const ps = prims(T);
    ps.lathe([
      [0.085, -P.foreL * 0.78], [0.045, -P.foreL * 0.38], [0.038, -P.foreL * 0.04],
    ], { segs: 8 });
    out[side < 0 ? 'sleeveL' : 'sleeveR'] = ps.build();
  }
  Object.assign(out, skullGeo(T, P));
  {
    // 兜帽（wrapDark）：前脸敞开的斗篷罩——顶盖 + 两侧垂片 + 后脑片拼合
    // （lathe 整圈会把脸也罩进去，魂火目必须露在帽口外）。帽口上沿压眉线，
    // 眼窝在帽影里更亮。
    const W = P.headW, H = P.headH, D = P.headD;
    const p = parts(T);
    p.box(W * 1.30, H * 0.22, D * 1.24, { y: H * 0.92, z: -D * 0.04, top: 1.0, bottom: 0.8 });   // 顶盖
    for (const s of [-1, 1]) {
      p.box(W * 0.16, H * 0.78, D * 0.9, { x: s * W * 0.58, y: H * 0.48, z: -D * 0.10, rz: s * -0.10, top: 1.0, bottom: 0.7 });  // 侧垂片
    }
    p.box(W * 1.1, H * 0.85, D * 0.18, { y: H * 0.50, z: -D * 0.52, top: 1.0, bottom: 0.7 });   // 后脑片
    out.hood = p.build();
    // 帽后垂尖（尖尾后坠是巫 Hood 的读法）
    const pt = prims(T);
    pt.cyl(0, W * 0.16, H * 0.5, { y: H * 0.35, z: -D * 0.62, rx: 0.8, radial: 5 });
    out.hood = mergeGeos([out.hood, pt.build()]);
  }
  {
    // 骨杖（挂右肘端；全长 ~1.5m，杖顶骷髅头 + 幽蓝晶石）
    const p = prims(T);
    p.cyl(0.016, 0.020, 1.30, { y: 0.30, radial: 6 });                    // 杖身（手握点在 1/3 处）
    out.staff = p.build();
    const pt = prims(T);
    pt.ellipsoid(0.040, 0.045, 0.042, { y: 1.00, rings: 4, segs: 6 });    // 杖顶小骷髅
    const pj = parts(T);
    pj.box(0.050, 0.018, 0.045, { y: 0.962, z: 0.006, chamfer: 0.003 });  // 小骷髅下颌
    // 两侧盘角
    const pa = prims(T);
    for (const s of [-1, 1]) {
      pa.cyl(0, 0.009, 0.07, { x: s * 0.038, y: 1.03, rz: -s * 0.9, radial: 4 });
    }
    const pg = prims(T);
    pg.ellipsoid(0.024, 0.034, 0.024, { y: 1.10, rings: 4, segs: 6 });    // 晶石（eye 槽）
    out.staffTop = mergeGeos([pt.build(), pj.build()]);                   // wrap 骨白
    out.staffHorns = pa.build();                                          // wrapDark
    out.staffGem = pg.build();                                            // eye 发光
  }
  LICHGEO.set(P, out);
  return out;
}

export function buildLich(spec, mats, actor) {
  const P = spec.proportions;
  const G = lichGeometry(P);
  const rig = buildGhostRig(spec, mats, actor, G, {
    neckY: P.chestH + 0.08, neckZ: 0.03,
    shoulderX: P.chestW * 0.60, shoulderY: P.chestH * 0.90,
    armMountRx: -0.55,           // 拢袍持杖的前倾臂姿
    armMountRz: 0.10,
    upperL: P.upperL,
  });
  const { add, count } = rig.tools;
  // 喇叭袖罩前臂（wrapDark；随肘关节走）
  add(rig.arms[0].elbow, G.sleeveL, mats.wrapDark, 'arm');
  add(rig.arms[1].elbow, G.sleeveR, mats.wrapDark, 'arm');
  // 骨杖挂右手（整组 noHit：细长持械不撑臂盒）
  const staff = new THREE.Group();
  staff.position.set(0, -P.foreL - 0.03, 0.04);
  staff.rotation.x = 0.12;
  rig.arms[1].elbow.add(staff);
  add(staff, G.staff, mats.accent, 'arm', true);
  add(staff, G.staffTop, mats.wrap, 'arm', true);
  add(staff, G.staffHorns, mats.wrapDark, 'arm', true);
  add(staff, G.staffGem, mats.eye, 'arm', true);
  rig.triangles = count();
  return rig;
}

export const LICH = {
  id: 'lich',
  name: 'Lich（尸巫）',

  speed: 1.1,
  scale: 1.15,
  height: 1.9,
  radius: 0.42,
  flyY: 0.70,            // 悬浮低：袍摆几乎扫地（与 wraith 的高悬浮断下摆拉开）

  palette: {
    wrap: 0xcdc7b4,      // 袍下骨白
    wrapDark: 0x2e3242,  // 罩袍/兜帽：冷暗蓝灰（袍三角剪影主体）
    deep: 0x0c0e14,
    eye: 0x7ec8ff,       // 幽蓝魂火（眼窝 + 胸口 + 杖顶晶石同槽）
    eyeGlow: 0.8,
    accent: 0x4a3a26,    // 骨杖木芯
    tatter: 0x262a38,    // 袍摆碎条
  },

  proportions: {
    hipW: 0.30, bodyD: 0.26, boneR: 0.018,
    chestW: 0.34, chestH: 0.50,
    upperL: 0.36, foreL: 0.36,
    headW: 0.19, headH: 0.24, headD: 0.21,
    tatterRest: 0.06,
    tatters: [
      // 袍摆三条碎条 + 左袖一条（袍是实体，碎条只是下摆的旧化）
      { on: 'hips', px: 0.12, py: -0.50, pz: 0.06, x: 0.12, yaw: 0.3, w: 0.13, h: 0.34, cut: 1, swing: 0.9, out: 0.10 },
      { on: 'hips', px: -0.12, py: -0.50, pz: 0.04, x: -0.12, yaw: -0.3, w: 0.12, h: 0.30, cut: 2, swing: 0.8, out: 0.10 },
      { on: 'hips', px: 0.0, py: -0.52, pz: -0.12, x: 0.01, yaw: 2.9, w: 0.14, h: 0.38, cut: 1, swing: 1.0, out: 0.06 },
      { on: 'arm', side: -1, px: 0, py: -0.28, pz: 0, x: -0.01, yaw: -0.6, w: 0.11, h: 0.28, cut: 2, swing: 1.2, out: 0.12 },
    ],
  },

  gait: {
    kind: 'fly',
    rate: 4.3,           // (TAU·0.85 - 0.8) / 1.1：悬浮时钟 0.85Hz
    fly: {
      flapRate: 0,
      flapAmp: 0,
      bobAmp: 0.05, bobRate: 0.85,
      weave: 0.05, pitch: 0.03,   // 比 wraith 稳：施法者的从容
      wingPairs: 0,
      headUp: -0.04, headScan: 0.35,
      hoverPitch: -0.04,
      hoverHeadUp: 0.14,          // 悬停低头俯视（掌权者读法）
    },
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildLich,
  animate: animateFlyer,
};

// ---------------------------------------------------------------------------
// 物种二之三：墓穴骑士 graveknight —— 甲盒+盾剑（残破板甲骷髅精英：
// 骨感底子上覆甲片，胸板/肩甲/裙甲贴身保留判定，盾与大剑 noHit 装饰）
// ---------------------------------------------------------------------------

const KNIGHTGEO = new Map();

function knightExtras(P) {
  let out = KNIGHTGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 胸板（accent 半金属）：前甲板 + 背板（边缘缺角的残破感由缺口板错位给出）
    const p = parts(T);
    p.box(P.chestW * 0.94, P.chestH * 0.52, 0.045, { y: P.chestH * 0.62, z: P.bodyD * 0.5 + 0.012, top: 1.0, bottom: 0.8 });
    p.box(P.chestW * 0.88, P.chestH * 0.46, 0.04, { y: P.chestH * 0.60, z: -P.bodyD * 0.5 - 0.006, top: 1.0, bottom: 0.84 });
    out.cuirass = p.build();
  }
  {
    // 肩甲两片（左完整右缺半——残破的左右不对称读法）
    const p = parts(T);
    p.box(0.16, 0.09, 0.19, { x: -P.shoulderX, y: P.chestH * 0.98, rz: 0.18, top: 1.0, bottom: 0.7 });
    p.box(0.11, 0.07, 0.15, { x: P.shoulderX * 1.02, y: P.chestH * 0.96, rz: -0.22, top: 1.0, bottom: 0.7 });
    out.pauldrons = p.build();
  }
  {
    // 裙甲两片（胯前下垂甲裙；tri 预算卡线，三片砍两片保剪影）
    const p = parts(T);
    for (const k of [-1, 1]) {
      p.box(0.13, 0.20, 0.028, { x: k * 0.075, y: -0.06, z: P.bodyD * 0.42, rx: 0.18, top: 1.0, bottom: 0.75 });
    }
    out.faulds = p.build();
  }
  {
    // 墓穴盔（wrapDark）：全覆式平顶盔 + 护鼻垂片——缝里的冷蓝白
    // 魂火是 eye 槽原件，盔只负责「盒」读法
    const p = parts(T);
    const W = P.headW, H = P.headH, D = P.headD;
    p.box(W * 1.14, H * 0.62, D * 1.10, { y: H * 0.62, z: -D * 0.02, top: 1.0, bottom: 0.85 });
    p.box(W * 0.30, H * 0.30, 0.02, { y: H * 0.30, z: D * 0.52, chamfer: 0.003 });   // 护鼻垂片
    out.helm = p.build();
  }
  {
    // 大剑（右手，挂肘端；noHit）：两盒极简（柄+渐收刃），tri 预算让位给甲片
    const p = parts(T);
    p.box(0.021, 0.15, 0.021, { y: -0.02, chamfer: 0.004 });                          // 柄
    p.box(0.084, 0.72, 0.020, { y: -0.10 - 0.36, top: 1.0, bottom: 0.14, chamfer: 0.005 });  // 刃
    out.greatsword = p.build();
  }
  {
    // 塔盾（左前臂外侧；残破感交给贴图/配色，几何保持两盒）
    const p = parts(T);
    p.box(0.30, 0.52, 0.024, { y: -0.30, top: 1.0, bottom: 0.92 });
    p.box(0.30, 0.10, 0.028, { y: -0.075, z: 0.004, top: 1.0, bottom: 1.0 });     // 盾帽
    out.shield = p.build();
  }
  KNIGHTGEO.set(P, out);
  return out;
}

export function buildGraveknight(spec, mats, actor) {
  const rig = buildBoneHumanoid(spec, mats, actor);
  const P = spec.proportions;
  const G = knightExtras(P);
  const { add, count } = rig.tools;
  // 贴身甲片保留判定（并入躯干/头盒是设计意图：精英怪甲厚，hitbox 跟着厚）
  add(rig.torso, G.cuirass, mats.accent, 'body');
  add(rig.torso, G.pauldrons, mats.accent, 'body');
  add(rig.hips, G.faulds, mats.accent, 'body');
  add(rig.neck, G.helm, mats.wrapDark, 'head');
  // 大剑右手 / 塔盾左前臂——细长与大面积极外件一律 noHit（撑盒铁律）
  add(rig.arms[1].elbow, G.greatsword, mats.accent, 'arm', true)
    .position.set(0, -P.foreL - 0.04, 0.02);
  add(rig.arms[0].elbow, G.shield, mats.accent, 'arm', true)
    .position.set(-0.10, -P.foreL * 0.45, 0.02);
  rig.triangles = count();
  return rig;
}

export const GRAVEKNIGHT = {
  id: 'graveknight',
  name: 'Graveknight（墓穴骑士）',

  speed: 0.95,
  scale: 1.22,
  height: 2.1,
  radius: 0.50,

  palette: {
    wrap: 0xc9c3b0,      // 甲下骨白
    wrapDark: 0x4e4a44,  // 盔/炭化骨（暗一档压给甲）
    deep: 0x12141a,
    eye: 0xa8d8f0,       // 冷蓝白魂火（骑士的「纪律感」——不发绿）
    eyeGlow: 0.55,
    accent: 0x5a5c60,    // 墓铁甲（半金属半糙：锈蚀残甲不是镜面）
    accentRough: 0.55,
    accentMetal: 0.6,
    tatter: 0x3c382f,    // 披风残片
  },

  proportions: {
    hipY: 1.00, hipW: 0.36, bodyD: 0.30, boneR: 0.024,
    legX: 0.12, thighL: 0.49, shinL: 0.51,          // hipY=thighL+shinL，铁律
    torsoY: 0.11, chestW: 0.44, chestH: 0.56,
    cage: { ribN: 4, drop: 0.05 },                  // tri 预算让位给甲片：肋减一对
    shoulderX: 0.285, shoulderY: 0.48, upperL: 0.44, foreL: 0.46,
    headY: 0.64, headW: 0.21, headH: 0.26, headD: 0.23,
    tatterRest: 0.24,
    tatters: [
      // 背上一片残披风 + 腰侧一条
      { on: 'torso', x: 0.10, y: 0.34, z: -0.16, w: 0.30, h: 0.72, yaw: -0.3, cut: 1, swing: 0.9, out: 0.14 },
      { on: 'torso', x: -0.16, y: 0.02, z: 0.02, w: 0.18, h: 0.40, yaw: 0.5, cut: 2, swing: 0.8, out: 0.16 },
    ],
  },

  gait: {
    rate: 0.75,          // 低频重步
    stride: 0.55,
    armSwing: 0.22,
    armReach: -0.10,
    armSplay: 0.20,      // 左盾右剑的开架势
    elbowBend: -0.08,
    lean: -0.10,
    sway: 0.12,
    hipTwist: 0.06,
    bob: 0.07,
    headLoll: 0.05,      // 骑士不晃头——纪律性
    headDroop: -0.06,
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildGraveknight,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种六：骸骨巨像 bonebrute —— 巨骨刺塔（Boss：2.3 倍体量 < draco 2.8，
// 外露巨肋笼 + 背脊骨刺列 + 双肩骨刺 + 獠牙；骨粗一倍，剪影是「塔」）
// ---------------------------------------------------------------------------

const BRUTEGEO2 = new Map();

function bonebruteExtras(P) {
  let out = BRUTEGEO2.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    // 背脊骨刺列（wrapDark，noHit 由装配处标）：沿脊柱后凸五根，中段最高
    const p = prims(T);
    const r = P.boneR;
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      const y = P.chestH * (0.25 + 0.62 * t);
      const h = 0.16 - Math.abs(k - 2) * 0.028;
      p.cyl(0, r * 1.6, h, { y, z: -P.bodyD * 0.42 - h * 0.2, rx: -0.55, radial: 5 });
    }
    out.spikes = p.build();
  }
  {
    // 双肩骨刺（向外上挑的肩胛棘）
    const p = prims(T);
    const r = P.boneR;
    for (const s of [-1, 1]) {
      p.cyl(0, r * 1.5, 0.17, { x: s * P.shoulderX * 1.05, y: P.chestH * 1.02, rz: -s * 0.7, radial: 5 });
      p.cyl(0, r * 1.1, 0.11, { x: s * P.shoulderX * 0.9, y: P.chestH * 0.98, z: -0.06, rz: -s * 0.4, rx: -0.3, radial: 4 });
    }
    out.shoulderSpikes = p.build();
  }
  {
    // 獠牙（下颌两侧上扣；短粗件并头盒）
    const p = prims(T);
    const W = P.headW, H = P.headH, D = P.headD;
    for (const s of [-1, 1]) {
      p.cyl(0, W * 0.05, H * 0.30, { x: s * W * 0.26, y: H * 0.16, z: D * 0.34, rx: -0.2, rz: -s * 0.15, radial: 4 });
    }
    out.tusks = p.build();
  }
  BRUTEGEO2.set(P, out);
  return out;
}

export function buildBonebrute(spec, mats, actor) {
  const rig = buildBoneHumanoid(spec, mats, actor);
  const P = spec.proportions;
  const G = bonebruteExtras(P);
  const { add, count } = rig.tools;
  // 骨刺全 noHit（细长装饰件铁律）；獠牙并头盒（脸的一部分）
  add(rig.torso, G.spikes, mats.wrapDark, 'body', true);
  add(rig.torso, G.shoulderSpikes, mats.wrapDark, 'body', true);
  add(rig.neck, G.tusks, mats.wrapDark, 'head');
  rig.triangles = count();
  return rig;
}

export const BONEBRUTE = {
  id: 'bonebrute',
  name: 'Bonebrute（骸骨巨像）',

  speed: 0.8,
  scale: 2.3,            // Boss 梯队：> brute 1.34，< draco 2.8（铁律不越顶）
  height: 4.2,
  radius: 0.75,

  palette: {
    wrap: 0xbfb9a6,      // 老骨（比卒暗一档：年代更久的巨骨）
    wrapDark: 0x6e685c,
    deep: 0x12141a,
    eye: 0x6fe89a,       // 幽绿深档（巨像的魂火更沉）
    eyeGlow: 0.7,
    accent: 0x6e4f30,
    tatter: 0x4e463c,
  },

  proportions: {
    hipY: 0.98, hipW: 0.42, bodyD: 0.36, boneR: 0.030,
    legX: 0.16, thighL: 0.48, shinL: 0.50,          // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.52, chestH: 0.60,
    cage: { ribN: 6, drop: 0.07 },                  // 巨肋笼：六根粗肋
    shoulderX: 0.32, shoulderY: 0.50, upperL: 0.50, foreL: 0.52,
    headY: 0.70, headZ: 0.06, headW: 0.24, headH: 0.28, headD: 0.26,   // 头抬出肩线且前移：Boss 也不能「正面打不到头」
    tatterRest: 0.2,
    tatters: [
      // 腰间巨幅裹尸布残片
      { on: 'torso', x: -0.08, y: 0.0, z: 0.05, w: 0.34, h: 0.55, yaw: -0.2, cut: 0, swing: 0.6, out: 0.12 },
      { on: 'torso', x: 0.14, y: 0.10, z: -0.05, w: 0.26, h: 0.60, yaw: 0.4, cut: 1, swing: 0.7, out: 0.14 },
    ],
  },

  gait: {
    rate: 0.7,
    stride: 0.60,
    armSwing: 0.32,      // 巨臂钟摆
    armReach: 0.06,      // 手臂垂落（近地）
    armSplay: 0.30,
    elbowBend: -0.06,
    lean: -0.16,
    sway: 0.14,
    hipTwist: 0.05,
    bob: 0.09,           // 每一步砸地
    headLoll: 0.07,
    headDroop: -0.26,    // 头埋进肩线
  },

  makeMaterials: (spec, rng) => makeZombieMaterialsFrom(spec, linenMaps(), rng),
  build: buildBonebrute,
  animate: MUMMY.animate,
};
