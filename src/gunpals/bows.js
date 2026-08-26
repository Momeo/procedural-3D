/**
 * bows.js — GunPalToolkit 第二武器家族「活体弓」（弓是活的魔物）。
 *
 * 五母题（剪影优先设计法；mr-bow 2026-08-26 视觉重做轮收编）：
 *  - mecha     机甲复合弓：盒段叠层臂 + 关节柱 + 梢部滑轮 + 瞄环；镜头塔独眼
 *             （光学镜头眼：青色镜片 + 光圈缩放式眨，眼皮是快门叶片）。
 *  - aurelia   圣金天弓：白金反曲刃臂 + 翼面面具（竖瞳金目 ×2，小翼片组）。
 *  - dracobow  黑龙魔弓：S 形龙角刃臂 + 龙首（龙类竖瞳 ×2 + 分段弯角，最贴母题）。
 *  - sakura    樱焰妖弓：火焰花瓣刃臂 + 狐面（狐媚弯眼：杏仁压扁 + 半阖眼皮，
 *             放箭瞬间瞪圆）。
 *  - frostbite 霜刃冰弓：折线冰刃 + 浮游冰晶簇（冰魄单目，clearcoat 冰质感）。
 *
 * 活体化 = GunPal actor 范式（GunActor 子类 BowActor）：
 *  - 大眼睛系统沿用 addEyes 约束解（瞳孔凸点 ≤1.10r / 球冠眼皮 1.25r θ92° /
 *    全闭摆角 0.85rad / 静态眉骨壳盖顶部）——眼皮必须能盖住眼球底色；
 *  - idle 偶尔转头看相机（yawLimit 给足 ~2.4rad，弓的持握者在 -Z 侧，要转
 *    大半圈）、draw 时（aim）转回注视出射方向（GunActor 离 idle 自动归位）；
 *  - 放箭瞬间 release()：后坐包络 + 臂片抖动 + 眼睛瞪大 + 母题色释放闪光；
 *  - 差异化动作走 channels（flutter 通道读 actor.releaseT，只写绝对变换）。
 *
 * 坐标约定（与 mr-bow 历史一致）：弓身局部帧 Y = 梢方向、Z = 出射方向、
 * X = 弓面法线（厚度方向）；箭沿 +Y、箭尾在原点。弦挂点 = (0, ±limb.half, tipZ)。
 * PICO MR 安全：无 bloom、无 setRenderTarget，纯 MeshStandard/Physical 材质。
 */
import * as THREE from 'three';
import {
  GunActor, capProfile, mergeGeoms, addFlash, makeLaser, makeTracer, makeSmoke,
  shell, LID_FULL_DEFAULT,
} from './actor.js';
import { patternTextures, texWithRepeat } from './scifi.js';

const RELEASE_DUR = 0.45; // 放箭反应包络时长（秒）

// ---------- 物种表 ----------
export const SPECS = [
  {
    id: 'mecha', name: '机甲复合弓',
    palette: { base: '#6e6862', line: '#241f1c', hi: '#e09a4a', glow: '#ffc23d' },
    pattern: 'rivet',
    limb: { kind: 'mecha', half: 0.56, tipZ: 0.02 },
    mat: { metalness: 0.62, roughness: 0.42, emissiveIntensity: 1.2, envMapIntensity: 1.35 },
    eye: { kind: 'lens', iris: '#9fe8ff', irisGlow: '#3ec8ff', pupil: 'round', defs: [
      { x: 0, y: 0.008, z: 0.030, r: 0.027, fx: 0, fy: 0, fz: 1 }] },
    head: { y: 0.155, z: 0.012 },
    actor: { yawLimit: 2.2, pitchLimit: 0.55, apertureBlink: true },
    arrow: { fin: 'fins', head: 'cone', pattern: 'circuit' },
  },
  {
    id: 'aurelia', name: '圣金天弓',
    palette: { base: '#f2ddb0', line: '#7a5a20', hi: '#ffd76a', glow: '#ffe9a0' },
    pattern: 'filigree',
    limb: {
      kind: 'blade', half: 0.55, tipZ: 0.045, depth: 0.032,
      outline: [ // 上臂剪影 (z前向, y沿臂)：后缘顺流 + 前缘前掠尖刃
        [-0.015, 0.06], [-0.03, 0.12], [-0.034, 0.26], [-0.02, 0.4],
        [0.0, 0.5], [0.05, 0.56], [0.015, 0.52],
        [0.03, 0.42], [0.045, 0.28], [0.035, 0.14], [0.02, 0.06],
      ],
    },
    mat: { metalness: 0.35, roughness: 0.34, emissiveIntensity: 1.25, envMapIntensity: 1.1, clearcoat: 0.6 },
    eye: { kind: 'seraph', iris: '#ffd76a', irisGlow: '#a87820', pupil: 'slit', slit: 0.32, defs: [
      { x: 0.024, y: 0.008, z: 0.026, r: 0.017, fx: 0.18, fy: 0, fz: 1 },
      { x: -0.024, y: 0.008, z: 0.026, r: 0.017, fx: -0.18, fy: 0, fz: 1 }] },
    head: { y: 0.15, z: 0.012 },
    actor: { yawLimit: 2.4, pitchLimit: 0.55 },
    arrow: { fin: 'feather', head: 'cone', pattern: 'crystal' },
  },
  {
    id: 'dracobow', name: '黑龙魔弓',
    palette: { base: '#4a5470', line: '#14161f', hi: '#b8c4e0', glow: '#9a6cff' },
    pattern: 'scales',
    limb: {
      kind: 'blade', half: 0.56, tipZ: 0.05, depth: 0.036,
      outline: [ // S 形龙角：中部后凹、梢部猛前掠
        [-0.02, 0.06], [-0.045, 0.14], [-0.05, 0.26], [-0.03, 0.38],
        [0.0, 0.47], [0.055, 0.57], [0.015, 0.53],
        [0.035, 0.44], [0.05, 0.32], [0.04, 0.2], [0.02, 0.06],
      ],
    },
    mat: { metalness: 0.6, roughness: 0.35, emissiveIntensity: 1.35, envMapIntensity: 1.35 },
    eye: { kind: 'dragon', iris: '#ffb23d', irisGlow: '#8a4a10', pupil: 'slit', slit: 0.3, defs: [
      { x: 0.023, y: 0.014, z: 0.030, r: 0.019, fx: 0.28, fy: 0, fz: 1 },
      { x: -0.023, y: 0.014, z: 0.030, r: 0.019, fx: -0.28, fy: 0, fz: 1 }] },
    head: { y: 0.15, z: 0.02 },
    actor: { yawLimit: 2.6, pitchLimit: 0.6 },
    arrow: { fin: 'spikes', head: 'fang', pattern: 'vein' },
  },
  {
    id: 'sakura', name: '樱焰妖弓',
    palette: { base: '#f0a0c4', line: '#6a1f42', hi: '#ffd8ea', glow: '#ff6ab0' },
    pattern: 'vein',
    limb: {
      kind: 'blade', half: 0.53, tipZ: 0.05, depth: 0.028,
      outline: [ // 火焰瓣：前缘双波浪
        [-0.018, 0.06], [-0.034, 0.16], [-0.026, 0.3], [-0.01, 0.42],
        [0.02, 0.5], [0.055, 0.55], [0.02, 0.52],
        [0.045, 0.45], [0.02, 0.4], [0.045, 0.33], [0.02, 0.28],
        [0.045, 0.2], [0.03, 0.12], [0.018, 0.06],
      ],
    },
    mat: { metalness: 0.4, roughness: 0.38, emissiveIntensity: 1.25, envMapIntensity: 1.3 },
    eye: { kind: 'fox', iris: '#ff8ac8', irisGlow: '#8a2050', pupil: 'slit', slit: 0.42, squashY: 0.62, defs: [
      { x: 0.020, y: 0.008, z: 0.024, r: 0.016, fx: 0.22, fy: 0, fz: 1 },
      { x: -0.020, y: 0.008, z: 0.024, r: 0.016, fx: -0.22, fy: 0, fz: 1 }] },
    head: { y: 0.145, z: 0.015 },
    actor: { yawLimit: 2.4, pitchLimit: 0.5, lidBias: 0.30 }, // 狐媚半阖
    arrow: { fin: 'feather', head: 'fang', pattern: 'vein' },
  },
  {
    id: 'frostbite', name: '霜刃冰弓',
    palette: { base: '#bfe4f8', line: '#2a5a7a', hi: '#eaf8ff', glow: '#7ad8ff' },
    pattern: 'crystal',
    limb: {
      kind: 'blade', half: 0.56, tipZ: 0.055, depth: 0.032,
      outline: [ // 折线冰刃：直臂 + 锐角前掠
        [-0.02, 0.06], [-0.026, 0.3], [-0.005, 0.46],
        [0.06, 0.58], [0.02, 0.5],
        [0.03, 0.3], [0.024, 0.06],
      ],
    },
    mat: { metalness: 0.3, roughness: 0.12, emissiveIntensity: 1.2, envMapIntensity: 1.4, clearcoat: 1.0, transparent: true, opacity: 0.85 },
    eye: { kind: 'wisp', iris: '#d8f6ff', irisGlow: '#5ec8f0', pupil: 'round', defs: [
      { x: 0, y: 0.006, z: 0.028, r: 0.024, fx: 0, fy: 0, fz: 1 }] },
    head: { y: 0.15, z: 0.012 },
    actor: { yawLimit: 2.8, pitchLimit: 0.6 },
    arrow: { fin: 'crystal', head: 'shard', pattern: 'crystal' },
  },
];

// ---------- 缓存（几何/基底材质按 spec 一份，实例克隆材质） ----------
const _geoCache = new Map();
const _matCache = new Map();

// 刃形弓臂：outline [(z前向, y沿臂)] 挤出厚度 + 小倒角（2026-08-26 重做：旧版
// bevelEnabled:false 的 0.016~0.02 平板是「纸片感」根因；厚度提至 0.028~0.04）
function bladeGeometry(l) {
  const s = new THREE.Shape();
  s.moveTo(l.outline[0][0], l.outline[0][1]);
  for (let i = 1; i < l.outline.length; i++) s.lineTo(l.outline[i][0], l.outline[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: l.depth, bevelEnabled: true,
    bevelThickness: 0.004, bevelSize: 0.0035, bevelSegments: 2, curveSegments: 4,
  });
  normalizeUV(g);
  g.rotateY(-Math.PI / 2); // (x=z前, y=沿臂, z=厚) → (x=-厚, y=沿臂, z=z前)
  g.translate(l.depth / 2, 0, 0);
  return g;
}

// 刃臂发光勾边：同剪影放大一圈的薄片垫在刃臂后，母题色描边（MR 暗背景主读法，
// 参照 ProceduralMonsterToolkit 贴面薄片范式——比贴图更稳的剪影级勾边）
function rimGeometry(l) {
  const s = new THREE.Shape();
  const c = centroid(l.outline);
  const pts = l.outline.map(([x, y]) => [c[0] + (x - c[0]) * 1.17, c[1] + (y - c[1]) * 1.07]);
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: l.depth * 0.35, bevelEnabled: false });
  normalizeUV(g);
  g.rotateY(-Math.PI / 2);
  g.translate(l.depth * 0.18, 0, -0.013); // 垫后缩进：只露勾边，侧/背面少读侧板
  return g;
}

function centroid(outline) {
  let x = 0, y = 0;
  for (const p of outline) { x += p[0]; y += p[1]; }
  return [x / outline.length, y / outline.length];
}

// ExtrudeGeometry 的 UV = 形状坐标原值 → 归一到 [0,1] 整臂映射
function normalizeUV(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const su = 1 / (bb.max.x - bb.min.x), sv = 1 / (bb.max.y - bb.min.y);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - bb.min.x) * su, (uv.getY(i) - bb.min.y) * sv);
  }
}

// 分段弯锥（角）：segments 段逐渐变细 + 逐段弯 bend（rad）
function curvedHornGeo(r0, len, segments, bend) {
  const geos = [];
  let r = r0;
  const segLen = len / segments;
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let i = 0; i < segments; i++) {
    const r2 = r * 0.62;
    const g = new THREE.CylinderGeometry(r2, r, segLen * 1.15, 7).toNonIndexed();
    g.translate(0, segLen / 2, 0);
    const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    geos.push(g);
    pos.addScaledVector(dir, segLen);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bend));
    dir.set(0, 1, 0).applyQuaternion(q);
    r = r2;
  }
  return mergeGeoms(geos);
}

// lathe 球冠（眼皮/眉骨；契约见 actor.js addEyes——自下而上 profile）
function latheCapGeo(R, deg) {
  const pts = capProfile(R, deg, 6).map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y));
  return new THREE.LatheGeometry(pts, 10).toNonIndexed();
}

function specGeo(spec) {
  if (_geoCache.has(spec.id)) return _geoCache.get(spec.id);
  const l = spec.limb;
  const g = {
    grip: new THREE.BoxGeometry(0.05, 0.17, 0.08),
    // 机甲臂构件
    mechaSeg: new THREE.BoxGeometry(0.042, 1, 0.062),
    mechaSeam: new THREE.BoxGeometry(0.02, 1.02, 0.07), // 叠层缝发光垫片
    mechaJoint: new THREE.CylinderGeometry(0.03, 0.03, 0.056, 10),
    mechaTip: new THREE.BoxGeometry(0.056, 0.1, 0.078),
    mechaWheel: new THREE.CylinderGeometry(0.034, 0.034, 0.024, 12),
    mechaRing: new THREE.TorusGeometry(0.045, 0.008, 6, 14),
    // 刃形臂 + 发光勾边
    blade: l.kind === 'blade' ? bladeGeometry(l) : null,
    rim: l.kind === 'blade' ? rimGeometry(l) : null,
    // 头部构件
    hornSeg: curvedHornGeo(0.011, 0.15, 3, 0.38),     // 龙角（分段弯）
    ear: new THREE.ConeGeometry(0.016, 0.05, 4),       // 狐耳
    wingPlate: new THREE.BoxGeometry(0.006, 0.05, 0.11), // 圣金小翼片
    petal: new THREE.ConeGeometry(0.024, 0.09, 4),     // 樱焰花瓣（扁锥）
    shard: new THREE.OctahedronGeometry(0.05),         // 冰晶
    turret: new THREE.CylinderGeometry(0.036, 0.04, 0.034, 12), // 机甲镜头筒
    // 箭（2026-08-26 重做：杆加粗到 ~0.007、尾羽/箭头放大提亮）
    shaft: new THREE.CylinderGeometry(0.007, 0.007, 0.9, 8),
    headCone: new THREE.ConeGeometry(0.019, 0.11, 8),
    headFang: new THREE.ConeGeometry(0.014, 0.15, 6),
    headShard: new THREE.OctahedronGeometry(0.06),
    fin: new THREE.BoxGeometry(0.002, 0.1, 0.04),
    feather: new THREE.BoxGeometry(0.0012, 0.12, 0.055),
    finRing: new THREE.TorusGeometry(0.016, 0.004, 6, 12),
    spike: new THREE.ConeGeometry(0.016, 0.08, 5),
  };
  _geoCache.set(spec.id, g);
  return g;
}

function specMats(spec) {
  if (_matCache.has(spec.id)) return _matCache.get(spec.id);
  const { map, emissive } = patternTextures(spec.pattern, spec.palette);
  const m = spec.mat;
  const glowC = new THREE.Color(spec.palette.glow);
  const rep = spec.limb.kind === 'mecha' ? 3 : 1;
  const limbParams = {
    // color 用白：贴图已按 pal.base 铺底，再乘 base 会双重乘染变脏灰
    // （mr-bow 旧版「白金变脏灰」根因之一；map 承载全部配色）
    color: 0xffffff,
    map: texWithRepeat(map, 1, rep),
    emissiveMap: texWithRepeat(emissive, 1, rep),
    emissive: glowC, emissiveIntensity: m.emissiveIntensity,
    metalness: m.metalness, roughness: m.roughness,
    envMapIntensity: m.envMapIntensity ?? 1.3,
    transparent: true, opacity: m.opacity !== undefined ? m.opacity : 1,
    depthWrite: !m.transparent,
  };
  // 冰/金上 MeshPhysicalMaterial（clearcoat）；其余标准料（PICO 安全，无后期）
  const limb = m.clearcoat
    ? new THREE.MeshPhysicalMaterial({ ...limbParams, clearcoat: m.clearcoat, clearcoatRoughness: 0.25 })
    : new THREE.MeshStandardMaterial(limbParams);
  const grip = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.palette.line).lerp(new THREE.Color(0xffffff), 0.1),
    map: texWithRepeat(map, 1, 1), emissiveMap: texWithRepeat(emissive, 1, 1),
    emissive: glowC, emissiveIntensity: 0.35,
    metalness: 0.45, roughness: 0.55, envMapIntensity: 1.1, transparent: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.palette.hi),
    emissive: glowC, emissiveIntensity: m.emissiveIntensity * 0.55,
    metalness: Math.min(0.65, m.metalness + 0.05), roughness: Math.max(0.18, m.roughness - 0.08),
    envMapIntensity: (m.envMapIntensity ?? 1.3) + 0.15,
    transparent: true, opacity: m.opacity !== undefined ? m.opacity : 1,
    depthWrite: !m.transparent,
  });
  // 发光勾边/缝：近母题色的强自发光（克制 1.6，暗背景读边不糊片）
  const trim = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.palette.glow).multiplyScalar(0.35),
    emissive: glowC, emissiveIntensity: 1.6,
    metalness: 0.2, roughness: 0.4, transparent: true,
  });
  const iris = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.eye.iris),
    emissive: new THREE.Color(spec.eye.irisGlow), emissiveIntensity: 1.1,
    metalness: 0.1, roughness: 0.25, transparent: true,
  });
  const aTex = patternTextures(spec.arrow.pattern, spec.palette);
  const shaft = new THREE.MeshStandardMaterial({
    color: 0xffffff, // 同 limb：map 承载配色，不双重乘染
    map: texWithRepeat(aTex.map, 1, 2), emissiveMap: texWithRepeat(aTex.emissive, 1, 2),
    emissive: glowC, emissiveIntensity: Math.max(1.1, m.emissiveIntensity),
    metalness: m.metalness, roughness: m.roughness, envMapIntensity: 1.2, transparent: true,
  });
  const fin = new THREE.MeshStandardMaterial({
    color: glowC.clone().lerp(new THREE.Color(0xffffff), 0.3),
    emissive: glowC, emissiveIntensity: 1.5,
    metalness: 0.5, roughness: 0.35, transparent: true, side: THREE.DoubleSide,
  });
  // 瞳孔全弓共享（近黑带母题色芯；不放 userData.mats——共享料不随实例 dispose）
  const mats = { limb, grip, accent, trim, iris, shaft, fin };
  mats.all = [limb, grip, accent, trim, iris, shaft, fin];
  _matCache.set(spec.id, mats);
  return mats;
}

// 瞳孔共享料（近黑；竖瞳/圆瞳同料，形状由几何决定）
const PUPIL_MAT = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.25, metalness: 0.1 });

/**
 * 弓眼睛系统（addEyes 约束解的弓族变体，见 actor.js 几何依据注释）：
 * 虹膜球（母题色微发光）+ 压扁凸瞳（round / slit 竖瞳）+ lathe 球冠上眼皮
 * （1.25r θ92°，头部同色料）+ 静态眉骨壳（1.06r 44°，并入 browGeos 由调用方合并）。
 * 返回 { lids, pupilMesh, eyeMesh }。
 */
function addBowEyes(parent, spec, mats, browGeos) {
  const E = spec.eye;
  const lids = [];
  const eyeGeos = [], pupGeos = [];
  for (const e of E.defs) {
    const eg = new THREE.SphereGeometry(e.r, 12, 9).toNonIndexed();
    if (E.squashY) eg.scale(1, E.squashY, 1);
    eg.translate(e.x, e.y, e.z);
    eyeGeos.push(eg);
    const fn = Math.hypot(e.fx, e.fy, e.fz) || 1;
    const dx = e.fx / fn, dy = e.fy / fn, dz = e.fz / fn;
    const pr = e.r * 0.5, off = e.r * 0.875;
    const pg = new THREE.SphereGeometry(pr, 8, 6).toNonIndexed();
    if (E.pupil === 'slit') pg.scale(E.slit ?? 0.35, 1.15, 0.45); // 竖瞳：窄横轴
    else pg.scale(1, 1, 0.45);
    pg.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(Math.atan2(-dy, dz), Math.asin(Math.max(-1, Math.min(1, dx))), 0, 'YXZ')));
    pg.translate(e.x + dx * off, e.y + dy * off, e.z + dz * off);
    pupGeos.push(pg);
    // 眼皮球冠（1.28r θ96°：比 addEyes 默认再大半档——弓族特写机位更低，
    // 全闭时底缘不许露虹膜底色；全闭摆角 lidFull 1.0 见 makeBowBody cfg）
    const pivot = new THREE.Group();
    pivot.position.set(e.x, e.y, e.z);
    const lidR = e.r * 1.28;
    pivot.add(new THREE.Mesh(latheCapGeo(lidR, 96), mats.accent));
    parent.add(pivot);
    lids.push(pivot);
    // 静态眉骨壳（闭眼时顶部让出的一弯由它盖）
    const bg = latheCapGeo(e.r * 1.06, 44);
    bg.translate(e.x, e.y, e.z);
    browGeos.push(bg);
  }
  const eyeMesh = new THREE.Mesh(mergeGeoms(eyeGeos), mats.iris);
  const pupilMesh = new THREE.Mesh(mergeGeoms(pupGeos), PUPIL_MAT);
  parent.add(eyeMesh, pupilMesh);
  return { lids, pupilMesh, eyeMesh };
}

// 母题色释放闪光（addFlash 是共享橙色料；弓要母题色且随实例 dispose）
function addBowFlash(parent, spec, x, y, z) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(spec.palette.glow), transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const g1 = new THREE.PlaneGeometry(0.12, 0.12).toNonIndexed();
  const g2 = new THREE.PlaneGeometry(0.12, 0.12).rotateY(Math.PI / 2).toNonIndexed();
  const mesh = new THREE.Mesh(mergeGeoms([g1, g2]), mat);
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return { mesh, mat };
}

// ---------- 机甲臂（盒段叠层 + 缝发光 + 关节柱 + 梢部滑轮 + 瞄环） ----------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
function mechaArm(group, G, mats, sy, H) {
  const pts = [
    [0, sy * 0.10, 0.02], [0, sy * H * 0.52, -0.015],
    [0, sy * H * 0.8, 0.05], [0, sy * H, 0.02],
  ].map((p) => new THREE.Vector3(...p));
  for (let i = 0; i < pts.length - 1; i++) { // 盒段 + 叠层缝发光垫片
    _a.copy(pts[i]); _b.copy(pts[i + 1]);
    _d.copy(_b).sub(_a);
    const len = _d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _d.clone().normalize());
    const seg = new THREE.Mesh(G.mechaSeg, mats.limb);
    seg.position.copy(_a).addScaledVector(_d, 0.5);
    seg.scale.set(1, len, 1);
    seg.quaternion.copy(quat);
    group.add(seg);
    const seam = new THREE.Mesh(G.mechaSeam, mats.trim); // 叠层缝（z 向宽出，四边露发光线）
    seam.position.copy(seg.position);
    seam.scale.set(1, len * 0.92, 1);
    seam.quaternion.copy(quat);
    group.add(seam);
  }
  for (let i = 1; i < pts.length - 1; i++) { // 关节柱（X 轴横置）
    const j = new THREE.Mesh(G.mechaJoint, mats.accent);
    j.position.copy(pts[i]);
    j.rotation.z = Math.PI / 2;
    group.add(j);
  }
  const tip = new THREE.Mesh(G.mechaTip, mats.limb);
  tip.position.copy(pts[3]);
  group.add(tip);
  const wheel = new THREE.Mesh(G.mechaWheel, mats.accent);
  wheel.position.copy(pts[3]);
  wheel.rotation.z = Math.PI / 2;
  group.add(wheel);
}

// ---------- 头部（母题脸 + 眼睛；lookNode，闲置回头/放箭反应都长在它上面） ----------
function buildHead(head, spec, G, mats) {
  const staticGeos = []; // 头部静态件（合并成 1 mesh，mats.accent/limb 各一）
  const accentGeos = [];
  const E = spec.eye;
  switch (E.kind) {
    case 'lens': { // 机甲：镜头塔（底座盒 + 镜筒 + 小天线）
      const base = new THREE.BoxGeometry(0.055, 0.045, 0.055).toNonIndexed();
      base.translate(0, -0.01, 0);
      staticGeos.push(base);
      const barrel = G.turret.toNonIndexed();
      barrel.rotateX(Math.PI / 2);
      barrel.translate(0, 0.008, 0.018);
      accentGeos.push(barrel);
      const ant = new THREE.CylinderGeometry(0.003, 0.003, 0.07, 5).toNonIndexed();
      ant.translate(0.02, 0.045, -0.01);
      accentGeos.push(ant);
      break;
    }
    case 'seraph': { // 圣金：翼面面具（扁椭球面甲 + 两侧三片小翼组）
      const mask = new THREE.SphereGeometry(0.045, 12, 9).toNonIndexed();
      mask.scale(1, 1.1, 0.62);
      staticGeos.push(mask);
      for (const sx of [1, -1]) {
        for (let i = 0; i < 3; i++) {
          const w = G.wingPlate.toNonIndexed();
          w.rotateY(sx * (0.5 + i * 0.35));
          w.rotateZ(sx * (0.35 + i * 0.3));
          w.translate(sx * (0.045 + i * 0.012), 0.02 - i * 0.012, -0.02 - i * 0.015);
          accentGeos.push(w);
        }
      }
      break;
    }
    case 'dragon': { // 黑龙：龙首（颅 + 吻 + 分段弯角 ×2 + 眉脊）
      const skull = new THREE.SphereGeometry(0.04, 12, 9).toNonIndexed();
      skull.scale(1, 0.9, 1.05);
      staticGeos.push(skull);
      const snout = new THREE.BoxGeometry(0.034, 0.024, 0.055).toNonIndexed();
      snout.translate(0, -0.012, 0.045);
      staticGeos.push(snout);
      const jaw = new THREE.BoxGeometry(0.028, 0.01, 0.04).toNonIndexed();
      jaw.translate(0, -0.03, 0.038);
      accentGeos.push(jaw);
      for (const sx of [1, -1]) { // 分段弯角（贴颅后掠，正面双角都读得出）
        const h = G.hornSeg.clone();
        h.rotateZ(sx * 2.55);
        h.rotateY(sx * 0.55);
        h.translate(sx * 0.032, 0.03, -0.018);
        accentGeos.push(h);
      }
      break;
    }
    case 'fox': { // 樱焰：狐面（白粉面甲 + 三角耳 + 面颊瓣）
      const mask = new THREE.SphereGeometry(0.042, 12, 9).toNonIndexed();
      mask.scale(1, 0.95, 0.66);
      staticGeos.push(mask);
      for (const sx of [1, -1]) {
        const ear = G.ear.toNonIndexed();
        ear.scale(1, 1, 0.5);
        ear.rotateZ(-sx * 0.4);
        ear.translate(sx * 0.026, 0.052, -0.005);
        accentGeos.push(ear);
        const cheek = G.petal.toNonIndexed();
        cheek.scale(0.55, 0.6, 0.3);
        cheek.rotateZ(sx * 1.9);
        cheek.translate(sx * 0.038, -0.02, 0.01);
        accentGeos.push(cheek);
      }
      break;
    }
    case 'wisp': { // 霜刃：浮游冰晶簇（三片碎晶托单目）
      for (let i = 0; i < 3; i++) {
        const s = G.shard.toNonIndexed();
        s.scale(0.55, 1.15 - i * 0.18, 0.55);
        s.rotateZ(0.5 - i * 0.5);
        s.rotateY(i * 1.1);
        s.translate((i - 1) * 0.035, 0.035 + (i % 2) * 0.018, -0.014 - i * 0.01);
        accentGeos.push(s);
      }
      const collar = new THREE.TorusGeometry(0.032, 0.006, 6, 12).toNonIndexed();
      collar.rotateX(Math.PI / 2);
      collar.translate(0, -0.02, 0.005);
      staticGeos.push(collar);
      break;
    }
  }
  const browGeos = [];
  const eyes = addBowEyes(head, spec, mats, browGeos);
  if (staticGeos.length) head.add(new THREE.Mesh(mergeGeoms(staticGeos), mats.limb));
  if (browGeos.length || accentGeos.length) {
    head.add(new THREE.Mesh(mergeGeoms([...accentGeos, ...browGeos]), mats.accent));
  }
  return eyes;
}

// ---------- BowActor：GunActor 子类（放箭反应 + 弓族眼皮/瞳孔后处理） ----------
export class BowActor extends GunActor {
  constructor(gun, cfg) {
    super(gun, cfg);
    this.releaseT = -1;              // 放箭反应包络计时（-1 = 未触发）
    if (this.channels.flutter) this.channels.flutter.always = true; // 每帧写绝对姿态
  }

  /** 放箭瞬间活体反应：后坐 + 打断回头 + 臂片抖动/眼睛瞪大包络。 */
  release() {
    this.fire(); // GunActor：kick 后坐包络 + 回头打断
    this.releaseT = 0;
  }

  /** 放箭反应强度 0..1（flutter 通道与眼睛瞪大共用）。 */
  get releaseK() {
    return this.releaseT >= 0 ? Math.sin(Math.PI * Math.min(1, this.releaseT / RELEASE_DUR)) : 0;
  }

  update(dt, camera) {
    super.update(dt, camera);
    const gun = this.gun;
    // 弓不用枪的红色激光/曳光（游戏层有自己的弹道指示器； GunActor 每帧会重新点亮）
    gun.laser.visible = false;
    gun.tracer.visible = false;
    // 放箭包络推进
    if (this.releaseT >= 0) {
      this.releaseT += dt;
      if (this.releaseT > RELEASE_DUR) this.releaseT = -1;
    }
    const k = this.releaseK;
    // 眼睛瞪大（super 已写 pupilScale，叠乘放箭放大；眼球微撑）
    if (k > 0) {
      gun.pupilMesh.scale.multiplyScalar(1 + 0.4 * k);
      if (gun.eyeMesh) gun.eyeMesh.scale.setScalar(1 + 0.15 * k);
    } else if (gun.eyeMesh) gun.eyeMesh.scale.setScalar(1);
    // 机甲光圈眨：眨眼时瞳孔（光圈）同步收缩（叠加在眼皮盖上之前读「快门」）
    if (this.cfg.apertureBlink && this.blinkT >= 0) {
      gun.pupilMesh.scale.multiplyScalar(1 - 0.8 * Math.sin(Math.PI * Math.min(this.blinkT, 1)));
    }
    // 狐媚半阖：lidBias 常态加阖，放箭瞬间张开（k 抵消）
    const bias = this.cfg.lidBias || 0;
    if (bias) {
      const lidFull = this.cfg.lidFull ?? LID_FULL_DEFAULT;
      this.setLids(Math.max(0, Math.min(lidFull * 1.06,
        gun.lids[0].rotation.x + bias * lidFull * (1 - 1.8 * k))));
    }
  }
}

// ---------- 弓身（局部帧，poseBow 逐帧定向；弦仍由游戏层摆） ----------
// 材质按实例克隆（共享纹理与着色程序）：游戏层 clearNock 的 dispose 不会误伤共享料
export function makeBowBody(spec) {
  const G = specGeo(spec);
  const M = specMats(spec);
  const mats = M.all.map((m) => m.clone());
  const [limbMat, gripMat, accentMat, trimMat, irisMat] = mats;
  const inst = { limb: limbMat, grip: gripMat, accent: accentMat, trim: trimMat, iris: irisMat };

  const { root, kick, sway } = shell(spec.id);
  const l = spec.limb;

  // 臂（上下两组独立节点：放箭 flutter 通道掰它们）
  const limbTop = new THREE.Group();
  const limbBot = new THREE.Group();
  sway.add(limbTop, limbBot);
  if (l.kind === 'mecha') {
    mechaArm(limbTop, G, inst, 1, l.half);
    mechaArm(limbBot, G, inst, -1, l.half);
    const ring = new THREE.Mesh(G.mechaRing, accentMat); // 瞄环
    ring.position.set(0.055, 0.1, 0.02);
    ring.rotation.y = Math.PI / 2;
    sway.add(ring);
    // 机甲把身叠层（层次 + 缝发光）
    for (const [w, h, dd, y, z] of [
      [0.062, 0.1, 0.09, 0.1, 0.005], [0.056, 0.07, 0.095, -0.09, 0.005]]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), limbMat);
      plate.position.set(0, y, z);
      sway.add(plate);
    }
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.19, 0.02), trimMat);
    seam.position.set(0, 0, -0.045);
    sway.add(seam);
  } else {
    for (const [grp, sy] of [[limbTop, 1], [limbBot, -1]]) {
      const blade = new THREE.Mesh(G.blade, limbMat);
      const rim = new THREE.Mesh(G.rim, trimMat);
      if (sy < 0) { blade.scale.y = -1; rim.scale.y = -1; }
      grp.add(rim, blade);
    }
  }
  const grip = new THREE.Mesh(G.grip, gripMat);
  sway.add(grip);

  // 头（lookNode：母题脸 + 眼睛 + 特效挂点）
  const head = new THREE.Group();
  head.position.set(0, spec.head.y, spec.head.z);
  sway.add(head);
  const eyes = buildHead(head, spec, G, inst);

  const flash = addBowFlash(head, spec, 0, -0.01, 0.09);
  mats.push(flash.mat);
  const laser = makeLaser(head, 0, 0, 0.05);
  const tracer = makeTracer(head, 0, 0, 0.05);
  const smoke = makeSmoke(head, 0, 0.04, 0);

  // 放箭 flutter 通道：臂片抖动（只写绝对变换；不碰 head——lookNode 姿态归
  // GunActor 回头状态机管，四元数/欧拉混写会互相打架）
  const channels = {
    flutter: (t, amp, dt, actor) => {
      const rt = actor.releaseT;
      const k = actor.releaseK;
      const wob = rt >= 0 ? Math.sin(rt * 55) * Math.max(0, 1 - rt / RELEASE_DUR) : 0;
      limbTop.rotation.x = 0.09 * k + 0.02 * wob;
      limbBot.rotation.x = -(0.09 * k + 0.02 * wob);
    },
  };

  const actor = new BowActor({
    id: spec.id, root, kick, sway, lookNode: head,
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, eyeMesh: eyes.eyeMesh,
    flash: flash.mesh, laser, tracer, smoke,
    hotMats: [], channels, stateAmps: {},
  }, {
    yawLimit: spec.actor.yawLimit, pitchLimit: spec.actor.pitchLimit,
    rate: 0.2, lidFull: 1.0, // 弓族全闭摆角加大（配 1.28r θ96° 球冠，低头机位不露虹膜）
    lidBias: spec.actor.lidBias, apertureBlink: spec.actor.apertureBlink,
  });

  root.userData.mats = mats;
  root.userData.actor = actor;
  root.userData.spec = spec;
  return root;
}

// ---------- 箭（单位长度，沿 +Y，箭尾在原点；用时 scale.y = 实际长度） ----------
export function makeArrowMesh(spec) {
  const G = specGeo(spec);
  const M = specMats(spec);
  // 材质按实例克隆（共享纹理与着色程序）——飞行箭回收淡出要逐实例改 opacity
  const [shaftMat, accentMat, finMat] = [M.shaft, M.accent, M.fin].map((m) => m.clone());
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(G.shaft, shaftMat);
  shaft.position.y = 0.45;
  g.add(shaft);
  if (spec.arrow.head === 'fang') {
    const h = new THREE.Mesh(G.headFang, accentMat);
    h.position.y = 0.965;
    g.add(h);
  } else if (spec.arrow.head === 'shard') {
    const h = new THREE.Mesh(G.headShard, accentMat);
    h.position.y = 0.93;
    h.scale.set(0.4, 1.15, 0.4);
    g.add(h);
  } else {
    const h = new THREE.Mesh(G.headCone, accentMat);
    h.position.y = 0.955;
    g.add(h);
  }
  switch (spec.arrow.fin) {
    case 'ring':
      for (const fy of [0.07, 0.14]) {
        const r = new THREE.Mesh(G.finRing, accentMat);
        r.position.y = fy;
        r.rotation.x = Math.PI / 2;
        g.add(r);
      }
      break;
    case 'feather':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const f = new THREE.Mesh(G.feather, finMat);
        f.position.set(Math.cos(a) * 0.03, 0.1, Math.sin(a) * 0.03);
        f.rotation.y = -a;
        f.rotation.x = -0.5;
        g.add(f);
      }
      break;
    case 'spikes':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const s = new THREE.Mesh(G.spike, finMat);
        s.position.set(Math.cos(a) * 0.02, 0.09, Math.sin(a) * 0.02);
        s.rotation.z = Math.cos(a) * 1.2;
        s.rotation.x = -Math.sin(a) * 1.2;
        g.add(s);
      }
      break;
    case 'crystal':
      for (const fy of [0.06, 0.13]) {
        const s = new THREE.Mesh(G.shard, finMat);
        s.position.y = fy;
        s.scale.setScalar(0.32);
        g.add(s);
      }
      break;
    case 'fins':
    default:
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const f = new THREE.Mesh(G.fin, finMat);
        f.position.set(Math.cos(a) * 0.022, 0.09, Math.sin(a) * 0.022);
        f.rotation.y = -a;
        f.rotation.x = -0.35;
        g.add(f);
      }
  }
  for (const m of g.children) m.frustumCulled = false; // 细杆 boundingSphere 不随 scale.y 更新，关掉剔除防闪没
  g.userData.mats = [shaftMat, accentMat, finMat];
  return g;
}
