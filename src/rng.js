/**
 * rng.js — 全链路可播种随机：确定性生成的唯一入口。
 *
 * 背景：toolkit 原本所有随机都直接调 Math.random()，每次刷新页面怪海长得
 * 不一样（截图验收不可复现），联机游戏各端生成的个体差也会发散——本仓库
 * AGENTS.md 的既定约定是「外观按 id 哈希确定性生成，不走网络同步」。
 * 本模块把全部随机收口到两条通道：
 *
 *   1. 模块级 RNG（页面级）：setSeed(seed) / random()。
 *      页面加载时从 ?seed= URL 参数初始化；无参数时固定默认 1（**刻意不**
 *      用 Math.random 当默认——否则验收依然不可复现）。demo 页的刷怪位置/
 *      相位/混编、shooter 的血液/残肢/重生等运行期随机全走这条。
 *
 *   2. withSeed(seed, fn)：执行 fn 期间把 Math.random 临时换成指定种子的
 *      mulberry32，finally 恢复。这是包 core/ buildHumanoid / createEnemy
 *      的**唯一**手段——core/ 一行不可改，其内部直接调 Math.random
 *      （asym/破布 10% 缺失/材质色调抖动/st.phase），只能靠替换包住。
 *      工厂全是同步代码（build 期间无 await），替换是安全的。
 *      注意：vendor three 的 generateUUID 也走 Math.random，withSeed 期间
 *      新建的 Object3D/Material 的 uuid 会吃种子流（确定性，不影响渲染：
 *      three 渲染缓存键是 WeakMap/顺序 id，不是 uuid）。
 *
 * 联机用法：按实例 id 哈希当 seed——
 *   const seed = (hashStr(speciesId) + instanceIndex * 2654435761) >>> 0;
 *   const params = makeGaitParams(spec, seed);   // 同物种同槽位跨端一致
 * species 工厂（createZombie 等）已内置同款公式，直接吃 index 参数。
 */

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

/** 字符串 → 32 位种子（FNV-1a），联机按实例 id 哈希用。 */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- 模块级默认 RNG ---------------------------------------------------------

function initialSeed() {
  const v = new URLSearchParams(location.search).get('seed');
  if (v === null) return 1;              // 无参数：固定默认 1（可复现优先）
  const n = Number(v);
  return Number.isFinite(n) ? (n >>> 0) : hashStr(v);   // 数字直用，字符串哈希
}

let _seed = initialSeed();
let _rng = mulberry32(_seed);

/** 重置模块级 RNG 的种子（返回生效值）。 */
export function setSeed(seed) {
  _seed = seed >>> 0;
  _rng = mulberry32(_seed);
  return _seed;
}

/** 模块级 RNG 抽一发 [0,1)。 */
export function random() {
  return _rng();
}

/** 当前模块级种子（探针/日志用）。 */
export function currentSeed() {
  return _seed;
}

/**
 * 执行 fn 期间把 Math.random 换成指定种子的 mulberry32，finally 恢复。
 * 用途唯一：包 core/（一行不可改）里直接调 Math.random 的 build/create。
 * fn 必须同步（build 期无 await，本 toolkit 的工厂都满足）。
 */
export function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/**
 * 把任意 (spec, index) 工厂包成确定性版：seed = hashStr(spec.id) + index 派生。
 * core/ 的 createEnemy（不可改）在 src/species/index.js 里就是用它接进来的。
 */
export function seededFactory(factory) {
  return (spec, index) => withSeed(
    (hashStr(spec.id) + (index || 0) * 2654435761) >>> 0,
    () => factory(spec, index));
}
