/**
 * lod.js — 怪海性能双件套：距离分级动画更新（CPU 侧）+ 平面网格视锥剔除
 * （GPU 侧）。两个 demo 页（horde.html / shooter.html）共用这一个 helper。
 *
 * 【距离分级】按实例到相机的平方距分档（零开方）：
 *   档位表 LOD_TIERS：d = 距离上限（米），period = 每几帧更新一次，0 = 冻结。
 *   降档实例把 dt 累积在 st.lodDt 里，轮到更新帧时一次性推进 fillJoints——
 *   相位/攻击时码按真实经过时间走，平均移速/步频与每帧更新逐秒一致
 *   （只是动画更糙）；冻结档完全不写纹理行，保持最后姿态。
 *   强制每帧档的例外（调用方算好 forceFull 传入）：攻击/受击进行中
 *   （atkT/stgT ≥ 0，否则状态机会被冻死）、flash > 0（受击闪白要衰减掉）、
 *   shooter 里近身 <15m。
 *   更新帧判定用 (frame + 实例序号) % period —— 同档实例错开更新帧摊平负载，
 *   纯序号无随机（不碰 rng.js，?seed= 确定性链不受影响）。
 *
 * 【网格剔除】makeCullGrid 把场地按平面符号切成 2×2 粗格（x/z 各按 ≥0 / <0），
 * 每格一个静态包围球（格子方域外接圆 + margin，不随实例移动重算，无陈旧问题）。
 * demo 页为「每物种 × 每格 × 每材质分组」惰性建 InstancedMesh，实例 0.5s 重分配
 * 一次格子（不每帧搬），three 按格包围球自动视锥剔除整组。剔除粒度粗 =
 * draw call 上界变为 物种×材质×格数（2×2 即 ×4），用 ?cull=0 回退单 mesh 模式
 * 做 A/B 对照。
 *
 * 剔除模式下的关节纹理寻址：格内 InstancedMesh 只画实例子集，gl_InstanceID
 * 不再是全局实例号——着色器改用每格 instanced attribute `aRow`（格内槽位 →
 * 全局纹理行号）查 uJoints。纹理布局不变（行 = 全局实例号），hitvol.js /
 * ragdoll.js 的 CPU 侧直读不受影响。
 */

// --- 距离分档 ---------------------------------------------------------------
// 可调常量：d = 距离上限（米，平方距比较），period = 每几帧更新（0 = 冻结）
export const LOD_TIERS = [
  { d: 12, period: 1 },
  { d: 25, period: 2 },
  { d: 40, period: 4 },
  { d: Infinity, period: 0 },
];

/**
 * 距离分级更新闸。每帧 beginFrame() 重置计数，然后逐实例 step()：
 * 返回本帧应一次性推进的 dt（>0 就去 fillJoints），0 = 本帧不写纹理行。
 * st 上挂 lodDt（dt 累积）/ lodTier（当次档位，探针读），调用方不要改。
 * stats: { tiers[4], rows, total } —— rows = 本帧实际写纹理行数（验收计数器）。
 */
export function makeLodGater(tiers = LOD_TIERS) {
  const sq = tiers.map(t => t.d * t.d);      // 平方阈值，零开方分档
  let frame = 0;
  const stats = { tiers: [0, 0, 0, 0], rows: 0, total: 0 };
  return {
    tiers, stats,
    beginFrame() {
      frame++;
      stats.tiers[0] = stats.tiers[1] = stats.tiers[2] = stats.tiers[3] = 0;
      stats.rows = 0; stats.total = 0;
    },
    /**
     * @param st    实例状态（挂 lodDt/lodTier）
     * @param idx   实例序号（错帧用，稳定即可）
     * @param forceFull  true = 强制每帧档（攻击/受击/闪白/近身）
     */
    step(st, idx, x, y, z, cx, cy, cz, dt, forceFull) {
      stats.total++;
      let t = 0;
      if (!forceFull) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        while (t < sq.length - 1 && d2 >= sq[t]) t++;
      }
      st.lodTier = t;
      stats.tiers[t]++;
      const period = forceFull ? 1 : tiers[t].period;
      if (period === 0) { st.lodDt = 0; return 0; }   // 冻结：姿态保持，dt 不攒
      st.lodDt = (st.lodDt || 0) + dt;
      if ((frame + idx) % period !== 0) return 0;
      const adv = st.lodDt; st.lodDt = 0;
      stats.rows++;
      return adv;
    },
  };
}

// --- 平面网格剔除 -------------------------------------------------------------

/**
 * 平面粗格：cells×cells 等分 [-half, half]²（默认 2×2，即按 x/z 符号分象限）。
 * cellIndex(x, z) 纯函数；cellSphere(c) 返回该格方域的静态包围球
 * { cx, cy, cz, r }（外接圆 + margin；实例在格内怎么走都不会出球，
 * 重分配格子前也不用重算）。demo 页包成 THREE.Sphere 喂 InstancedMesh。
 */
export function makeCullGrid({ half = 20, cells = 2, margin = 3, y = 1 } = {}) {
  const cw = (half * 2) / cells;                 // 格边长
  const r = Math.SQRT1_2 * cw + margin;          // 格外接圆半径 + 余量
  return {
    half, cells,
    cellIndex(x, z) {
      const ix = Math.max(0, Math.min(cells - 1, ((x + half) / cw) | 0));
      const iz = Math.max(0, Math.min(cells - 1, ((z + half) / cw) | 0));
      return iz * cells + ix;
    },
    cellSphere(c) {
      const ix = c % cells, iz = (c / cells) | 0;
      return { cx: -half + cw * (ix + 0.5), cy: y, cz: -half + cw * (iz + 0.5), r };
    },
  };
}
