/**
 * bake.js — 把 core 人形机器（或对齐人形契约的自定义 rig）产出的一只怪烘焙成
 * 「每材质一个几何 + 每顶点关节 id」的怪海用资产。
 *
 * 原理：
 *   Sands 的木乃伊是刚性盒子挂在嵌套 Group 关节上（无蒙皮），动画只是
 *   每帧写各关节的 rotation（欧拉角）。于是可以把整只怪在「全关节零旋转」
 *   的 bind pose 下烘成模型空间顶点，再给每个顶点打上它所属关节链的
 *   叶子关节 id（链是固定的：elbow 的链恒为 hips→torso→shoulder→elbow）。
 *   运行时 JS 复算各关节局部旋转四元数 → DataTexture → 顶点着色器里按链
 *   嵌套旋转（绕 bind pivot）还原姿态。
 *
 *   关节上的常量 scale（neck 的 j.head）与 mesh 上的 scale 在 bind/动画
 *   两侧同时出现而抵消，所以着色器只需纯旋转 + 平移，无需处理缩放。
 *   body 的 bob（每帧 position.y）不在关节链里，走纹理 0 号通道单独加。
 *
 *  Sands 源码一行未改，这里只做读取与遍历。
 */

import * as THREE from 'three';

/** 关节 id 常量（JS 与 GLSL 共用，着色器表由 bake 结果生成）。0 = 静态（blob 阴影）。
 *
 * 多肢体扩展（机器人物种系列）：12-23 给第二/三对腿与第二对手臂（可断肢位，
 * bit id < 24——断肢掩码存在 Float32 纹理通道里，2^24 以上 float 不精确，
 * 掩码最大 2^24-1 = 16777215 恰好仍是精确整数）。破布 pivot 整体上移到 24-31
 * （最多 8 条；现有物种运行时重新 bake，无持久化兼容问题）。 */
export const J = {
  STATIC: 0,
  HIPS: 1, TORSO: 2, NECK: 3,
  HIP_L: 4, KNEE_L: 5, HIP_R: 6, KNEE_R: 7,
  SH_L: 8, EL_L: 9, SH_R: 10, EL_R: 11,
  LEG2_L: 12, KNEE2_L: 13, LEG2_R: 14, KNEE2_R: 15,   // 第二对腿（rig.legs[2]/[3]）
  LEG3_L: 16, KNEE3_L: 17, LEG3_R: 18, KNEE3_R: 19,   // 第三对腿（rig.legs[4]/[5]）
  ARM2_L: 20, EL2_L: 21, ARM2_R: 22, EL2_R: 23,       // 第二对手臂（rig.arms[2]/[3]）
  TATTER: 24,               // 24..24+T-1 为破布 pivot
};
export const MAX_JOINTS = 32;   // 纹理宽度 / 常量表容量
export const MAX_CHAIN = 5;     // hips→torso→shoulder→elbow→tatter

/** 可断关节（断肢点 = 关节缝）：颈（断头）/ 髋·膝 / 肩·肘 + 多肢体的第二/三对腿
 * 与第二对手臂（物种没有这些关节时 bake 自然收不到几何，debris 无该键）。 */
export const SEVER_JOINTS = [J.NECK, J.HIP_L, J.KNEE_L, J.HIP_R, J.KNEE_R, J.SH_L, J.EL_L, J.SH_R, J.EL_R,
  J.LEG2_L, J.KNEE2_L, J.LEG2_R, J.KNEE2_R, J.LEG3_L, J.KNEE3_L, J.LEG3_R, J.KNEE3_R,
  J.ARM2_L, J.EL2_L, J.ARM2_R, J.EL2_R];

/** 关节叶 id → 碰撞盒部位（hitbox 表用；头的权威来源是 mesh 的 userData.region）。 */
const PART_OF_JOINT = {
  [J.HIPS]: 'hips', [J.TORSO]: 'torso', [J.NECK]: 'head',
  [J.HIP_L]: 'leg', [J.KNEE_L]: 'leg', [J.HIP_R]: 'leg', [J.KNEE_R]: 'leg',
  [J.SH_L]: 'arm', [J.EL_L]: 'arm', [J.SH_R]: 'arm', [J.EL_R]: 'arm',
  [J.LEG2_L]: 'leg', [J.KNEE2_L]: 'leg', [J.LEG2_R]: 'leg', [J.KNEE2_R]: 'leg',
  [J.LEG3_L]: 'leg', [J.KNEE3_L]: 'leg', [J.LEG3_R]: 'leg', [J.KNEE3_R]: 'leg',
  [J.ARM2_L]: 'arm', [J.EL2_L]: 'arm', [J.ARM2_R]: 'arm', [J.EL2_R]: 'arm',
};

/**
 * 烘焙一只怪（参考 rig）。
 * @returns {{
 *   parts: Array<{ geometry: THREE.BufferGeometry, material: THREE.Material, blob: boolean }>,
 *   pivots: Float32Array,        // MAX_JOINTS*3，bind pose 模型空间 pivot
 *   chainStart: Int32Array, chainLen: Int32Array, chainList: Int32Array,
 *   jointCount: number,          // 实际用到的关节数（含 0 号静态槽）
 *   hitboxes: Array<{ joint:number, part:string, min:[3], max:[3] }>,
 *                               // 部件碰撞盒：bind 模型空间 Box3（按叶关节合并），
 *                               //   part ∈ head/torso/hips/arm/leg；破布/接触影不收
 *   hitSphere: { c:[3], r:number },  // 粗筛总球（全体盒并集外接球 + 摆动余量）
 *   debris: Object,                  // 可断关节 id → { geometry, material, center, pieces }：
 *                                    //   该关节下游子树的局部几何（bind pose，含材质分组 pieces）
 *   stepSpan: number,            // 参考 rig 的步幅（strideRate 用）
 *   triangles: number,
 *   refActor: object,
 * }}
 */
export function bakeMummy(createEnemy, MUMMY) {
  // build 内每条破布有 10% 概率随机缺失；重掷到全保留，让所有实例共享同一几何
  // （壳体系 proportions 无 tatters，0 >= 0 一次通过）
  const tatterSpec = MUMMY.proportions.tatters || [];
  let actor = null;
  for (let tries = 0; tries < 60; tries++) {
    actor = createEnemy(MUMMY, tries);
    if (actor.rig.tatters.length >= tatterSpec.length) break;
  }
  const rig = actor.rig;

  // --- 关节对象 → id 映射 -------------------------------------------------
  const jmap = new Map();
  jmap.set(rig.hips, J.HIPS);
  // 壳体系自有 rig：hips === torso === body，
  // 六足甲虫只有一段躯干，body 本体就注册成 HIPS 关节并纳入链（chainOf
  // 终点随之放宽到 group），壳体的俯仰/翻滚才能进关节纹理；
  // 人形 rig 的 torso 是独立子关节，照常注册
  if (rig.torso !== rig.hips) jmap.set(rig.torso, J.TORSO);
  jmap.set(rig.neck, J.NECK);
  // 双腿（可选）：无四肢物种（maggot）legs=[]，跳过
  if (rig.legs[0]) { jmap.set(rig.legs[0].hip, J.HIP_L); jmap.set(rig.legs[0].knee, J.KNEE_L); }   // side -1
  if (rig.legs[1]) { jmap.set(rig.legs[1].hip, J.HIP_R); jmap.set(rig.legs[1].knee, J.KNEE_R); }   // side +1
  // 手臂（可选）：壳体系 arms=[]，跳过
  if (rig.arms[0]) { jmap.set(rig.arms[0].shoulder, J.SH_L); jmap.set(rig.arms[0].elbow, J.EL_L); }
  if (rig.arms[1]) { jmap.set(rig.arms[1].shoulder, J.SH_R); jmap.set(rig.arms[1].elbow, J.EL_R); }
  // 多肢体扩展（可选）：第二/三对腿、第二对手臂（rig 没有就不注册）
  if (rig.legs[2]) { jmap.set(rig.legs[2].hip, J.LEG2_L); jmap.set(rig.legs[2].knee, J.KNEE2_L); }
  if (rig.legs[3]) { jmap.set(rig.legs[3].hip, J.LEG2_R); jmap.set(rig.legs[3].knee, J.KNEE2_R); }
  if (rig.legs[4]) { jmap.set(rig.legs[4].hip, J.LEG3_L); jmap.set(rig.legs[4].knee, J.KNEE3_L); }
  if (rig.legs[5]) { jmap.set(rig.legs[5].hip, J.LEG3_R); jmap.set(rig.legs[5].knee, J.KNEE3_R); }
  if (rig.arms[2]) { jmap.set(rig.arms[2].shoulder, J.ARM2_L); jmap.set(rig.arms[2].elbow, J.EL2_L); }
  if (rig.arms[3]) { jmap.set(rig.arms[3].shoulder, J.ARM2_R); jmap.set(rig.arms[3].elbow, J.EL2_R); }
  rig.tatters.forEach((t, i) => jmap.set(t.pivot, J.TATTER + i));
  const jointCount = J.TATTER + rig.tatters.length;

  // --- 建立 bind pose：所有动画写入的旋转/位移归零 -------------------------
  // （twistBase / neckBase / 破布 yaw / restZ 属动画值的一部分，运行时由
  //   gait.js 按原公式完整还给关节，所以这里必须归零后再烘）
  // 壳体系例外：body.y = 结构骑高 rideHeight 而非纯动画 bob——保留进烘焙，
  // 壳体几何烘在正确高度，HIPS 关节 pivot 落在体心；运行时 bob 通道只加起伏
  const bodyBindY = rig.hips === rig.body ? (MUMMY.proportions.rideHeight || 0) : 0;
  rig.body.position.set(0, bodyBindY, 0);
  rig.body.rotation.set(0, 0, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.neck.rotation.set(0, 0, 0);
  for (const leg of rig.legs) { leg.hip.rotation.set(0, 0, 0); leg.knee.rotation.set(0, 0, 0); }
  for (const arm of rig.arms) { arm.shoulder.rotation.set(0, 0, 0); arm.elbow.rotation.set(0, 0, 0); }
  for (const t of rig.tatters) t.pivot.rotation.set(0, 0, 0);
  rig.group.position.set(0, 0, 0);
  rig.group.rotation.set(0, 0, 0);
  rig.group.scale.set(1, 1, 1);
  rig.group.updateMatrixWorld(true);

  // --- 每关节 bind pivot（模型空间 = group 空间） --------------------------
  const pivots = new Float32Array(MAX_JOINTS * 3);
  const tmpV = new THREE.Vector3();
  for (const [obj, id] of jmap) {
    tmpV.setFromMatrixPosition(obj.matrixWorld);
    pivots[id * 3] = tmpV.x; pivots[id * 3 + 1] = tmpV.y; pivots[id * 3 + 2] = tmpV.z;
  }

  // --- 每个叶子关节的链（根→叶），沿真实层级向上走 -------------------------
  const chainStart = new Int32Array(MAX_JOINTS);
  const chainLen = new Int32Array(MAX_JOINTS);
  const chainList = new Int32Array(MAX_JOINTS * MAX_CHAIN).fill(0);
  const chainOf = (obj) => {
    const ids = [];
    // 终点是 group 而非 body：壳体系的 body 本身是注册的 HIPS 关节，必须
    // 进链；人形 rig 的 body 不在 jmap 里，向上多走一级结果与旧版逐链一致
    for (let n = obj; n && n !== rig.group; n = n.parent) {
      if (jmap.has(n)) ids.unshift(jmap.get(n));
    }
    return ids;
  };
  for (const [obj, id] of jmap) {
    const ids = chainOf(obj);
    chainStart[id] = id * MAX_CHAIN;
    chainLen[id] = ids.length;
    ids.forEach((j, k) => { chainList[id * MAX_CHAIN + k] = j; });
  }

  // --- 收集 mesh：body 下全部（含破布，rig.meshes 不含破布） + blob --------
  const meshes = [];
  rig.body.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const blob = rig.blob;

  // --- 逐 mesh 烘焙：顶点烘到 bind 模型空间，记录叶子关节 id ---------------
  const byMat = new Map();   // material → { geoms: [], jointIds: [] }
  const pushGeo = (mesh, leafId) => {
    const src = mesh.geometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    g.applyMatrix4(mesh.matrixWorld);
    let bucket = byMat.get(mesh.material);
    if (!bucket) { bucket = { geoms: [], jointIds: [] }; byMat.set(mesh.material, bucket); }
    bucket.geoms.push(g);
    bucket.jointIds.push(leafId);
    return g;
  };
  // 部件碰撞盒（hitbox）顺手收集：同叶关节的 mesh 合并成一盒，bind 模型空间
  // Box3 + 叶关节 id + 部位。破布（TATTER 叶）与接触影（STATIC）不收；
  // 眼睛等小件 region 'head' 并入头盒。运行时判定见 src/hitvol.js。
  // mesh.userData.noHit（crawler 破布同名字段）：细长装饰件（天线/角/冠鳍等）
  // 照常烘焙渲染、照常进断肢子树，但不并入碰撞盒——否则一根天线就把头盒
  // 撑大一截，玩家「打空气爆头」。
  const hitMap = new Map();   // leafId → { joint, part, min:[x,y,z], max:[x,y,z] }
  const bakedMeshes = [];     // 断肢几何原料：{ ids(链), leaf, g(bind 模型空间几何), material }
  for (const m of meshes) {
    const ids = chainOf(m.parent);
    const leaf = ids.length ? ids[ids.length - 1] : J.STATIC;
    const g = pushGeo(m, leaf);
    bakedMeshes.push({ ids, leaf, g, material: m.material });
    if (m.userData.noHit) continue;
    const part = m.userData.region === 'head' ? 'head' : PART_OF_JOINT[leaf];
    if (!part) continue;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    let hb = hitMap.get(leaf);
    if (!hb) {
      hb = { joint: leaf, part, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      hitMap.set(leaf, hb);
    }
    for (let a = 0; a < 3; a++) {
      const lo = a === 0 ? bb.min.x : a === 1 ? bb.min.y : bb.min.z;
      const hi = a === 0 ? bb.max.x : a === 1 ? bb.max.y : bb.max.z;
      if (lo < hb.min[a]) hb.min[a] = lo;
      if (hi > hb.max[a]) hb.max[a] = hi;
    }
  }
  if (blob) pushGeo(blob, J.STATIC);
  const hitboxes = [...hitMap.values()];
  // 粗筛总球：全体盒并集的外接球 + 摆动余量（四肢摆离 bind 位的最大幅度）
  const hitSphere = (() => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const hb of hitboxes) for (let a = 0; a < 3; a++) {
      if (hb.min[a] < mn[a]) mn[a] = hb.min[a];
      if (hb.max[a] > mx[a]) mx[a] = hb.max[a];
    }
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    let r = 0;
    for (const hb of hitboxes) for (const cx of [hb.min[0], hb.max[0]])
      for (const cy of [hb.min[1], hb.max[1]]) for (const cz of [hb.min[2], hb.max[2]]) {
        const d = Math.hypot(cx - c[0], cy - c[1], cz - c[2]);
        if (d > r) r = d;
      }
    const P = MUMMY.proportions;
    const limb = Math.max((P.thighL || 0) + (P.shinL || 0), (P.upperL || 0) + (P.foreL || 0));
    return { c, r: r + 0.35 * limb };   // 摆动余量：粗筛宁宽勿漏
  })();

  // --- 断肢几何：每个可断关节的下游子树局部几何 ------------------------------
  // 断在哪条链 = 收集「链上包含该关节」的全部部件 mesh（破布/接触影/眼睛不收……
  // 眼睛 region=head 链过 NECK，会并进断头件，材质分组里保留其自发光材质）。
  // 产出两个形态：
  //   geometry/material：合并成单几何 + 顶点数最多的主材质，原点平移到子树
  //     包围盒中心——断肢飞舞池（examples/shooter.html）直接拿它做 1 draw call 残肢；
  //   pieces：按材质分组的原始件（bind 模型空间，未平移），备胎/调试用。
  const debris = {};
  for (const sj of SEVER_JOINTS) {
    const pieces = [];
    for (const bm of bakedMeshes) {
      if (bm.leaf === J.STATIC || bm.leaf >= J.TATTER) continue;
      if (bm.ids.indexOf(sj) < 0) continue;
      pieces.push({ geometry: bm.g, material: bm.material });
    }
    if (!pieces.length) continue;
    let total = 0, dom = pieces[0], domN = 0;
    for (const p of pieces) {
      const n = p.geometry.attributes.position.count;
      total += n;
      if (n > domN) { domN = n; dom = p; }
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let off = 0;
    for (const p of pieces) {
      const n = p.geometry.attributes.position.count;
      pos.set(p.geometry.attributes.position.array, off * 3);
      if (p.geometry.attributes.normal) nor.set(p.geometry.attributes.normal.array, off * 3);
      if (p.geometry.attributes.uv) uv.set(p.geometry.attributes.uv.array, off * 2);
      off += n;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const center = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
    geometry.translate(-center[0], -center[1], -center[2]);
    debris[sj] = { geometry, material: dom.material, center, pieces };
  }

  // --- 按材质合并 ----------------------------------------------------------
  const parts = [];
  for (const [mat, bucket] of byMat) {
    let total = 0;
    for (const g of bucket.geoms) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const aJoint = new Float32Array(total);
    let off = 0;
    bucket.geoms.forEach((g, gi) => {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      aJoint.fill(bucket.jointIds[gi], off, off + n);
      off += n;
      g.dispose();
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aJoint', new THREE.BufferAttribute(aJoint, 1));
    parts.push({ geometry, material: mat, blob: mat === (blob && blob.material) });
  }

  return {
    parts, pivots, chainStart, chainLen, chainList, jointCount,
    hitboxes, hitSphere,         // 部件级碰撞盒表 + 粗筛总球（hitvol.js 消费）
    debris,                      // 断肢子树几何（SEVER_JOINTS 各键；断肢飞舞池消费）
    stepSpan: rig.stepSpan,
    triangles: actor.triangles,
    refActor: actor,
  };
}
