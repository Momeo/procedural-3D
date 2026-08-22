/**
 * ragdoll.js — 死亡布娃娃：手写 Verlet 求解器（不引物理引擎），求解结果按
 * 「朝向回写」折算成关节局部四元数写回该实例的关节纹理行——渲染层零改动。
 *
 * 结构：
 *   质点集（人形 14 点封顶）：hips/torso/neck/head(心) + 双臂 肩·肘 +
 *   双腿 髋·膝·脚底。骨长约束（14 条，含 hips-neck 刚性斜撑）从 bind pose
 *   FK 实测算出；初始化质点位置 = 死亡瞬间的 FK 世界位置（hitvol.js 同公式
 *   直读关节纹理行）；初速度 = 枪口冲量（射线方向 × 力度，爆头更大）。
 *
 *   求解：Verlet 积分（重力 + 阻尼）→ 4 轮距离约束松弛 → 地面 y 钳制与摩擦。
 *   朝向回写：每个关节取「驱动点对」的世界方向（如肩→肘），旋转 -heading 进
 *   模型系后，用 setFromUnitVectors(bindDir, dir) 求该链的世界朝向 w，再左乘
 *   父链已解局部四元数的逆得关节局部四元数 q_local = Qparent⁻¹·w，写回纹理行。
 *   髋部平移走 bob 通道（bob = hips.y/scale - bindHipsY），实例位置跟随髋质点。
 *
 *   断肢联动：质点/约束按其关节链查断肢掩码，链上任一关节被断 → 该点缺席
 *   （断臂尸体少 2 点 2 约束，断头尸体少头点与颈-头约束）。
 *
 * 上限 RAGDOLL_MAX = 32（满了调用方回退倾倒+沉入）。尸体静止（最大质点速度
 * 持续低于阈值 0.5s）后冻结求解，freezeAge 供主循环排「停留 ~8s 沉入回收」。
 * 全部数组预分配（32 具 × 14 点），每帧零分配。
 *
 * 爬行者物种：关节语义不同（gait.crawl），调用方不进布娃娃，回退现有倒地。
 */

import * as THREE from 'three';
import { J, MAX_JOINTS } from './bake.js';
import { rowReader, beginFk, fkBoxMatrix } from './hitvol.js';
import { random } from './rng.js';   // 冲量扰动走模块级 RNG（?seed=）

export const RAGDOLL_MAX = 32;
const MAX_PT = 14, MAX_CON = 14;
const GRAV = 12.0;          // 重力（m/s²，略大于真实值加快倒地节奏）
const DAMP = 0.99;          // 速度阻尼
const ITERS = 4;            // 距离约束松弛轮数
const GROUND_PAD = 0.035;   // 质点离地间隙（×实例 scale）
const FRICTION = 0.65;      // 地面摩擦（触地水平速度 ×(1-FRICTION)）
const FREEZE_V = 0.10;      // 冻结判据：最大质点速度 (m/s)
const FREEZE_T = 0.5;       // 低速持续时长 (s)
const FORCE_FREEZE = 6.0;   // 强制冻结 (s)——防地面上永远抖个不停

// 模板点序号
const P_HIPS = 0, P_TORSO = 1, P_NECK = 2, P_HEAD = 3,
  P_SH_L = 4, P_EL_L = 5, P_SH_R = 6, P_EL_R = 7,
  P_HIP_L = 8, P_KNEE_L = 9, P_FOOT_L = 10,
  P_HIP_R = 11, P_KNEE_R = 12, P_FOOT_R = 13;

// 点 → FK/掩码用关节（head 心与脚底尖点挂在 NECK/KNEE 的链上）
const PT_JOINT = [J.HIPS, J.TORSO, J.NECK, J.NECK, J.SH_L, J.EL_L, J.SH_R, J.EL_R,
  J.HIP_L, J.KNEE_L, J.KNEE_L, J.HIP_R, J.KNEE_R, J.KNEE_R];

// 距离约束（模板点对）；[0,2] 是躯干刚性斜撑
const CONS = [
  [P_HIPS, P_TORSO], [P_TORSO, P_NECK], [P_NECK, P_HEAD], [P_HIPS, P_NECK],
  [P_TORSO, P_SH_L], [P_SH_L, P_EL_L],
  [P_TORSO, P_SH_R], [P_SH_R, P_EL_R],
  [P_HIPS, P_HIP_L], [P_HIP_L, P_KNEE_L], [P_KNEE_L, P_FOOT_L],
  [P_HIPS, P_HIP_R], [P_HIP_R, P_KNEE_R], [P_KNEE_R, P_FOOT_R],
];

// 朝向回写表：关节 → 驱动点对（前臂冻结为与上臂同向，省一对质点）
const WR_JOINTS = [J.HIPS, J.TORSO, J.NECK, J.SH_L, J.EL_L, J.SH_R, J.EL_R,
  J.HIP_L, J.KNEE_L, J.HIP_R, J.KNEE_R];
const WR_SEG = {
  [J.HIPS]: [P_HIPS, P_TORSO], [J.TORSO]: [P_TORSO, P_NECK], [J.NECK]: [P_NECK, P_HEAD],
  [J.SH_L]: [P_SH_L, P_EL_L], [J.EL_L]: [P_SH_L, P_EL_L],
  [J.SH_R]: [P_SH_R, P_EL_R], [J.EL_R]: [P_SH_R, P_EL_R],
  [J.HIP_L]: [P_HIP_L, P_KNEE_L], [J.KNEE_L]: [P_KNEE_L, P_FOOT_L],
  [J.HIP_R]: [P_HIP_R, P_KNEE_R], [J.KNEE_R]: [P_KNEE_R, P_FOOT_R],
};
// 关节 → 父链（根→叶，求父链世界朝向用；与 bake 的 chainList 同构）
const WR_PARENT = {
  [J.HIPS]: [], [J.TORSO]: [J.HIPS], [J.NECK]: [J.HIPS, J.TORSO],
  [J.SH_L]: [J.HIPS, J.TORSO], [J.EL_L]: [J.HIPS, J.TORSO, J.SH_L],
  [J.SH_R]: [J.HIPS, J.TORSO], [J.EL_R]: [J.HIPS, J.TORSO, J.SH_R],
  [J.HIP_L]: [J.HIPS], [J.KNEE_L]: [J.HIPS, J.HIP_L],
  [J.HIP_R]: [J.HIPS], [J.KNEE_R]: [J.HIPS, J.HIP_R],
};

/**
 * 每物种建一次模板：bind 位置（含头心/脚底尖点）、约束长、每点关节链、
 * 回写 bind 方向。头心取 head 部件盒中心；脚底 = 膝 pivot 沿小腿 bind 方向
 * 再延一个小腿长。
 */
export function buildRagdollTemplate(baked) {
  const piv = (j) => new THREE.Vector3(baked.pivots[j * 3], baked.pivots[j * 3 + 1], baked.pivots[j * 3 + 2]);
  const hb = baked.hitboxes.find(h => h.part === 'head');
  const headC = hb
    ? new THREE.Vector3((hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, (hb.min[2] + hb.max[2]) / 2)
    : piv(J.NECK).add(new THREE.Vector3(0, 0.15, 0));
  const foot = (hipJ, kneeJ) => {
    const d = piv(kneeJ).sub(piv(hipJ));
    const len = d.length() || 0.4;
    return piv(kneeJ).addScaledVector(d.normalize(), len);
  };
  const bind = [
    piv(J.HIPS), piv(J.TORSO), piv(J.NECK), headC,
    piv(J.SH_L), piv(J.EL_L), piv(J.SH_R), piv(J.EL_R),
    piv(J.HIP_L), piv(J.KNEE_L), foot(J.HIP_L, J.KNEE_L),
    piv(J.HIP_R), piv(J.KNEE_R), foot(J.HIP_R, J.KNEE_R),
  ];
  const conLen = CONS.map(([a, b]) => bind[a].distanceTo(bind[b]));
  const chains = PT_JOINT.map((j) => {
    const cs = baked.chainStart[j], cl = baked.chainLen[j];
    return Array.from(baked.chainList.slice(cs, cs + cl));
  });
  const bindDir = {};
  for (const j of WR_JOINTS) {
    const [a, b] = WR_SEG[j];
    bindDir[j] = bind[b].clone().sub(bind[a]).normalize();
  }
  return { bind, conLen, chains, bindDir, hipsPivot: piv(J.HIPS) };
}

// ---------------------------------------------------------------------------
// 布娃娃池
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
const _w = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _qs = [];                                  // 已解局部四元数（按关节 id）
for (let i = 0; i < MAX_JOINTS; i++) _qs.push(new THREE.Quaternion());

export function makeRagdollPool() {
  const pos = new Float32Array(RAGDOLL_MAX * MAX_PT * 3);
  const prev = new Float32Array(RAGDOLL_MAX * MAX_PT * 3);
  const slots = [];
  for (let s = 0; s < RAGDOLL_MAX; s++) {
    slots.push({
      idx: s, base: s * MAX_PT * 3,
      active: false, frozen: false,
      b: null, row: 0, st: null, tpl: null,
      n: 0, map: new Int8Array(MAX_PT),          // 模板点 → 槽内局部序号（-1 = 断肢缺席）
      cons: new Int16Array(MAX_CON * 2), conLen: new Float32Array(MAX_CON), nc: 0,
      scale: 1, cosH: 1, sinH: 0, mask: 0,
      age: 0, stillT: 0, freezeAge: -1,          // freezeAge：冻结时刻 age（主循环排沉入）
    });
  }
  let activeCount = 0;

  /**
   * 死亡瞬间起一具布娃娃；满了返回 -1（调用方回退倾倒+沉入）。
   * dir = 枪口射线方向（世界系），power = 冲量力度（爆头更大）。
   */
  function start(b, i, dirX, dirY, dirZ, power) {
    if (activeCount >= RAGDOLL_MAX) return -1;
    const st = b.states[i];
    const tpl = b.ragTemplate || (b.ragTemplate = buildRagdollTemplate(b.baked));
    const slot = slots.find(s => !s.active);
    const mask = st.severMask || 0;
    slot.b = b; slot.row = i; slot.st = st; slot.tpl = tpl;
    slot.mask = mask;
    slot.scale = st.scale;
    slot.cosH = Math.cos(st.heading); slot.sinH = Math.sin(st.heading);
    slot.age = 0; slot.stillT = 0; slot.freezeAge = -1;
    slot.frozen = false; slot.active = true;

    // 质点初始化：FK 世界位置（hitvol 同公式直读纹理行），初速 = 冲量 + 随机扰动
    rowReader.set(b.jointData, i, MAX_JOINTS);
    beginFk();
    const dt0 = 1 / 60;
    let n = 0;
    for (let p = 0; p < MAX_PT; p++) {
      const ch = tpl.chains[p];
      let gone = false;
      for (let k = 0; k < ch.length; k++) if (mask & (1 << ch[k])) { gone = true; break; }
      slot.map[p] = gone ? -1 : n++;
      if (gone) continue;
      const o = slot.base + slot.map[p] * 3;
      fkBoxMatrix(b.baked, rowReader, PT_JOINT[p], _m);
      _v.copy(tpl.bind[p]).applyMatrix4(_m);       // posed 模型空间
      const wx = st.x + (_v.x * slot.cosH + _v.z * slot.sinH) * slot.scale;
      const wy = _v.y * slot.scale;
      const wz = st.z + (-_v.x * slot.sinH + _v.z * slot.cosH) * slot.scale;
      pos[o] = wx; pos[o + 1] = wy; pos[o + 2] = wz;
      const jx = dirX * power + (random() - 0.5) * 0.7;
      const jy = dirY * power + 0.6 + random() * 0.5;
      const jz = dirZ * power + (random() - 0.5) * 0.7;
      prev[o] = wx - jx * dt0; prev[o + 1] = wy - jy * dt0; prev[o + 2] = wz - jz * dt0;
    }
    slot.n = n;
    let nc = 0;
    for (let k = 0; k < CONS.length; k++) {
      const a = slot.map[CONS[k][0]], c = slot.map[CONS[k][1]];
      if (a < 0 || c < 0) continue;
      slot.cons[nc * 2] = a; slot.cons[nc * 2 + 1] = c;
      slot.conLen[nc] = tpl.conLen[k] * slot.scale;
      nc++;
    }
    slot.nc = nc;
    activeCount++;
    return slot.idx;
  }

  /** 朝向回写：质点对方向 → 关节局部四元数 → 该实例纹理行。 */
  function writeBack(slot) {
    const { tpl } = slot;
    const d = slot.b.jointData;
    const rowBase = slot.row * MAX_JOINTS * 4;
    for (const j of WR_JOINTS) {
      const [ta, tb] = WR_SEG[j];
      if (slot.map[ta] < 0 || slot.map[tb] < 0) continue;   // 断肢段：保持死亡姿态
      const oa = slot.base + slot.map[ta] * 3, ob = slot.base + slot.map[tb] * 3;
      _pa.set(pos[ob] - pos[oa], pos[ob + 1] - pos[oa + 1], pos[ob + 2] - pos[oa + 2]);
      if (_pa.lengthSq() < 1e-10) continue;
      _pa.normalize();
      // 世界方向 → 模型系（实例只有 R_y(heading)；归一化后 scale 无关）
      _v.set(
        _pa.x * slot.cosH - _pa.z * slot.sinH,
        _pa.y,
        _pa.x * slot.sinH + _pa.z * slot.cosH);
      _w.setFromUnitVectors(tpl.bindDir[j], _v);   // 该链的模型空间目标朝向
      // q_local = Qparent⁻¹ · w（父链局部四元数按根→叶序已解）
      _qp.identity();
      const par = WR_PARENT[j];
      for (let k = 0; k < par.length; k++) _qp.multiply(_qs[par[k]]);
      _qs[j].copy(_qp).invert().multiply(_w);
      const o = rowBase + j * 4;
      d[o] = _qs[j].x; d[o + 1] = _qs[j].y; d[o + 2] = _qs[j].z; d[o + 3] = _qs[j].w;
    }
    // bob：渲染的髋 pivot 落到髋质点高度（transformed.y += hBob 在模型系，
    // 经 instanceMatrix 的 scale 放大，故除回）
    const l0 = slot.map[P_HIPS];
    d[rowBase] = pos[slot.base + l0 * 3 + 1] / slot.scale - tpl.hipsPivot.y;
    d[rowBase + 2] = slot.mask;                     // 断肢掩码保持
    // 实例位置跟随髋质点（补偿 bind 髋 pivot 的模型 x/z 偏移）
    const hx = tpl.hipsPivot.x, hz = tpl.hipsPivot.z;
    slot.st.x = pos[slot.base + l0 * 3] - (hx * slot.cosH + hz * slot.sinH) * slot.scale;
    slot.st.z = pos[slot.base + l0 * 3 + 2] - (-hx * slot.sinH + hz * slot.cosH) * slot.scale;
    slot.b.jointTex.needsUpdate = true;
  }

  function update(dt) {
    if (!activeCount) return;
    const dt2 = dt * dt;
    for (const slot of slots) {
      if (!slot.active || slot.frozen) continue;
      slot.age += dt;
      const base = slot.base, n = slot.n;
      // Verlet 积分
      for (let p = 0; p < n; p++) {
        const o = base + p * 3;
        const x = pos[o], y = pos[o + 1], z = pos[o + 2];
        const vx = (x - prev[o]) * DAMP, vy = (y - prev[o + 1]) * DAMP, vz = (z - prev[o + 2]) * DAMP;
        prev[o] = x; prev[o + 1] = y; prev[o + 2] = z;
        pos[o] = x + vx; pos[o + 1] = y + vy - GRAV * dt2; pos[o + 2] = z + vz;
      }
      // 距离约束松弛
      for (let it = 0; it < ITERS; it++) {
        for (let c = 0; c < slot.nc; c++) {
          const a = base + slot.cons[c * 2] * 3, c2 = base + slot.cons[c * 2 + 1] * 3;
          const dx = pos[c2] - pos[a], dy = pos[c2 + 1] - pos[a + 1], dz = pos[c2 + 2] - pos[a + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (dist - slot.conLen[c]) / dist * 0.5;
          const mx = dx * diff, my = dy * diff, mz = dz * diff;
          pos[a] += mx; pos[a + 1] += my; pos[a + 2] += mz;
          pos[c2] -= mx; pos[c2 + 1] -= my; pos[c2 + 2] -= mz;
        }
      }
      // 地面钳制 + 摩擦
      const gy = GROUND_PAD * slot.scale;
      for (let p = 0; p < n; p++) {
        const o = base + p * 3;
        if (pos[o + 1] < gy) {
          pos[o + 1] = gy; prev[o + 1] = gy;       // 垂直速度清零
          prev[o] = pos[o] - (pos[o] - prev[o]) * (1 - FRICTION);
          prev[o + 2] = pos[o + 2] - (pos[o + 2] - prev[o + 2]) * (1 - FRICTION);
        }
      }
      // 冻结判定：最大质点速度持续低于阈值
      let vmax = 0;
      for (let p = 0; p < n; p++) {
        const o = base + p * 3;
        const vx = pos[o] - prev[o], vy = pos[o + 1] - prev[o + 1], vz = pos[o + 2] - prev[o + 2];
        const v = Math.sqrt(vx * vx + vy * vy + vz * vz) / dt;
        if (v > vmax) vmax = v;
      }
      if (vmax < FREEZE_V) slot.stillT += dt; else slot.stillT = 0;
      writeBack(slot);
      if (slot.stillT >= FREEZE_T || slot.age >= FORCE_FREEZE) {
        slot.frozen = true;
        slot.freezeAge = slot.age;
        for (let p = 0; p < n; p++) {              // 锁死速度防抖动
          const o = base + p * 3;
          prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
        }
      }
    }
  }

  function release(idx) {
    const slot = slots[idx];
    if (slot && slot.active) { slot.active = false; activeCount--; }
  }

  /** 探针用：活跃质点最低 y（地面穿透断言）；无活跃返回 null。 */
  function minY() {
    let m = Infinity, any = false;
    for (const slot of slots) {
      if (!slot.active) continue;
      any = true;
      for (let p = 0; p < slot.n; p++) {
        const y = pos[slot.base + p * 3 + 1];
        if (y < m) m = y;
      }
    }
    return any ? m : null;
  }

  function info() {
    let frozen = 0;
    const list = [];
    for (const slot of slots) {
      if (!slot.active) continue;
      if (slot.frozen) frozen++;
      list.push({
        slot: slot.idx, batch: slot.b.id, row: slot.row, points: slot.n, cons: slot.nc,
        age: +slot.age.toFixed(2), frozen: slot.frozen,
        freezeAge: slot.freezeAge < 0 ? null : +slot.freezeAge.toFixed(2),
      });
    }
    return { max: RAGDOLL_MAX, active: activeCount, frozen, minY: minY(), slots: list };
  }

  return {
    slots, start, update, release, minY, info,
    get activeCount() { return activeCount; },
  };
}
