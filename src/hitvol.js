/**
 * 部件级有向碰撞盒（OBB）命中判定——射击判定与单体查看器可视化的唯一真源。
 *
 * 结构（生成期由 src/bake.js 产出，随烘焙产物走）：
 *   baked.hitboxes = [{ joint, part, min:[3], max:[3] }]   // bind 模型空间 Box3，
 *     按叶关节合并（头/躯干/髋/双臂×2/双腿×2，~11 盒；爬行者同机制 ~10 盒）；
 *     part ∈ head/torso/hips/arm/leg；破布条与接触影不做碰撞体，眼睛等小件并入头盒
 *   baked.hitSphere = { c:[3], r }                          // 粗筛总球（盒并集外接球
 *     + 四肢摆动余量），实例级，预计算
 *
 * 运行时判定（按需，零每帧开销；开枪才走）：
 *   a. 粗筛：世界射线 vs 每实例 hitSphere（coarseSphereWorld 展开到世界系）；
 *   b. 精筛：粗筛命中的实例，把射线逆变换回 bind 模型空间（实例位置/朝向/scale
 *      的逆），再对每个部件盒：用关节链 FK 矩阵（与顶点着色器 BEGINNORMAL/BEGIN
 *      同一条公式：chain 逐节 T(piv)·R(q)·T(-piv) 复合，bob 是最外层 +y）把
 *      射线逆变换进盒的 bind 局部系做 slab 测试——**盒永远静止在 bind 系，
 *      动的是射线**。t 参数全程不变（原点/方向同步缩放），与包围球 t 直接可比。
 *   c. 取最近命中部位 → PART_MULT 伤害倍率表。
 *
 * 姿态数据源（quatAt 读取器契约 = { bob, at(jointId, outQuat) }）：
 *   shooter 侧 = makeRowQuatReader 直接读关节纹理行（fillJoints 每帧填的那份，
 *   与顶点着色器同源同数据）；查看器侧 = 从真实 rig 的关节 rotation 现读。
 *   FK 链式复用：beginFk() 清缓存后同次求值的共享前缀（hips→torso）只算一次。
 *
 * 逐实例 jitter（j.leg/j.chest/j.head）烘焙时已拍平进几何，盒按参考 rig 烘——
 * 与 instanced 渲染的几何完全一致；单体查看器用黄点（rig 真值）对照验证。
 */

import * as THREE from 'three';
import { MAX_JOINTS } from './bake.js';

/** 部位伤害倍率表（唯一真源；面板显示同一份）。头要害 ×3 / 躯干 ×1 / 四肢 ×0.5。 */
export const PART_MULT = { head: 3, torso: 1, hips: 1, arm: 0.5, leg: 0.5 };

// ---------------------------------------------------------------------------
// quatAt 读取器
// ---------------------------------------------------------------------------

/**
 * 关节纹理行读取器（shooter 用）。单例复用，零分配：
 *   rowReader.set(b.jointData, i, MAX_JOINTS) 后传给 raycastWorld 等。
 */
export const rowReader = {
  data: null, row: 0, width: MAX_JOINTS, bob: 0,
  set(data, row, width) {
    this.data = data; this.row = row; this.width = width;
    this.bob = data[row * width * 4];          // 列 0 x = body bob
    return this;
  },
  at(j, q) {
    const o = (this.row * this.width + j) * 4;
    q.set(this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]);
  },
};

// ---------------------------------------------------------------------------
// 关节链 FK（与顶点着色器的 hQrot/hT 累积同一条公式）
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _step = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _jm = [];                               // 每关节复合矩阵缓存（链式复用）
for (let i = 0; i < MAX_JOINTS; i++) _jm.push(new THREE.Matrix4());
const _jmOk = new Array(MAX_JOINTS).fill(false);

/** 清 FK 缓存。同一实例/同一帧的一组求值前调一次（raycast* 内部已自理）。 */
export function beginFk() { _jmOk.fill(false); }

/** 关节 j 的 bind→动画 模型空间矩阵（不含 bob；缓存复用共享前缀）。 */
function jointMatrix(baked, quatAt, j) {
  if (_jmOk[j]) return _jm[j];
  const m = _jm[j].identity();
  const cs = baked.chainStart[j], cl = baked.chainLen[j];
  for (let k = 0; k < cl; k++) {
    const jj = baked.chainList[cs + k];
    quatAt.at(jj, _q);
    const px = baked.pivots[jj * 3], py = baked.pivots[jj * 3 + 1], pz = baked.pivots[jj * 3 + 2];
    _v.set(px, py, pz).applyQuaternion(_q);    // R*piv
    _step.makeRotationFromQuaternion(_q);
    _step.setPosition(px - _v.x, py - _v.y, pz - _v.z);   // T(piv)·R·T(-piv)
    m.multiply(_step);
  }
  _jmOk[j] = true;
  return m;
}

/**
 * 关节 j 的完整模型空间矩阵（含最外层 body bob；与着色器
 * `transformed = hQrot(hQ,v)+hT; transformed.y += hBob` 一致）。
 * 调用前必须 beginFk()（同帧多盒共享前缀缓存）。
 */
export function fkBoxMatrix(baked, quatAt, joint, out) {
  out.copy(jointMatrix(baked, quatAt, joint));
  out.elements[13] += quatAt.bob;
  return out;
}

// ---------------------------------------------------------------------------
// 射线判定
// ---------------------------------------------------------------------------

const _inv = new THREE.Matrix4();
const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
const _lo = new THREE.Vector3(), _ld = new THREE.Vector3();

/** 局部射线 vs 一个 bind 系 Box3（slab）。入口 t > 0.05；返回 t 或 -1。 */
function slabBox(ox, oy, oz, dx, dy, dz, hb, t1) {
  let t0 = 0.05;
  // x
  if (dx === 0) { if (ox < hb.min[0] || ox > hb.max[0]) return -1; }
  else {
    const iv = 1 / dx;
    let ta = (hb.min[0] - ox) * iv, tb = (hb.max[0] - ox) * iv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  // y
  if (dy === 0) { if (oy < hb.min[1] || oy > hb.max[1]) return -1; }
  else {
    const iv = 1 / dy;
    let ta = (hb.min[1] - oy) * iv, tb = (hb.max[1] - oy) * iv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  // z
  if (dz === 0) { if (oz < hb.min[2] || oz > hb.max[2]) return -1; }
  else {
    const iv = 1 / dz;
    let ta = (hb.min[2] - oz) * iv, tb = (hb.max[2] - oz) * iv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0 < t1 ? t0 : -1;
}

/**
 * bind 模型空间射线 vs 全部部件盒，取最近命中。
 * out = { t, part, joint }；未命中返回 null。t 参数与世界系一致（可跨实例比较）。
 */
export function raycastLocal(baked, quatAt, ro, rd, out) {
  beginFk();
  let best = Infinity, hitBox = null;
  for (const hb of baked.hitboxes) {
    _inv.copy(jointMatrix(baked, quatAt, hb.joint)).invert();
    // bob 是最外层 +y 平移：先折进原点（逆变换 T(0,-bob,0) 再 M⁻¹）
    _ro.copy(ro); _ro.y -= quatAt.bob; _ro.applyMatrix4(_inv);
    const e = _inv.elements;                   // 刚性矩阵：方向只乘旋转部，不缩放不归一
    _rd.set(
      e[0] * rd.x + e[4] * rd.y + e[8] * rd.z,
      e[1] * rd.x + e[5] * rd.y + e[9] * rd.z,
      e[2] * rd.x + e[6] * rd.y + e[10] * rd.z);
    const t = slabBox(_ro.x, _ro.y, _ro.z, _rd.x, _rd.y, _rd.z, hb, best);
    if (t >= 0 && t < best) { best = t; hitBox = hb; }
  }
  if (!hitBox) return null;
  out.t = best; out.part = hitBox.part; out.joint = hitBox.joint;
  return out;
}

/** 粗筛总球展开到世界系。st = { x, z, heading, scale }；out = { x, y, z, r }。 */
export function coarseSphereWorld(baked, st, out) {
  const c = baked.hitSphere.c, s = st.scale;
  const sinH = Math.sin(st.heading), cosH = Math.cos(st.heading);
  out.x = st.x + (c[0] * cosH + c[2] * sinH) * s;
  out.y = c[1] * s;
  out.z = st.z + (-c[0] * sinH + c[2] * cosH) * s;
  out.r = baked.hitSphere.r * s;
  return out;
}

/**
 * 世界射线 vs 一个实例的全部部件盒（精筛本体；调用方先做粗筛）。
 * 射线逆变换进 bind 模型系：p_l = R_y(-heading)·(p - pos)/scale，
 * 原点/方向同步除 scale，t 参数不变。wo/wd 为世界系（wd 归一与否均可）。
 */
export function raycastWorld(baked, quatAt, st, wo, wd, out) {
  const s = st.scale, sinH = Math.sin(st.heading), cosH = Math.cos(st.heading);
  const px = (wo.x - st.x) / s, py = wo.y / s, pz = (wo.z - st.z) / s;
  _lo.set(px * cosH - pz * sinH, py, px * sinH + pz * cosH);
  const dx = wd.x / s, dy = wd.y / s, dz = wd.z / s;
  _ld.set(dx * cosH - dz * sinH, dy, dx * sinH + dz * cosH);
  return raycastLocal(baked, quatAt, _lo, _ld, out);
}

/**
 * 某部位盒心的世界坐标（shootAt 瞄准 / 探针取点用）。part ∈
 * head/torso/hips/arm/leg（同部位多盒取第一个）；找不到返回 null。
 */
export function hitboxCenterWorld(baked, quatAt, st, part, out) {
  const hb = baked.hitboxes.find(h => h.part === part);
  if (!hb) return null;
  beginFk();
  const m = fkBoxMatrix(baked, quatAt, hb.joint, _inv);   // 借用 _inv 作矩阵暂存
  _v.set((hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, (hb.min[2] + hb.max[2]) / 2);
  _v.applyMatrix4(m);
  const s = st.scale, sinH = Math.sin(st.heading), cosH = Math.cos(st.heading);
  out.set(
    st.x + (_v.x * cosH + _v.z * sinH) * s,
    _v.y * s,
    st.z + (-_v.x * sinH + _v.z * cosH) * s);
  return out;
}
