/**
 * actor.js — gunpals 行为内核：GunActor 四态状态机 + 子节点动画通道框架 +
 * 眼睛系统（眨眼/回头/眼皮/眉骨壳）+ 特效（闪光/曳光/激光/烟/积热泛红）+
 * 几何辅助（attach 按材质合并 / dirEuler / boxGeo / mergeGeoms）。
 *
 * 本包自包含：确定性随机（mulberry32/hashStr）与曲面原语（prims.js）均已内联/
 * 拷贝进包，运行时只依赖宿主页 importmap 提供的 bare 'three'。
 *
 * 四档行为状态（语义映射 mr-gun 的 VR 用枪：扳机按住=fire 连发、瞄准=aim、
 * 都不按=idle、积热超限=overheat 强制停火喘气）：
 *  - idle：呼吸起伏 + 缓慢摇摆 + 眨眼 + 闲置回头看相机（aim→turn→gaze→back
 *    子状态机，全 slerp）+ 每枪母题化小动作。
 *  - aim：高频低幅手持抖动 + 眼睛半眯 + 瞳孔收缩 + 常驻红色激光瞄准线
 *    （muzzle→30m，additive；开火时提亮）+ 母题化蓄力姿态。
 *  - fire：按射速连发（50ms 枪口闪光 + 后坐上顶回弹 + 80ms 曳光），身体 roll
 *    微震 + 母题化疯狂动作。
 *  - overheat：连发 ~3s 或 24 发触发（0.1.1 起容量翻倍，原 1.5s/12 发太容易
 *    过热），强制停火 1.2s：嘴大张、眼皮盖 65%、口中冒烟、枪身 emissive
 *    泛红随冷却渐变。
 *
 * 差异化动作走「子节点动画通道」：builder 在 spec.channels 登记
 * { name: fn(t, amp, dt, actor) }，spec.stateAmps 给每状态每通道目标强度，
 * actor 负责 amp 平滑趋近，fn 只写绝对变换（不累积）。
 *
 * 【已验证的坑，勿回退】
 *  - 姿态合成每帧从基准绝对重算，禁「上一帧结果上再乘一点」（premultiply 累乘
 *    曾致鳄鱼头 gaze 时无限旋转）。
 *  - 眼皮全覆盖约束解见 addEyes docstring（瞳孔压扁 1.10r / 球冠 1.25r θ92° /
 *    全闭摆角 0.85rad 非越大越好 / 静态眉骨壳接顶部）。
 *  - 特效挂点（闪光/曳光/激光/烟）必须挂在嘴所在的头节点上，随头动。
 *  - SwiftShader 下 THREE.Line 1px 线不渲染——激光束用双面色带。
 */

import * as THREE from 'three';
import { prims } from '../prims.js';

// --- 确定性随机（拷贝自 src/rng.js，随包自包含） -------
/** mulberry32 经典实现：32 位种子 → [0,1) 均匀分布，周期 2^32。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 字符串 → 32 位种子（FNV-1a）。 */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TAU = Math.PI * 2;

// --- 材质 ----------------------------------------------------------------------
/** 生物件：高粗糙低金属 */
function bioMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
}
/** 金属件：metalness 0.8（铁律 0.7-0.9 区间） */
function metalMat(color, rough = 0.38) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.8 });
}
// 眼球/瞳孔/枪口闪光全枪共享（稍亮材质读眼白）
const EYE_MAT = new THREE.MeshStandardMaterial({ color: 0xf2eedd, roughness: 0.25, metalness: 0, emissive: 0x2a2820 });
const PUPIL_MAT = new THREE.MeshStandardMaterial({ color: 0x16140f, roughness: 0.3, metalness: 0 });
const FLASH_MAT = new THREE.MeshBasicMaterial({
  color: 0xffd070, transparent: true, opacity: 0.92,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

// --- 程序化 canvas 贴图（激光端点/烟，不引外部贴图） --------------------------------
function dotTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const DOT_TEX = dotTex('rgba(255,90,60,1)', 'rgba(255,40,20,0)');
const SMOKE_TEX = dotTex('rgba(210,210,210,0.9)', 'rgba(120,120,120,0)');
// 激光束/端点共享材质（同时只有一把枪在 aim/fire，共享无冲突）
// 用 6mm 宽双面色带而非 THREE.Line——SwiftShader 下 1px 线渲染不可靠（实测不显示）
const LASER_MAT = new THREE.MeshBasicMaterial({
  color: 0xff3222, transparent: true, opacity: 0.38,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const DOT_MAT = new THREE.SpriteMaterial({
  map: DOT_TEX, color: 0xff5540, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const TRACER_BASE = new THREE.MeshBasicMaterial({
  color: 0xffb050, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

// --- 几何辅助 --------------------------------------------------------------------
/** 盒子原语（与 prims 同变换契约：先 XYZ 欧拉旋转后平移），返回无索引几何。 */
function boxGeo(w, h, d, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (o.rx || o.ry || o.rz) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ')));
  }
  g.translate(o.x || 0, o.y || 0, o.z || 0);
  return g;
}

/** 把 cyl 的 +Y 轴对准任意方向 (dx,dy,dz) 的欧拉角（prims XYZ 序推导）。 */
function dirEuler(dx, dy, dz) {
  const n = Math.hypot(dx, dy, dz) || 1;
  dx /= n; dy /= n; dz /= n;
  return { rx: Math.atan2(-dy, dz), ry: Math.acos(Math.max(-1, Math.min(1, -dx))), rz: Math.PI / 2 };
}

/** 合并同材质几何（position/normal/uv 拼接，无索引）。 */
function mergeGeoms(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let off = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
    off += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 在容器节点下按材质 key 建合并 mesh。
 * fill(api) 里：api.P(key) 拿 prims 累加器（链式调 cyl/ellipsoid/lathe），
 * api.box(key, w,h,d,o) 加盒子。返回该容器的三角数。
 */
function attach(container, mats, fill) {
  const accs = new Map(), boxes = new Map();
  const api = {
    P(key) { if (!accs.has(key)) accs.set(key, prims(2.6)); return accs.get(key); },
    box(key, w, h, d, o) {
      if (!boxes.has(key)) boxes.set(key, []);
      boxes.get(key).push(boxGeo(w, h, d, o));
    },
  };
  fill(api);
  let tris = 0;
  for (const key of new Set([...accs.keys(), ...boxes.keys()])) {
    const list = [];
    if (accs.has(key)) list.push(accs.get(key).build());
    if (boxes.has(key)) list.push(...boxes.get(key));
    const geo = mergeGeoms(list);
    tris += geo.attributes.position.count / 3;
    container.add(new THREE.Mesh(geo, mats[key]));
  }
  return tris;
}

/** 球冠 profile（lathe 用）：φ 从 deg（底缘）到 0（+Y 顶）——lathe 契约是
 *  自下而上，反了会绕向翻转、法线朝内、外侧被背面剔除（眼皮隐形）。 */
function capProfile(R, deg, rows = 5) {
  const prof = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (1 - i / rows) * (deg * Math.PI / 180);
    prof.push([Math.max(0.001, R * Math.sin(phi)), R * Math.cos(phi)]);
  }
  return prof;
}

/**
 * 眉骨：静态球冠壳（1.06r，φ 0..44°），发射进头部静态网格（零额外 mesh）。
 * 作用：闭眼时旋转眼皮下摆、眼球顶部会让出一截——眉骨壳永远盖住那一弯，
 * 否则全闭瞬间从水平视角能看到眼球顶部露出眼白。眼皮扫不到的地方归它。
 */
function emitBrows(P, eyeDefs) {
  for (const e of eyeDefs) {
    P.lathe(capProfile(e.r * 1.06, 44), { segs: 8, x: e.x, y: e.y, z: e.z });
  }
}

/**
 * 大眼睛系统：白巩膜球 + 朝前微凸的压扁深瞳（两眼各合并成 1 mesh），上眼皮为
 * lathe 球冠壳（1.25r、θ=92° 超赤道、身体同色，独立 mesh，pivot 在眼球中心，
 * 眨眼绕此前摆）。返回 { lids, pupilMesh, tris }（pupilMesh 供 aim 态瞳孔收缩缩放）。
 *
 * 【闭眼全覆盖的几何依据】旋转球冠的覆盖带是 [摆角, 摆角+92°]，约束联立：
 *  - 瞳孔（压扁后凸点 ≤1.10r，壳 1.25r 不穿刺）必须带内：瞳孔方向统一沉到
 *    φ≈94-100°（壳缘 92° 之上——睁眼时瞳孔下缘贴壳缘露出=大眼皮读法）；
 *  - 全闭摆角 0.85rad（非越大越好——摆过头会把前上方瞳孔让出来，旧版 2.35rad
 *    的 bug）：带 [49°,141°] 罩住全部瞳孔，下缘贴到眼球底部剪影；下摆再乘
 *    1.06 过行程；
 *  - 顶部让出的 [0,49°] 由静态眉骨壳（0..44°，合并进头部网格）接住，5° 缝由
 *    眉骨/眼皮的半径差（1.06r vs 1.25r）视差盖住。
 */
function addEyes(parent, mats, eyeDefs, lidKey) {
  const eyeP = prims(2.6), pupP = prims(2.6);
  const lids = [];
  for (const e of eyeDefs) {
    eyeP.ellipsoid(e.r, e.r, e.r, { x: e.x, y: e.y, z: e.z, rings: 5, segs: 8 });
    const fn = Math.hypot(e.fx, e.fy, e.fz) || 1;
    const dx = e.fx / fn, dy = e.fy / fn, dz = e.fz / fn;
    const pr = e.r * 0.5, off = e.r * 0.875;
    // 瞳孔压扁成贴面凸镜：局部 +Z 轴对准朝向（XYZ 序：Rz 不影响 +Z，Ry 摆 x 分量，
    // Rx 再在 YZ 面内摆），凸点径向 = 0.875r + 0.5r×0.45 ≈ 1.10r
    pupP.ellipsoid(pr, pr, pr * 0.45, {
      x: e.x + dx * off, y: e.y + dy * off, z: e.z + dz * off,
      rx: Math.atan2(-dy, dz), ry: Math.asin(Math.max(-1, Math.min(1, dx))),
      rings: 3, segs: 6,
    });
    const pivot = new THREE.Group();
    pivot.position.set(e.x, e.y, e.z);
    const lidGeo = prims(2.6).lathe(capProfile(e.r * 1.25, 92, 6), { segs: 8 }).build();
    pivot.add(new THREE.Mesh(lidGeo, mats[lidKey]));
    parent.add(pivot);
    lids.push(pivot);
  }
  const eyeGeo = mergeGeoms([eyeP.build()]);
  const pupGeo = mergeGeoms([pupP.build()]);
  parent.add(new THREE.Mesh(eyeGeo, EYE_MAT));
  const pupilMesh = new THREE.Mesh(pupGeo, PUPIL_MAT);
  parent.add(pupilMesh);
  const tris = (eyeGeo.attributes.position.count + pupGeo.attributes.position.count) / 3
    + lids.length * 80;
  return { lids, pupilMesh, tris };
}

/** 枪口闪光：两片正交自发光面片，默认隐藏（开火 50ms 亮）。 */
function addFlash(parent, x, y, z) {
  const g1 = new THREE.PlaneGeometry(0.10, 0.10).toNonIndexed();
  const g2 = new THREE.PlaneGeometry(0.10, 0.10).rotateY(Math.PI / 2).toNonIndexed();
  const mesh = new THREE.Mesh(mergeGeoms([g1, g2]), FLASH_MAT);
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

/** 激光瞄准线（mr-gun 同款常驻红线）：muzzle→前方 30m 细色带 + 落点小点，additive。 */
function makeLaser(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const p1 = new THREE.PlaneGeometry(0.006, 30).rotateX(Math.PI / 2).translate(0, 0, 15);
  const p2 = p1.clone().rotateZ(Math.PI / 2);
  const beam = new THREE.Mesh(mergeGeoms([p1.toNonIndexed(), p2.toNonIndexed()]), LASER_MAT);
  const dot = new THREE.Sprite(DOT_MAT);
  dot.position.set(0, 0, 30);
  dot.scale.setScalar(0.22);
  g.add(beam, dot);
  g.visible = false;
  return g;
}

/** 曳光：两片正交长条面片从枪口向前 7m，每发 80ms 淡出。 */
function makeTracer(parent, x, y, z) {
  const p1 = new THREE.PlaneGeometry(0.014, 7).rotateX(Math.PI / 2).translate(0, 0, 3.5);
  const p2 = p1.clone().rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(mergeGeoms([p1.toNonIndexed(), p2.toNonIndexed()]), TRACER_BASE.clone());
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

/** 过热冒烟：2 片程序化烟 sprite 在枪口上方循环上升淡出。 */
function makeSmoke(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const sprites = [];
  for (let i = 0; i < 2; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SMOKE_TEX, color: 0x9a9a9a, transparent: true, opacity: 0, depthWrite: false,
    }));
    g.add(sp);
    sprites.push(sp);
  }
  g.visible = false;
  return { group: g, sprites };
}

/**
 * 每把枪的根结构：root（页面摆放/持握挂载）→ kick（开火后坐）→ sway
 * （状态摆动/呼吸/抖动，actor 每帧写绝对值）→ 各部件。
 */
function shell(id) {
  const root = new THREE.Group();
  root.name = id;
  const kick = new THREE.Group();
  root.add(kick);
  const sway = new THREE.Group();
  kick.add(sway);
  return { root, kick, sway };
}

// --- 行为系统 ---------------------------------------------------------------------
const ID_Q = new THREE.Quaternion();
const _gsE = new THREE.Euler();   // lookAngles() 复用
// 四态的眼皮闭合比例（乘 cfg.lidFull 得弧度；眨眼叠加在这之上并带 6% 过行程）
const LID_FRAC = { idle: 0, aim: 0.25, fire: 0.08, overheat: 0.65 };
const LID_FULL_DEFAULT = 0.85;   // 全闭摆角（rad）——见 addEyes 的几何依据注释
// 四态的 sway 组整体运动（每帧写绝对值）
const SWAY_FNS = {
  idle(s, t) {          // 呼吸 ±1.5% + 缓慢摇摆
    s.scale.setScalar(1 + 0.015 * Math.sin(t * 1.7));
    s.rotation.set(0.008 * Math.sin(t * 0.83), 0, 0.02 * Math.sin(t * 0.6));
    s.position.set(0, 0.004 * Math.sin(t * 1.7), 0);
  },
  aim(s, t) {           // 手持高频低幅抖动（~±0.5mm / ±0.3°）
    s.scale.setScalar(1);
    s.rotation.set(0.004 * Math.sin(t * 37.1), 0, 0.005 * Math.sin(t * 41.3) + 0.003 * Math.sin(t * 29.7));
    s.position.set(
      0.0005 * (Math.sin(t * 33.7) + 0.6 * Math.sin(t * 51.1)),
      0.0005 * (Math.sin(t * 39.3) + 0.6 * Math.sin(t * 27.7)), 0);
  },
  fire(s, t) {          // roll ±2° 微震 + 位置抖动
    s.scale.setScalar(1);
    s.rotation.set(0.012 * Math.sin(t * 53.1), 0, 0.035 * Math.sin(t * 47.7) + 0.02 * Math.sin(t * 31.3));
    s.position.set(0.0012 * Math.sin(t * 61.7), 0.0012 * Math.sin(t * 55.3), 0);
  },
  overheat(s, t) {      // 喘气：大幅慢速起伏 + 枪口下垂
    s.scale.setScalar(1 + 0.03 * Math.sin(t * 7));
    s.rotation.set(0.03, 0, 0);
    s.position.set(0, -0.005 + 0.004 * Math.sin(t * 7), 0);
  },
};

class GunActor {
  /**
   * @param gun  builder 产出 { id, root, kick, sway, lookNode, secondary?, lids,
   *             pupilMesh, flash, laser, tracer, smoke, hotMats, channels, stateAmps }
   * @param cfg  { yawLimit, pitchLimit, rate, lidFull? } 回头限位 + 射速间隔（秒）
   */
  constructor(gun, cfg) {
    this.gun = gun;
    this.cfg = cfg;
    // 行为计数器（包内自带；宿主/探针读 actor.counts 聚合）
    this.counts = { blinkCount: 0, lookbackCount: 0, fireCount: 0, overheatCount: 0 };
    // 行为计时两条独立确定性流（铁律：禁裸 Math.random）
    this.rngB = mulberry32(hashStr(gun.id + ':blink'));
    this.rngL = mulberry32(hashStr(gun.id + ':look'));
    this.tBlink = 1.5 + this.rngB() * 3;      // 首次眨眼 1.5-4.5s
    this.tLook = 2 + this.rngL() * 4;         // 首次回头 2-6s
    this.blinkT = -1;                          // -1 = 未在眨
    this.pendingDouble = false;
    this.bstate = 'aim';                       // idle 子行为：aim | turn | gaze | back
    this.blend = 0; this.dur = 0.5; this.gazeT = 0;
    this.baseQ = gun.lookNode.quaternion.clone();
    this.fromQ = new THREE.Quaternion();
    this.toQ = new THREE.Quaternion();
    // 多节转头链（盘蛇颈节+头节）：[{ node, share }]，share 和为 1；
    // curQ 是链的「总偏转」权威值（同一根轴的 slerp 幂次拆分，组合精确等于 curQ）
    this.chain = gun.turnChain || null;
    this.curQ = new THREE.Quaternion();
    if (this.chain) for (const l of this.chain) l.baseQ = l.node.quaternion.clone();
    // 四档状态
    this.state = 'idle';                       // 实际状态（overheat 锁定时与输入不同步）
    this.desired = 'idle';                     // 输入请求状态
    this.t = 0;
    this.fireTime = 0; this.shots = 0; this.shotTimer = 0;
    this.heat = 0;                             // 0..1 红热（emissive 升温→冷却）
    this.overheatT = -1;
    this.fireT = -1;                           // 单发后坐/闪光包络
    this.tracerT = -1;
    this.lidBase = 0; this.pupilScale = 1;
    this.debugLid = null;                        // 探针强制闭合钩子（rad 或 null）
    this.channels = {};
    for (const [name, fn] of Object.entries(gun.channels || {})) {
      this.channels[name] = { amp: 0, fn };
    }
    this._v = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._qc = new THREE.Quaternion();           // 链式转头的当帧总偏转
  }

  /** 当前总偏转（链枪取 curQ，单节枪取 lookNode 当前姿态）。 */
  _curDeflection() { return this.chain ? this.curQ : this.gun.lookNode.quaternion; }

  /** 输入侧请求切状态（overheat 锁定期记为 desired，冷却结束自动恢复）。 */
  requestState(s) { this.desired = s; }

  startBlink() {
    this.blinkT = 0;
    this.counts.blinkCount++;
    this.tBlink = 2 + this.rngB() * 3;               // 下次眨眼 2-5s
    this.pendingDouble = this.rngB() < 0.22;         // 偶发双眨
  }

  /** 单发：后坐/闪光/曳光包络 + 计数（连发由 update 按射速驱动）。 */
  shot() {
    this.counts.fireCount++;
    this.shots++;
    this.fireT = 0;
    this.tracerT = 0;
    this.gun.tracer.rotation.z = this.rngB() * TAU;
  }

  /** 手动单发（探针/调试用；连发走 requestState('fire')）。 */
  fire() {
    this.shot();
    if (this.bstate === 'turn' || this.bstate === 'gaze') {
      this.bstate = 'back';
      this.fromQ.copy(this._curDeflection());
      this.dur = 0.25; this.blend = 0;
    }
  }

  startOverheat() {
    this.state = 'overheat';
    this.overheatT = 1.2;                            // 强制停火 1.2s
    this.counts.overheatCount++;
    this.fireTime = 0; this.shots = 0;
  }

  /** 计算 lookNode 看向相机的目标四元数（父空间 yaw/pitch，限位后乘基部姿态）。 */
  aimAt(camera) {
    const node = this.gun.lookNode;
    node.parent.updateWorldMatrix(true, false);
    this._v.setFromMatrixPosition(camera.matrixWorld);
    node.parent.worldToLocal(this._v).sub(node.position);
    let yaw = Math.atan2(this._v.x, this._v.z);
    let pitch = -Math.atan2(this._v.y, Math.hypot(this._v.x, this._v.z));
    const c = this.cfg;
    yaw = Math.max(-c.yawLimit, Math.min(c.yawLimit, yaw));
    pitch = Math.max(-c.pitchLimit, Math.min(c.pitchLimit, pitch));
    this._e.set(pitch, yaw, 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this.toQ.copy(this.baseQ).multiply(this._q);
  }

  setLids(a) { for (const lid of this.gun.lids) lid.rotation.x = a; }

  /** 当前眼皮角度（rad，探针/宿主调试用）。 */
  get lidAngle() { return this.gun.lids[0].rotation.x; }

  /** 调试：强制眼皮停在全闭（false 解除）。 */
  debugBlink(on = true) {
    this.debugLid = on ? (this.cfg.lidFull ?? LID_FULL_DEFAULT) : null;
  }

  /** 当前 lookNode 的偏转角（YXZ 欧拉 yaw/pitch，rad；探针测 gaze 稳定性用）。 */
  lookAngles() {
    _gsE.setFromQuaternion(this.gun.lookNode.quaternion, 'YXZ');
    return { yaw: _gsE.y, pitch: _gsE.x };
  }

  update(dt, camera) {
    const gun = this.gun, node = gun.lookNode;
    this.t += dt;
    const t = this.t;

    // --- 四档状态切换（overheat 锁定 1.2s，解除后恢复输入状态） ---
    if (this.state === 'overheat') {
      this.overheatT -= dt;
      this.heat = Math.max(0, this.overheatT / 1.2);      // 冷却渐变
      if (this.overheatT <= 0) this.state = this.desired;
    } else {
      this.state = this.desired;
      if (this.state === 'fire') {
        this.fireTime += dt;
        this.shotTimer -= dt;
        if (this.shotTimer <= 0) { this.shotTimer += this.cfg.rate; this.shot(); }
        this.heat = Math.min(1, this.fireTime / 3.0);     // 持续连发升温
        if (this.fireTime >= 3.0 || this.shots >= 24) this.startOverheat();
      } else {
        this.fireTime = Math.max(0, this.fireTime - dt * 0.8);
        if (this.fireTime === 0) this.shots = 0;
        this.shotTimer = 0;
        this.heat = Math.max(0, this.heat - dt * 0.7);
      }
    }
    // 枪身泛红（emissive 升温→冷却）
    const h = this.heat;
    for (const m of gun.hotMats) m.emissive.setRGB(0.85 * h, 0.12 * h, 0.03 * h);

    // --- 差异化通道：amp 平滑趋近目标，fn 写绝对变换 ---
    const amps = (gun.stateAmps && gun.stateAmps[this.state]) || {};
    for (const [name, ch] of Object.entries(this.channels)) {
      const target = amps[name] || 0;
      ch.amp += (target - ch.amp) * Math.min(1, dt * 9);
      if (ch.amp > 0.001 || ch.always) ch.fn(t, ch.amp, dt, this);
    }

    // --- sway 组整体运动（呼吸/手持抖/开火震/喘气） ---
    SWAY_FNS[this.state](gun.sway, t);

    // --- 眼皮基础开度（全闭角的比例制）+ 瞳孔收缩（aim 半眯专注脸 / overheat 下垂70%） ---
    const lidFull = this.cfg.lidFull ?? LID_FULL_DEFAULT;
    const lidTarget = LID_FRAC[this.state] * lidFull;
    this.lidBase += (lidTarget - this.lidBase) * Math.min(1, dt * 8);
    const pupTarget = this.state === 'aim' ? 0.72 : 1;
    this.pupilScale += (pupTarget - this.pupilScale) * Math.min(1, dt * 8);
    gun.pupilMesh.scale.setScalar(this.pupilScale);

    // --- 眨眼（idle/fire 才自主眨；aim 保持半眯、overheat 保持下垂） ---
    if (this.state === 'idle' || this.state === 'fire') {
      this.tBlink -= dt;
      if (this.tBlink <= 0 && this.blinkT < 0) this.startBlink();
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt / 0.12;
      if (this.blinkT >= 1) {
        this.blinkT = -1;
        if (this.pendingDouble) { this.pendingDouble = false; this.startBlink(); }
      }
    }
    const bump = this.blinkT >= 0 ? Math.sin(Math.PI * Math.min(this.blinkT, 1)) * lidFull * 1.06 : 0;
    this.setLids(Math.min(lidFull * 1.06, this.lidBase + bump));
    // 探针强制闭合钩子（__pmtk.debugBlink）：非 null 时覆盖一切眼皮计算
    if (this.debugLid != null) this.setLids(this.debugLid);

    // --- 闲置回头子状态机（仅 idle；离开 idle 时正在回头则快速归位） ---
    if (this.state !== 'idle' && (this.bstate === 'turn' || this.bstate === 'gaze')) {
      this.bstate = 'back';
      this.fromQ.copy(this._curDeflection());
      this.dur = 0.3; this.blend = 0;
    }
    switch (this.bstate) {
      case 'aim':
        if (this.state === 'idle') {
          this.tLook -= dt;
          if (this.tLook <= 0) {
            this.bstate = 'turn'; this.blend = 0; this.dur = 0.5;
            this.fromQ.copy(this._curDeflection());
            this.aimAt(camera);
            this.counts.lookbackCount++;
          }
        }
        break;
      case 'turn':
      case 'back': {
        const target = this.bstate === 'turn' ? this.toQ : this.baseQ;
        this.blend = Math.min(1, this.blend + dt / this.dur);
        const k = this.blend * this.blend * (3 - 2 * this.blend);   // smoothstep 缓动
        if (this.chain) {
          // 多节转头：总偏转 curQ 平滑推进，按 share 拆到颈节/头节（S 形回望）
          this.curQ.slerpQuaternions(this.fromQ, target, k);
          for (const l of this.chain) {
            l.node.quaternion.slerpQuaternions(l.baseQ, this.curQ, l.share);
          }
        } else {
          node.quaternion.slerpQuaternions(this.fromQ, target, k);
        }
        if (this.blend >= 1) {
          if (this.bstate === 'turn') {
            this.bstate = 'gaze';
            this.gazeT = 1.5 + this.rngL();                          // 注视 1.5-2.5s
            if (this.blinkT < 0) this.startBlink();                  // 注视时眨一次
          } else {
            this.bstate = 'aim';
            this.tLook = 3 + this.rngL() * 4;                        // 下次回头 3-7s
          }
        }
        break;
      }
      case 'gaze':
        this.gazeT -= dt;
        if (this.gazeT <= 0) {
          this.bstate = 'back';
          this.fromQ.copy(this._curDeflection());
          this.dur = 0.55; this.blend = 0;
        }
        break;
    }

    // --- 次级随动节点（鳄鱼头微抬）：绝对赋值 = 单位四元数向「当前偏转 × factor」
    //     球面插值。【根因记录】这里曾经用 premultiply 每帧往现有四元数上累乘——
    //     gaze 阶段偏转非单位且恒定，累乘导致鳄鱼头无限加速旋转（用户目检「转个
    //     不停」）。姿态合成必须每帧从基准绝对重算，任何「在上一帧结果上再乘一点」
    //     的写法都是积累误差/旋转的隐患。其余四把无 secondary，主 lookNode 路径
    //     全程 slerpQuaternions(from,to,k) 绝对插值、目标 yaw 由 atan2 当场解算
    //     （值域 ±π 对称 clamp），无角度累加，无同类隐患。 ---
    if (gun.secondary) {
      this._q.copy(this.baseQ).invert().multiply(node.quaternion);   // 当前偏转
      gun.secondary.node.quaternion.copy(ID_Q).slerp(this._q, gun.secondary.factor);
    }

    // --- 激光瞄准线（aim 常驻半透明；fire 提亮，mr-gun 同款） ---
    const laserOn = this.state === 'aim' || this.state === 'fire';
    gun.laser.visible = laserOn;
    if (laserOn) LASER_MAT.opacity = this.state === 'fire' ? 0.95 : 0.45;

    // --- 单发后坐/闪光包络（0.16s；闪光只亮 50ms） ---
    if (this.fireT >= 0) {
      this.fireT += dt;
      const f = this.fireT / 0.16;
      if (f >= 1) {
        this.fireT = -1;
        gun.kick.position.z = 0; gun.kick.rotation.x = 0;
        gun.flash.visible = false;
      } else {
        const env = Math.sin(Math.PI * f);
        gun.kick.position.z = -0.03 * env;     // 后坐
        gun.kick.rotation.x = -0.07 * env;     // 枪口上跳
        gun.flash.visible = this.fireT < 0.05;
        if (gun.flash.visible) gun.flash.rotation.z = this.rngB() * TAU;
      }
    }

    // --- 曳光 80ms 淡出 ---
    if (this.tracerT >= 0) {
      this.tracerT += dt;
      if (this.tracerT > 0.08) { this.tracerT = -1; gun.tracer.visible = false; }
      else {
        gun.tracer.visible = true;
        gun.tracer.material.opacity = 0.9 * (1 - this.tracerT / 0.08);
      }
    }

    // --- 过热冒烟（2 片循环上升淡出） ---
    const sm = gun.smoke;
    if (this.state === 'overheat') {
      sm.group.visible = true;
      sm.sprites.forEach((sp, i) => {
        const p = (t * 0.8 + i / sm.sprites.length) % 1;
        sp.position.set(Math.sin((p + i) * 9) * 0.012, p * 0.16, 0);
        sp.scale.setScalar(0.03 + p * 0.07);
        sp.material.opacity = 0.55 * (1 - p);
      });
    } else if (sm.group.visible) {
      sm.group.visible = false;
    }
  }
}


// --- 导出（宿主建自定义枪用全套；入口 gunpals.js 再聚） --------------------------------
export {
  TAU, bioMat, metalMat, boxGeo, dirEuler, mergeGeoms, attach,
  capProfile, emitBrows, addEyes, addFlash, makeLaser, makeTracer, makeSmoke,
  shell, GunActor, LID_FULL_DEFAULT,
};
