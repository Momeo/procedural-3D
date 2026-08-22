/**
 * gait.js — JS 侧 1:1 复算 Sands animateHumanoid 的关节角（mummy.js，一行未改的是
 * 源码；这里是对其公式的转写），输出每个关节的局部旋转四元数到怪海关节纹理。
 *
 * 复算范围 = 行走循环 + 攻击（windup→strike→recover）+ 受击（stagger 趔趄
 * + reactToHit 落点抽动）。攻击/受击的逐实例状态（atkT/stgT 时码）挂在
 * makeGaitParams 产出的 prm 上，由 triggerAttack / triggerStagger 触发，
 * 时码推进在各 fill 函数里（dt 驱动，advanceActions）；攻击期间双臂与躯干
 * 被攻击姿态整个接管（原版语义：不叠加），双腿继续走步态（调用方负责把
 * prm.speed 归零让原地站定，examples/shooter.html 的 atkFrozen 即此）。
 * 受击的全身趔趄原版写在 rig.body（hips 的父级）上，instanced 管线没有
 * body 旋转通道，折进 HIPS 关节（hips 子树 = body 子树，等效）+ bob 通道。
 *
 * 常量全部抄自 mummy.js：TRUNK_LAG / DRAG_SWING / LOAD_LAG / REACH / IDLE_RATE /
 * weighted()，以及各关节的赋值公式。欧拉角顺序为 three 默认 'XYZ'，与原版
 * joint.rotation.x/.y/.z 赋值语义一致。
 *
 * 纹理布局（RGBA32F，宽 32 = MAX_JOINTS，高 = 实例数）：
 *   列 0      = (bob, flash, severMask, 0)   body 垂直起伏 + 受击闪白 + 断肢掩码
 *   列 1..11  = hips/torso/neck/双腿/双臂关节四元数（见 bake.js 的 J 表）
 *   列 12..23 = 多肢体扩展：第二/三对腿、第二对手臂（机器人物种，bake.js J 表）
 *   列 24..   = 破布 pivot 四元数
 *
 * 断肢掩码：bit j 置位 = 关节 j 及下游全部隐藏（顶点着色器按链检查并塌缩顶点）。
 * 由 prm.severMask 逐实例驱动，初始 0；断双腿时 prm.crawl=true 切缺腿爬行步态
 * （fillLeglessCrawl），断单腿由调用方降 prm.speed 实现跛行。
 */

import { J } from './bake.js';
import { mulberry32, random } from './rng.js';

// --- 抄自 mummy.js 的步态常量 ----------------------------------------------
const TRUNK_LAG = 0.62;
const TRUNK_LAG_C = Math.cos(TRUNK_LAG);
const TRUNK_LAG_S = Math.sin(TRUNK_LAG);
const DRAG_SWING = 0.64;
const LOAD_LAG = 0.55;
const LOAD_C = Math.cos(LOAD_LAG);
const LOAD_S = Math.sin(LOAD_LAG);
const REACH = 0.82;
const IDLE_RATE = 0.9;
const TAU = Math.PI * 2;

function weighted(x) { return x * (1.5 - 0.5 * x * x); }

// --- 攻击/受击时码（常量抄自 mummy.js：MUMMY spec 3058 行 / update 2854/2882 /
//     decayHit 2329-2341 / hitEnvelope 1785 行） -------------------------------
const WINDUP_DUR = 0.52;    // spec.windup 缺省（秒）：前摇时长
const STRIKE_DUR = 0.42;    // spec.strikeTime 缺省（秒）：挥击时长
const STAGGER_DECAY = 2.6;  // stagger 线性衰减率（每秒）
const HIT_DECAY = 7.5;      // 落点抽动包络的精确指数衰减率（每秒）
const HIT_ATTACK = 0.055;   // 包络上升沿（秒到满幅）

/**
 * 逐实例动作状态（攻击/受击）。makeGaitParams 的产出自带一份；单体查看器
 * （index.html）与 naive 对照组（horde.html）用同一结构驱动 rig 直调的
 * spec.animate（animState 的 windup/strike/stagger 字段由 advanceActions 填）。
 *
 * 时码语义：
 *   atkT  -1 = 空闲；≥0 = 距攻击触发的秒数。推进：0→spec.windup 秒 = 前摇
 *         （wu: 0→1），随后 spec.strikeTime 秒 = 挥击（stk: 1→0），结束归 -1。
 *   stgT  -1 = 无；≥0 = 距受击的秒数。stagger = max(0, 1 - stgT*2.6)（线性），
 *         落点抽动 hk = hitK0·exp(-7.5·stgT) 带 55ms 上升沿；两通道都死了归 -1。
 *   stgS/stgF  受击冲量在怪自身本地系的侧向/前后分量（hitF=-1 = 正面中弹后仰，
 *         原版 registerHit 由世界方向 × 怪朝向换算，调用方换算好传入）。
 *   hitLX/hitLY/hitHead  落点（-1..1 横向 / 0..1 高度 / 是否爆头），hitK0 初始强度。
 */
export function makeActionState() {
  return {
    atkT: -1, stgT: -1,
    stgS: 0, stgF: -1,
    hitLX: 0, hitLY: 0.55, hitHead: 0, hitK0: 0,
  };
}

/** 触发攻击（前摇→挥击→回收）。攻击进行中再触发被忽略（同原版状态机门）。 */
export function triggerAttack(st) {
  if (st.atkT >= 0) return false;
  st.atkT = 0;
  return true;
}

/**
 * 触发受击趔趄 + 落点抽动。opts: { lx, ly, f, s, head, k }——
 * 方向/落点都在怪自身本地系；缺省 f=-1（正面中弹后仰，原版 || -1 的遗留兜底）。
 * hitK0 取 max(旧值×0.6, 新强度)，同原版 registerHit 的连击合成。
 */
export function triggerStagger(st, opts) {
  const o = opts || {};
  st.stgT = 0;
  st.stgS = o.s ?? 0;
  st.stgF = o.f ?? -1;
  st.hitLX = o.lx ?? 0;
  st.hitLY = o.ly ?? 0.55;
  st.hitHead = o.head ? 1 : 0;
  const k = Math.min(1, Math.max(0.2, o.k ?? 0.8));
  st.hitK0 = Math.min(1, Math.max(st.hitK0 * 0.6, k));
  return true;
}

/**
 * 推进攻击/受击时码并求出本帧派生量（各 fill 函数与 demo 页共用这一条，
 * 保证 instanced 复算与 rig 直调 spec.animate 的时序逐帧一致）。
 * @returns {{ wu, stk, stg, hk, roll, pitch }} wu=前摇 0→1，stk=挥击 1→0，
 *   stg=趔趄强度 1→0，hk=落点抽动包络，roll/pitch=全身趔趄角（原版 staggerRoll/
 *   staggerPitch，方向由 stgS/stgF 带正负号）。
 */
export function advanceActions(st, spec, dt) {
  // 攻击状态机：mummy.js 2688-2712 行（strike 倒数到 0 / windup 满 1 转 strike）
  let wu = 0, stk = 0;
  if (st.atkT >= 0) {
    const wuDur = spec.windup ?? WINDUP_DUR;
    const stDur = spec.strikeTime ?? STRIKE_DUR;
    st.atkT += dt;
    if (st.atkT < wuDur) wu = st.atkT / wuDur;
    else if (st.atkT < wuDur + stDur) stk = 1 - (st.atkT - wuDur) / stDur;
    else st.atkT = -1;
  }
  // 受击：stagger 线性衰减（2854 行）+ 单向趔趄（2882-2884 行）+
  // 落点抽动包络（decayHit 2329 + hitEnvelope 1785：rise 后精确指数衰减）
  let stg = 0, hk = 0, roll = 0, pitch = 0;
  if (st.stgT >= 0) {
    st.stgT += dt;
    stg = Math.max(0, 1 - st.stgT * STAGGER_DECAY);
    const lurch = stg * stg;
    roll = -(st.stgS || 0) * lurch * 0.30;
    pitch = -(st.stgF || -1) * lurch * 0.20;
    const k = st.hitK0 * Math.exp(-HIT_DECAY * st.stgT);
    if (k >= 0.004) {
      const r = st.stgT < HIT_ATTACK ? st.stgT / HIT_ATTACK : 1;
      hk = k * r * r * (3 - 2 * r);
    } else st.hitK0 = 0;
    if (stg <= 0 && st.hitK0 === 0) st.stgT = -1;
  }
  return { wu, stk, stg, hk, roll, pitch };
}

/** strideRate() 的等价物：由真实速度推导步频（mummy.js 1275 行）。 */
export function stepRate(spec, stepSpan, scale, gjStride, speed) {
  // 壳体系/无腿 rig 不声明 stepSpan（mummy.js strideRate 1283 行同款兜底：
  // 六足 tripod 的时钟是 spec 常量而非步幅推导）；原版逐实例 gait.rate 抖动
  // 在 instanced 侧由 gjStride 承担（分布 0.85+R*0.32 ≈ 原版 0.85+R*0.30）
  if (!stepSpan) return (0.8 + speed * spec.gait.rate) * gjStride;
  const drive = Math.min(1, speed / spec.speed);
  const amp = spec.gait.stride * gjStride * (0.35 + 0.65 * drive);
  const span = stepSpan * scale * REACH;
  const deliver = Math.max(0.05, span * (Math.sin(amp) + Math.sin(amp * DRAG_SWING)));
  return Math.max(IDLE_RATE, TAU * speed / deliver) * spec.gait.rate;
}

/**
 * 逐实例步态参数——分布照抄 buildHumanoid 的 per-instance 随机
 * （mummy.js 912-965 行 + 破布 1104-1143 行），让怪海保留原版的个体差。
 *
 * @param seedOrRng 可播种（rng.js）：
 *   - 省略     → 模块级 RNG（受 ?seed= 控制）；
 *   - 数字种子 → 本实例专用 mulberry32（联机用法：hashStr(speciesId) +
 *     instanceIndex * 2654435761，同物种同槽位跨端逐比特一致）；
 *   - 函数     → 直接当随机源（自定义流）。
 */
export function makeGaitParams(spec, seedOrRng) {
  const R = typeof seedOrRng === 'function' ? seedOrRng
    : seedOrRng === undefined ? random
    : mulberry32(seedOrRng);
  const reach = (R() - 0.5) * 0.38;                    // asym.reach
  const gjSwing = 0.8 + R() * 0.45;                    // gait.swing
  return {
    speed: spec.speed * (0.35 + R() * 0.45), // 缓慢行走：0.79~1.8 m/s
    phase: R() * 6.283,                      // st.phase 出厂随机
    scale: spec.scale * (0.90 + R() * 0.20), // asym.scale 分布
    gjStride: 0.85 + R() * 0.32,             // gait.stride
    gjSwing,
    lead: reach >= 0 ? 1 : -1,                         // lead 由 reach 符号派生
    tilt: (R() - 0.5) * 0.34,                // asym.tilt（头 permanent cant）
    reach,
    twistBase: reach * 0.85,                           // 脊柱永久扭转（build 1025 行）
    neckBase: -reach * 1.15,                           // 头反向补偿（build 1068 行）
    // 破布：yaw/restZ/phase/swing 同 build 原式（壳体系无破布，空表）
    tatters: (spec.proportions.tatters || []).map((t) => ({
      yaw: (t.yaw || 0) + (R() - 0.5) * 0.5,
      restZ: (t.out || 0) * (t.x < 0 ? -1 : 1),
      phase: R() * 6.283,
      swing: (t.swing ?? 1) * gjSwing,
    })),
    flash: 0,
    severMask: 0,     // 断肢掩码（bit j = 关节 j 及下游隐藏），初始 0
    crawl: false,     // 断双腿后置位：切缺腿爬行步态（fillLeglessCrawl）
    ...makeActionState(),   // 攻击/受击时码（atkT/stgT 等，见 makeActionState）
  };
}

/** three.js Quaternion.setFromEuler(order 'XYZ') 的展开式，零 GC。 */
function writeQuatXYZ(d, o, x, y, z) {
  const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
  const c1 = Math.cos(hx), s1 = Math.sin(hx);
  const c2 = Math.cos(hy), s2 = Math.sin(hy);
  const c3 = Math.cos(hz), s3 = Math.sin(hz);
  d[o]     = s1 * c2 * c3 + c1 * s2 * s3;
  d[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
  d[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
  d[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
}

/**
 * 推进一只怪的相位并把全部关节四元数写进纹理数据。
 * 公式逐行对应 mummy.js animateHumanoid（1345-1582 行）。
 *
 * @param d      纹理 Float32Array
 * @param row    实例行号
 * @param width  纹理宽（MAX_JOINTS）
 * @param prm    makeGaitParams 产出
 * @param spec   MUMMY
 * @param stepSpan  烘焙参考 rig 的步幅
 * @param dt     帧间隔（已 clamp）
 *
 * 命中判定（src/hitvol.js 部件盒 FK）直接读这份纹理行的四元数——
 * 判定与渲染同源同数据，不需要旁路姿态通道。
 */
export function fillJoints(d, row, width, prm, spec, stepSpan, dt) {
  // 壳体六足系（hips===torso===body 的自有 shell rig，如 tickbot）：
  // 六足 tripod + 壳体摇摆，与 fillCrawlJoints 对 animateCrawler 同款转写关系。
  // 无 gait.kind 字段，以 proportions.shellW 判型（先于人形/爬行分派）
  if (spec.proportions.shellW) return fillShellJoints(d, row, width, prm, spec, stepSpan, dt);
  // 爬行者（species/crawler_true.js）走另一套公式：四足对角爬行，
  // 与人形行走共用纹理布局与关节表，公式对应 animateCrawler
  if (spec.gait.crawl) return fillCrawlJoints(d, row, width, prm, spec, stepSpan, dt);
  // 机器人物种的多足走姿（species/robots.js）：六足蛛行 / 半人马对角四足
  if (spec.gait.kind === 'spider') return fillSpiderJoints(d, row, width, prm, spec, stepSpan, dt);
  if (spec.gait.kind === 'centaur') return fillCentaurJoints(d, row, width, prm, spec, stepSpan, dt);
  // 无腿蠕动（species/maggot.js）：无四肢有机种，躯干链正弦波推进
  if (spec.gait.kind === 'slug') return fillSlugJoints(d, row, width, prm, spec, stepSpan, dt);
  // 断双腿的人形：切缺腿爬行（逐实例数据驱动，公式见 fillLeglessCrawl）
  if (prm.crawl) return fillLeglessCrawl(d, row, width, prm, spec, stepSpan, dt);
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.stride * prm.gjStride * (0.35 + 0.65 * drive);

  const sp = Math.sin(p), cp = Math.cos(p);
  const lagS = sp * TRUNK_LAG_C - cp * TRUNK_LAG_S;
  const lead = prm.lead;

  // --- 双腿（mummy.js 1404-1429）------------------------------------------
  let loadLead = 0, loadDrag = 0;
  const legX = [0, 0], kneeX = [0, 0];   // 0: side -1, 1: side +1
  for (let li = 0; li < 2; li++) {
    const side = li === 0 ? -1 : 1;
    const isLead = side === lead;
    const drag = isLead ? 1 : DRAG_SWING;
    const sig = side < 0 ? sp : -sp;     // sin(p + o), o ∈ {0, π}
    const cig = side < 0 ? cp : -cp;

    legX[li] = sig * amp * drag + (isLead ? 0 : 0.07 * drive);

    const sl = sig * LOAD_C - cig * LOAD_S;
    const u = Math.max(0, -sl);
    const uu = u * u;
    const load = (cig * LOAD_C + sig * LOAD_S < 0 ? uu * u : uu) * drive;
    if (isLead) loadLead = load; else loadDrag = load;

    kneeX[li] = Math.max(0, -cig) * amp * 1.5 * drag
      + load * amp * (isLead ? 0.34 : 0.62)
      + (isLead ? 0.06 : 0.17);
  }

  // --- 双臂（mummy.js 1433-1473：windup/strike 整个接管双臂，else 支才是
  //     行走摆臂；前摇把臂举过水平（WINDUP_ARM = armReach - 1.0），挥击从蓄力
  //     位一路打穿到随挥位 FOLLOW_ARM）-----------------------------------------
  const act = advanceActions(prm, spec, dt);   // 攻击/受击本帧派生量
  const WINDUP_ARM = g.armReach - 1.0;
  const FOLLOW_ARM = 0.35;
  const shX = [0, 0], shZ = [0, 0], elX = [0, 0];
  for (let ai = 0; ai < 2; ai++) {
    const side = ai === 0 ? -1 : 1;
    const reach = g.armReach + side * prm.reach;   // arm.bias = side * asym.reach
    if (act.wu > 0) {
      const k = act.wu;
      shX[ai] = reach + (WINDUP_ARM - reach) * k;
      shZ[ai] = side * (g.armSplay + k * 0.45);
      elX[ai] = -g.elbowBend * (1 - k) - 0.18;
    } else if (act.stk > 0) {
      const k = act.stk;   // strike 从 1 倒数到 0：臂从蓄力位落下打穿目标
      shX[ai] = FOLLOW_ARM + (WINDUP_ARM - FOLLOW_ARM) * k;
      shZ[ai] = side * g.armSplay;
      elX[ai] = -0.15;
    } else {
      const as = side < 0 ? -lagS : lagS;  // 手臂挂在胸廓上，走滞后波
      shX[ai] = reach + as * g.armSwing * prm.gjSwing * drive;
      shZ[ai] = side * g.armSplay;
      elX[ai] = -g.elbowBend - Math.max(0, as) * 0.25;
    }
  }

  // --- 骨盆/胸廓/头（mummy.js 1498-1567 + 1523-1531 攻击躯干支）--------------
  const list = weighted(sp) * drive;
  const hipsZ = (list * 0.85 + 0.55 * lead * drive) * g.sway;
  const hipsY = list * g.hipTwist;
  const lagW = weighted(lagS) * drive;
  let torsoZ = -lagW * g.sway * 0.55;
  let torsoY = prm.twistBase - lagW * g.hipTwist * 0.75;
  let torsoX;
  if (act.wu > 0) torsoX = g.lean + act.wu * 0.30;          // 后仰蓄力
  else if (act.stk > 0) torsoX = g.lean - (1 - act.stk) * 0.30;  // 随挥压进
  else torsoX = g.lean - loadDrag * 0.10;
  // 受击全身趔趄：原版写 rig.body（rotation.x/z + position.y 下沉，1552-1555
  // 行）；instanced 管线无 body 旋转通道，折进 HIPS 关节（hips 子树 = body
  // 子树，等效）与 bob 通道。
  let bob = (drive - loadLead * 0.62 - loadDrag * 1.15) * g.bob
    - act.stg * 0.06;
  const hipsX = act.pitch;
  const hipsRoll = hipsZ + act.roll;
  let neckZ = prm.tilt + Math.sin(p * 0.37) * g.headLoll;
  let neckX = g.headDroop + Math.sin(p * 0.53) * 0.05;
  let neckY = prm.neckBase;

  // --- 落点抽动（mummy.js reactToHit 1620-1723：加法式、最后跑，骑在步态上）--
  let hitTatX = 0, hitTatZ = 0;
  const hk = act.hk;
  if (hk > 0) {
    const P = spec.proportions;
    const lx = prm.hitLX, ly = prm.hitLY, f = prm.stgF || 0, head = prm.hitHead;
    // 肩高占站姿比例：是否「打中肩」由 spec 说了算而非魔法数
    const shoulderN = ((P.hipY || 0.9) + (P.torsoY || 0.12) + (P.shoulderY || 0.46))
      / (spec.height || 1.8);
    bob -= hk * 0.06 * Math.max(0, 0.55 - ly);        // 低命中下沉
    torsoY += lx * hk * 0.34;                          // 被打一侧转后
    torsoX += -f * hk * 0.26 * Math.max(0.25, ly);
    torsoZ += -lx * hk * 0.16;
    const nearShoulder = Math.max(0, 1 - Math.abs(ly - shoulderN) * 3.4);
    if (nearShoulder > 0) {
      for (let ai = 0; ai < 2; ai++) {
        const side = ai === 0 ? -1 : 1;
        const w = Math.max(0, side * lx) * nearShoulder;
        if (w <= 0) continue;
        shX[ai] += w * hk * (0.12 - f * 0.55);         // 被打的手臂向后甩
        shZ[ai] += side * w * hk * 0.42;               // 并向外张
        elX[ai] += w * hk * 0.34;
      }
    }
    const low = Math.max(0, 1 - ly / 0.42);
    if (low > 0) {
      for (let li = 0; li < 2; li++) {
        const side = li === 0 ? -1 : 1;
        const w = Math.max(0, side * lx) * low;
        if (w <= 0) continue;
        legX[li] += w * hk * 0.30;
        kneeX[li] += w * hk * 0.55;
      }
    }
    const hg = 0.16 + head * 0.58;                     // 爆头四倍增益
    neckX += -f * hk * hg;
    neckZ += lx * hk * hg * 0.8;
    neckY += lx * hk * hg;
    hitTatX = -f * hk * 0.55;                          // 破布甩动
    hitTatZ = -lx * hk * 0.45;
  }

  // --- 写纹理 --------------------------------------------------------------
  const base = row * width * 4;
  d[base] = bob;
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;   // 断肢掩码
  // d[base+3] 保留

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);
  q(J.HIPS, hipsX, hipsY, hipsRoll);
  q(J.TORSO, torsoX, torsoY, torsoZ);
  q(J.NECK, neckX, neckY, neckZ);
  q(J.HIP_L, legX[0], 0, 0);  q(J.KNEE_L, kneeX[0], 0, 0);
  q(J.HIP_R, legX[1], 0, 0);  q(J.KNEE_R, kneeX[1], 0, 0);
  q(J.SH_L, shX[0], 0, shZ[0]); q(J.EL_L, elX[0], 0, 0);
  q(J.SH_R, shX[1], 0, shZ[1]); q(J.EL_R, elX[1], 0, 0);

  // --- 破布（mummy.js 1569-1579 + reactToHit 破布甩动）-----------------------
  const tatterRest = spec.proportions.tatterRest;
  prm.tatters.forEach((t, i) => {
    const lag = Math.sin(p - 0.8 + t.phase) * t.swing;
    const tx = lag * 0.30 * drive + tatterRest + hitTatX;
    const tz = t.restZ + Math.sin(p * 0.7 + t.phase) * 0.20 * drive + hitTatZ;
    q(J.TATTER + i, tx, t.yaw, tz);
  });
}

/**
 * 爬行者（species/crawler_true.js）的关节填充：公式逐行对应 animateCrawler。
 * 纹理布局与关节表同人形——HIPS/TORSO/NECK + 双腿 + 双臂四元数 + 破布，
 * 区别只在内容：四足对角爬行（左前+右后同相），肘/膝的静止反折角在这里
 * 还原（bake 把注册关节旋转归零，静止姿态属动画值，同破布 restZ 契约）。
 */
export function fillCrawlJoints(d, row, width, prm, spec, stepSpan, dt) {
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.stride * prm.gjStride * (0.35 + 0.65 * drive);
  const act = advanceActions(prm, spec, dt);

  // 对角相位：臂=前肢（0: 左 / 1: 右），腿=后肢；左前+右后同相
  // front 标记供攻击分支识别前两肢（挥扫主力），后肢维持步态
  const limbs = [
    { base: J.SH_L, el: J.EL_L, side: -1, off: 0, bend: g.elBend, front: true },       // 左前
    { base: J.SH_R, el: J.EL_R, side: 1, off: Math.PI, bend: g.elBend, front: true },  // 右前
    { base: J.HIP_L, el: J.KNEE_L, side: -1, off: Math.PI, bend: g.knBend }, // 左后
    { base: J.HIP_R, el: J.KNEE_R, side: 1, off: 0, bend: g.knBend },     // 右后
  ];

  // 攻击（自写，原版爬行者无对应公式）：弓身抬头 + 前两肢扬起后收（windup）
  // → 双前肢向前下扑扫 + 躯干前压 + 头埋进扑咬（strike）。rotation.x 正 =
  // 前段下压，负 = 扬起（headUp=-0.95 抬头同款约定）。
  let bob = Math.abs(Math.sin(p)) * g.bob * drive
    + act.wu * 0.06 - (act.stk > 0 ? (1 - act.stk) * 0.05 : 0) - act.stg * 0.05;

  const base = row * width * 4;
  d[base] = bob;
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;   // 断肢掩码

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);
  for (const { base: A, el: B, side, off, bend, front } of limbs) {
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));
    if (front && act.wu > 0) {          // 前肢扬起蓄力（步态衰减让位）
      const k = act.wu;
      q(A, sw * amp * (1 - k) - 0.55 * k, 0, -side * (lift * g.lift * drive + k * 0.75));
      q(B, 0, 0, -side * bend * (1 + k * 0.35) - side * lift * g.flex * drive * (1 - k));
    } else if (front && act.stk > 0) {  // 扑扫：从蓄力位抡到前下方打穿
      const k = act.stk;
      q(A, 0.85 - 1.50 * k, 0, -side * 0.25 * k);
      q(B, 0, 0, -side * bend * (0.45 + 0.55 * k));
    } else {
      q(A, sw * amp, 0, -side * lift * g.lift * drive);
      q(B, 0, 0, -side * bend - side * lift * g.flex * drive);
    }
  }

  // 身体拧滚/蛇行（TORSO），HIPS 恒零（受击时扛趔趄角，见下）
  let torsoX = Math.sin(p * 2) * 0.04 * drive;
  if (act.wu > 0) torsoX -= act.wu * 0.28;               // 弓身：前段抬起
  else if (act.stk > 0) torsoX += (1 - act.stk) * 0.32;  // 前压扑下
  let neckX = g.headUp + Math.sin(p * 2) * 0.06 * drive;
  if (act.wu > 0) neckX -= act.wu * 0.30;                // 头抬更狠（盯着猎物）
  else if (act.stk > 0) neckX += (1 - act.stk) * 0.28;   // 头埋进扑咬
  const torsoY = Math.sin(p) * g.swayYaw * drive;
  let torsoZ = Math.sin(p) * g.swayRoll * drive;
  const neckY = Math.sin(p * 0.47) * g.headScan;
  // 受击：全身趔趄折进 HIPS/TORSO（instanced 无 body 旋转通道，同人形契约），
  // 落点抽动打在头上（贴地种头是唯一抬起的部位，受击读点全在它）
  torsoX += act.pitch * 1.2; torsoZ += act.roll * 1.2;
  neckX += act.hk * 0.45;
  q(J.HIPS, act.pitch * 0.5, 0, act.roll * 0.5);
  q(J.TORSO, torsoX, torsoY, torsoZ);
  // 头抬起前伸 + 错拍扫视
  q(J.NECK, neckX, neckY, 0);

  // 破布：同 animateCrawler
  const tatterRest = spec.proportions.tatterRest;
  prm.tatters.forEach((t, i) => {
    const lag = Math.sin(p - 0.8 + t.phase) * t.swing;
    const tx = lag * 0.28 * drive + tatterRest;
    const tz = t.restZ + Math.sin(p * 0.7 + t.phase) * 0.18 * drive;
    q(J.TATTER + i, tx, t.yaw, tz);
  });
}

/**
 * 壳体六足系 rig（hips === torso === body，如 tickbot）的关节填充：
 * 公式转写自 sands 原版引擎的壳体六足机器（物种数据已移除，机器留存）。
 *
 * rig 结构：bake.js 把 body 注册为 HIPS 关节（壳体俯仰/翻滚进链）；六足
 * legs[0..5] 占 HIP/KNEE + LEG2 + LEG3 槽（与 spiderbot 同序：i 偶 L 奇 R，
 * i>>1 = 前/中/后对；不足六足的物种空槽无害）；无臂无破布。腿的静止外张角
 * （build 时 hip.rotation.z = side*-0.55）按 bake 归零契约每帧在这里还原，
 * 同爬行者 elBend。body 的 rideHeight 已烘进几何（bake 保留结构 y），
 * bob 通道只承担起伏与受击下沉。攻击/受击照原式保留（仰壳蓄力/下砸、
 * 被击侧腿摊开、头后仰），不象缺腿爬行那样只推时码。
 */
export function fillShellJoints(d, row, width, prm, spec, stepSpan, dt) {
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.stride * (0.3 + 0.7 * drive);   // 原式不带逐实例 gjStride
  const act = advanceActions(prm, spec, dt);

  const base = row * width * 4;
  d[base] = Math.abs(Math.sin(p * 2)) * 0.02 * drive
    - act.stg * 0.03 - act.hk * 0.055;          // 起伏 + 趔趄/落点下沉
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);

  // 六足 tripod（左前+右中+左后同相）+ 受击侧腿从壳下摊开
  //（w = max(0, side*lx)*hk）
  const LEGS = [
    [J.HIP_L, J.KNEE_L], [J.HIP_R, J.KNEE_R],
    [J.LEG2_L, J.KNEE2_L], [J.LEG2_R, J.KNEE2_R],
    [J.LEG3_L, J.KNEE3_L], [J.LEG3_R, J.KNEE3_R],
  ];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const r = i >> 1;
    const tripod = ((r + (side < 0 ? 0 : 1)) % 2) * Math.PI;
    const ph = p * 2 + tripod;
    const w = Math.max(0, side * prm.hitLX) * act.hk;
    q(LEGS[i][0],
      Math.sin(ph) * amp, 0,
      side * -0.55 + Math.sin(ph) * 0.12 * drive + side * w * 0.30);
    q(LEGS[i][1], Math.max(0, Math.cos(ph)) * amp * 1.2 + 0.35 + w * 0.45, 0, 0);
  }

  // 壳体（HIPS）：随 tripod 摇摆 + 前摇仰壳/挥击前段下砸 + 受击侧滚
  // （原式的 staggerPitch 不作用于壳体——低宽体几乎没有俯仰杠杆臂，
  // 反应大头在垂直与侧滚，已分别进 bob 与 z）
  let pitch = Math.sin(p * 2) * 0.05 * drive;
  if (act.wu > 0) pitch += act.wu * 0.55;              // 仰壳蓄力（顶视也读得出）
  else if (act.stk > 0) pitch -= (1 - act.stk) * 0.4;  // 前段下砸
  pitch += -prm.stgF * act.hk * 0.22;
  q(J.HIPS, pitch, 0,
    Math.sin(p) * 0.09 * drive + act.roll
      + (-prm.stgS * 0.34 + prm.hitLX * 0.16) * act.hk);

  // 头（NECK）：小幅点动 + 落点后仰/侧甩（壳体 rig 唯一的细部动作；
  // 原式 rotation.y 每帧清零后加 hit 项，等价）
  q(J.NECK,
    -Math.sin(p * 0.6) * 0.08 - prm.stgF * act.hk * (0.14 + prm.hitHead * 0.40),
    prm.hitLX * act.hk * (0.18 + prm.hitHead * 0.45), 0);
}

/**
 * 蛛卫（species/robots.js spiderbot）的六足 tripod 步态填充：
 * 公式逐行对应 animateSpiderbot。第 r 对腿（r = i>>1，0 前/1 中/2 后）按
 * 壳体六足系同款 tripod 相位 off = (r + (side<0?0:1)) % 2 · π 交替；外张由静态
 * mount 烘进几何，膝的静止反折角（g.knBend）每帧在这里还原（bake 归零契约）。
 * 多出来的四条例腿走 12-19 号关节位（bake.js J 表），双臂仍是 8-11。
 */
export function fillSpiderJoints(d, row, width, prm, spec, stepSpan, dt) {
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.stride * prm.gjStride * (0.35 + 0.65 * drive);
  const act = advanceActions(prm, spec, dt);

  const base = row * width * 4;
  d[base] = Math.abs(Math.sin(p)) * g.bob * drive
    + act.wu * 0.05 - (act.stk > 0 ? (1 - act.stk) * 0.05 : 0) - act.stg * 0.05;
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);

  // 六足：legs[0..5] = HIP/KNEE、LEG2、LEG3（L 偶 R 奇，与 bake jmap 同序）。
  // 攻击（自写）：windup 扬起**前对**步足（高过背线的威吓姿）+ 后仰蓄力，
  // strike 前对步足下劈钉地。中/后对维持 tripod 支撑。
  const LEGS = [
    [J.HIP_L, J.KNEE_L], [J.HIP_R, J.KNEE_R],
    [J.LEG2_L, J.KNEE2_L], [J.LEG2_R, J.KNEE2_R],
    [J.LEG3_L, J.KNEE3_L], [J.LEG3_R, J.KNEE3_R],
  ];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const r = i >> 1;
    const off = ((r + (side < 0 ? 0 : 1)) % 2) * Math.PI;
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));
    if (r === 0 && act.wu > 0) {            // 前对扬起（步态让位）
      const k = act.wu;
      q(LEGS[i][0], sw * amp * (1 - k) - 0.60 * k, 0,
        -side * (lift * g.lift * drive + k * 0.80));
      q(LEGS[i][1], 0, 0, -side * (g.knBend * (1 + k * 0.30) + lift * g.flex * drive * (1 - k)));
    } else if (r === 0 && act.stk > 0) {    // 前对下劈
      const k = act.stk;
      q(LEGS[i][0], 0.75 - 1.40 * k, 0, -side * 0.18 * k);
      q(LEGS[i][1], 0, 0, -side * g.knBend * (0.50 + 0.50 * k));
    } else {
      q(LEGS[i][0], sw * amp, 0, -side * lift * g.lift * drive);
      q(LEGS[i][1], 0, 0, -side * (g.knBend + lift * g.flex * drive));
    }
  }

  // 双臂：平时与对侧前腿反相的攻击性摆动；攻击时被前摇/挥击整个接管
  // （公式同人形 WINDUP_ARM/FOLLOW_ARM 结构，幅度按钳臂调小一号）
  const WINDUP_ARM = g.armReach - 0.8;
  const FOLLOW_ARM = 0.5;
  for (let ai = 0; ai < 2; ai++) {
    const side = ai === 0 ? -1 : 1;
    const AJ = ai === 0 ? J.SH_L : J.SH_R;
    const BJ = ai === 0 ? J.EL_L : J.EL_R;
    if (act.wu > 0) {
      const k = act.wu;
      q(AJ, g.armReach + (WINDUP_ARM - g.armReach) * k, 0, side * (g.armSplay + k * 0.35));
      q(BJ, -g.elBend * (1 - k) - 0.15, 0, 0);
    } else if (act.stk > 0) {
      const k = act.stk;
      q(AJ, FOLLOW_ARM + (WINDUP_ARM - FOLLOW_ARM) * k, 0, side * g.armSplay);
      q(BJ, -0.10, 0, 0);
    } else {
      const off = side < 0 ? Math.PI : 0;
      const sw = Math.sin(p + off);
      q(AJ, g.armReach + sw * g.armSwing * drive, 0, side * g.armSplay);
      q(BJ, -g.elBend - Math.max(0, sw) * 0.2 * drive, 0, 0);
    }
  }

  // 身体：人形躯干随 tripod 支撑小幅拧滚；HIPS 恒零（外张腿的躯干别乱滚）。
  // 攻击：windup 后仰 / strike 前压（同人形躯干公式结构）；受击趔趄折进
  // HIPS/TORSO，落点抽动打在传感头上。
  let torsoX = g.lean + Math.sin(p * 2) * 0.03 * drive;
  if (act.wu > 0) torsoX += act.wu * 0.25;
  else if (act.stk > 0) torsoX -= (1 - act.stk) * 0.35;
  let torsoZ = Math.sin(p) * g.swayRoll * drive;
  torsoX += act.pitch * 1.2; torsoZ += act.roll * 1.2;
  q(J.HIPS, act.pitch * 0.5, 0, act.roll * 0.5);
  q(J.TORSO, torsoX,
    Math.sin(p) * g.swayYaw * drive,
    torsoZ);
  q(J.NECK,
    g.headDroop + Math.sin(p * 2) * 0.05 * drive + act.hk * 0.45,
    Math.sin(p * 0.47) * g.headScan, 0);
  // 机器人无破布：prm.tatters 恒空，无需写 24+ 列
}

/**
 * 半人马（species/robots.js centaurbot）的四足对角走姿填充：
 * 公式逐行对应 animateCentaurbot。马身四腿对角对（左前+右后同相），
 * 前对走双腿槽、后对走 LEG2 槽；人身四臂（双臂槽 + ARM2 短臂）反相摆动。
 * 腿的外张烘进静态 mount，膝只有小幅 bend + 摆动抬折，无大反折角。
 */
export function fillCentaurJoints(d, row, width, prm, spec, stepSpan, dt) {
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.stride * prm.gjStride * (0.35 + 0.65 * drive);
  const act = advanceActions(prm, spec, dt);

  const base = row * width * 4;
  d[base] = Math.abs(Math.sin(p)) * g.bob * drive
    + act.wu * 0.06 - (act.stk > 0 ? (1 - act.stk) * 0.04 : 0) - act.stg * 0.05;
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);

  // 对角对：左前(HIP_L)+右后(LEG2_R) 同相，右前+左后 反相
  const LEGS = [
    { A: J.HIP_L, B: J.KNEE_L, off: 0 },
    { A: J.HIP_R, B: J.KNEE_R, off: Math.PI },
    { A: J.LEG2_L, B: J.KNEE2_L, off: Math.PI },
    { A: J.LEG2_R, B: J.KNEE2_R, off: 0 },
  ];
  for (const { A, B, off } of LEGS) {
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));
    q(A, sw * amp, 0, 0);
    q(B, g.knBend + lift * g.flex * drive, 0, 0);
  }

  // 四臂：平时主对与副对（短臂）各成反相摆；攻击（自写）= 骑士抡槊：
  // windup 人身立起上探（bob 通道）+ 四臂张开举过肩线，strike 四臂一齐抡劈
  // 下来（副臂幅度小一号）。公式结构同人形 WINDUP_ARM/FOLLOW_ARM。
  const ARMS = [
    { S: J.SH_L, E: J.EL_L, side: -1, sub: false },
    { S: J.SH_R, E: J.EL_R, side: 1, sub: false },
    { S: J.ARM2_L, E: J.EL2_L, side: -1, sub: true },
    { S: J.ARM2_R, E: J.EL2_R, side: 1, sub: true },
  ];
  for (const { S, E, side, sub } of ARMS) {
    const reach = sub ? g.arm2Reach : g.armReach;
    const bend = sub ? g.el2Bend : g.elBend;
    const splay = sub ? g.arm2Splay : g.armSplay;
    if (act.wu > 0) {
      const k = act.wu;
      const wArm = reach - (sub ? 0.55 : 0.90);
      q(S, reach + (wArm - reach) * k, 0, side * (splay + k * 0.40));
      q(E, -bend * (1 - k) - 0.15, 0, 0);
    } else if (act.stk > 0) {
      const k = act.stk;
      const wArm = reach - (sub ? 0.55 : 0.90);
      const fArm = sub ? 0.35 : 0.50;
      q(S, fArm + (wArm - fArm) * k, 0, side * splay);
      q(E, -0.12, 0, 0);
    } else {
      const off = side < 0 ? Math.PI : 0;
      const sw = Math.sin(p + off + (sub ? 0.9 : 0));
      q(S, reach + sw * (sub ? g.arm2Swing : g.armSwing) * drive, 0, side * splay);
      q(E, -bend - Math.max(0, sw) * 0.2 * drive, 0, 0);
    }
  }

  // 马身拧滚（HIPS）+ 人身反相位稳定（TORSO）+ 头扫视。
  // 攻击：windup 人身后仰立起 / strike 人前压进；受击趔趄折进 HIPS/TORSO，
  // 落点抽动打在骑士盔头上。
  let torsoX = g.lean + Math.sin(p * 2) * 0.04 * drive;
  if (act.wu > 0) torsoX += act.wu * 0.22;
  else if (act.stk > 0) torsoX -= (1 - act.stk) * 0.32;
  let torsoZ = -Math.sin(p) * g.swayRoll * 0.5 * drive;
  torsoX += act.pitch * 1.2; torsoZ += act.roll * 1.2;
  q(J.HIPS, Math.sin(p * 2) * 0.03 * drive + act.pitch * 0.5, 0,
    Math.sin(p) * g.swayRoll * drive + act.roll * 0.5);
  q(J.TORSO, torsoX,
    Math.sin(p) * g.swayYaw * drive,
    torsoZ);
  q(J.NECK,
    g.headDroop + Math.sin(p * 2) * 0.05 * drive + act.hk * 0.45,
    Math.sin(p * 0.47) * g.headScan, 0);
}

/**
 * 肉蛆（species/maggot.js）的无腿蠕动填充：公式逐行对应 animateMaggot。
 * rig 只有 hips→torso→neck 三节（legs/arms 空数组，bake 收不到四肢关节），
 * 蠕动正弦波从髋传到头（逐节相位滞后 waveLag）叠出推进浪；纹理布局与
 * 关节表同其他物种——只写 HIPS/TORSO/NECK，四肢/破布槽位无几何挂载不写。
 */
export function fillSlugJoints(d, row, width, prm, spec, stepSpan, dt) {
  const g = spec.gait;
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  const amp = g.waveAmp * prm.gjStride * (0.35 + 0.65 * drive);
  const act = advanceActions(prm, spec, dt);
  const lag = g.waveLag;

  const base = row * width * 4;
  d[base] = Math.abs(Math.sin(p - lag)) * g.bob * drive - act.stg * 0.03;
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;

  let hipsX = Math.sin(p) * amp;
  let torsoX = Math.sin(p - lag) * amp;
  let neckX = g.headUp + Math.sin(p - lag * 2) * amp * 0.9;
  if (act.wu > 0) {                     // 前段弓起抬头（蓄力）
    torsoX -= act.wu * 0.30;
    neckX -= act.wu * 0.45;
  } else if (act.stk > 0) {             // 向前下啄
    torsoX += (1 - act.stk) * 0.22;
    neckX += (1 - act.stk) * 0.40;
  }
  hipsX += act.pitch * 0.8;
  torsoX += act.pitch * 1.1;
  neckX += act.hk * 0.45;

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);
  q(J.HIPS, hipsX, 0, act.roll * 0.5);
  q(J.TORSO, torsoX, Math.sin(p - lag * 0.5) * g.swayYaw * drive, act.roll * 1.1);
  q(J.NECK, neckX, Math.sin(p * 0.47) * g.headScan, 0);
}

// --- 缺腿爬行（人形断双腿后的逐实例步态） -------------------------------------// 腿几何已被断肢掩码隐藏（膝/髋 bit），这里把躯干趴平贴地 + 双臂对角扒地 +
// 头抬起，参数借自 crawler_true.js 的爬行常量（人形 spec 没有 crawl 字段）。
// 身体下潜走 bob 通道（模型空间，instanceMatrix 的 scale 在其后生效）。
const LEGLESS = {
  torsoPitch: -1.12,   // 躯干趴平前屈（lean 负值 = 前佝，同契约）
  hipsPitch: -0.42,    // 骨盆跟倒
  armReach: -1.05,     // 双臂前伸扒地
  armAmp: 0.55,        // 扒地摆幅
  lift: 0.35,          // 前摆半拍抬臂
  headUp: -0.55,       // 头抬起朝前
  headScan: 0.4,       // 错拍扫视
  rideY: 0.30,         // 骨盆离地高（贴地拖行）
};
function fillLeglessCrawl(d, row, width, prm, spec, stepSpan, dt) {
  prm.phase += dt * stepRate(spec, stepSpan, prm.scale, prm.gjStride, prm.speed);
  const p = prm.phase;
  const drive = Math.min(1, prm.speed / spec.speed);
  // 缺腿爬行不带攻击/受击姿态分支，但时码照常推进——否则断双腿发生在攻击
  // 中途会把 atkT 冻在 ≥0，调用方的「攻击结束恢复速度」逻辑永远等不到
  advanceActions(prm, spec, dt);

  const base = row * width * 4;
  d[base] = -(spec.proportions.hipY - LEGLESS.rideY)
    + Math.abs(Math.sin(p)) * 0.035 * drive;         // bob：躯干贴地
  d[base + 1] = prm.flash;
  d[base + 2] = prm.severMask || 0;

  const q = (id, x, y, z) => writeQuatXYZ(d, base + id * 4, x, y, z);
  q(J.HIPS, LEGLESS.hipsPitch, 0, Math.sin(p) * 0.08 * drive);
  q(J.TORSO, LEGLESS.torsoPitch + Math.sin(p * 2) * 0.05 * drive,
    Math.sin(p) * LEGLESS.headScan * 0.25 * drive, 0);
  q(J.NECK, LEGLESS.headUp + Math.sin(p * 2) * 0.06 * drive,
    Math.sin(p * 0.47) * LEGLESS.headScan, 0);

  // 双臂对角扒地（左/右反相）；双腿关节冻结（几何已掩码隐藏，写零即可）
  for (let ai = 0; ai < 2; ai++) {
    const side = ai === 0 ? -1 : 1;
    const off = ai === 0 ? 0 : Math.PI;
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));
    q(ai === 0 ? J.SH_L : J.SH_R,
      LEGLESS.armReach + sw * LEGLESS.armAmp * drive, 0,
      side * (0.25 + lift * LEGLESS.lift * drive));
    q(ai === 0 ? J.EL_L : J.EL_R, -0.45 - lift * 0.35 * drive, 0, 0);
  }
  q(J.HIP_L, 0, 0, 0); q(J.KNEE_L, 0, 0, 0);
  q(J.HIP_R, 0, 0, 0); q(J.KNEE_R, 0, 0, 0);

  const tatterRest = spec.proportions.tatterRest;
  prm.tatters.forEach((t, i) => {
    const lag = Math.sin(p - 0.8 + t.phase) * t.swing;
    const tx = lag * 0.28 * drive + tatterRest;
    const tz = t.restZ + Math.sin(p * 0.7 + t.phase) * 0.18 * drive;
    q(J.TATTER + i, tx, t.yaw, tz);
  });
}
