/**
 * gunpals/bowpals.js — entry module of the "bow pals" family (second living-weapon
 * family, mirrors GunPalToolkit 0.2.0 src/bowpals.js).
 *
 * Bow pals are living bows: five motifs (mecha compound / aurelia seraph-gold /
 * dracobow black-dragon / sakura fox-flame / frostbite ice-wisp) with big eyes +
 * eyelid blinks, idle look-back at the holder, aim = stare down the shooting
 * direction, and a release reaction (recoil + limb flutter + eyes widen +
 * motif-colored flash). Driven by BowActor (GunActor subclass): update(dt, camera),
 * requestState('idle'|'aim'), release().
 *
 * 中文原文档（设计细节）保留在下方。
 */
/**
 * bowpals.js — GunPalToolkit 弓家族入口模块（第二武器家族「活体弓」）。
 *
 * 「弓是活的魔物」：五母题活体弓（机甲复合/圣金/黑龙/樱焰/霜刃）——
 * 大眼睛 + 眼皮眨眼 + 闲置回头看持弓者 + 拉弓注视出射方向 + 放箭瞬间
 * 活体反应（后坐/臂片抖动/眼睛瞪大/母题色释放闪光）。
 *
 * 最小接入（宿主自备 three，importmap 提供 bare specifier 'three'）：
 *
 *   import { SPECS, specForId, makeBowBody, makeArrowMesh } from './bowpals.js';
 *   const bow = makeBowBody(specForId(playerId));  // 按 id 哈希确定性选型
 *   scene.add(bow);
 *   // 每帧：bow.userData.actor.update(dt, camera);
 *   // 拉弓：actor.requestState('aim')；未拉/搭箭 idle；放箭：actor.release()
 *
 * 兼容性：makeBowBody / makeArrowMesh / specForId / setBowOverride 与 mr-bow
 * 旧 js/bowspecs.js 签名一致（2026-08-26 收编重做，游戏侧零适配成本）。
 * 环境反射：高金属度 PBR 需要 scene.environment = makeEnvTexture()（scifi.js）。
 */
import { SPECS, makeBowBody, makeArrowMesh, BowActor } from './bows.js';

export { SPECS, makeBowBody, makeArrowMesh, BowActor } from './bows.js';
export { patternTextures, texWithRepeat, makeEnvTexture } from './scifi.js';

/** 内置弓 id 列表。 */
export const BOW_IDS = SPECS.map((s) => s.id);

// ---------- 按 id 哈希确定性选型（联机约定：外观不走网络，远端同 id 同弓） ----------
// ?bow=<specId> 全局覆盖仅调试用（截图/强制选型）。
let _override = null;
export function setBowOverride(specId) { _override = SPECS.find((s) => s.id === specId) || null; }
export function specForId(id) {
  if (_override) return _override;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPECS[h % SPECS.length];
}

/**
 * 建一把活体弓（GunPal buildGun 同款返回契约的弓族版）。
 * @param specOrId  SPECS 条目或弓 id 字符串
 * @returns {{ id, group, update(dt, camera), actor, spec }}
 *   group 可直接 add 进场景（局部帧 Y=梢、Z=出射、X=厚度）；
 *   actor 是 BowActor 实例（requestState/release/state/counts/debugBlink/lidAngle）。
 */
export function buildBow(specOrId) {
  const spec = typeof specOrId === 'string'
    ? SPECS.find((s) => s.id === specOrId)
    : specOrId;
  if (!spec) throw new Error(`GunPalToolkit: 未知弓 id "${specOrId}"（可选：${BOW_IDS.join('/')}）`);
  const group = makeBowBody(spec);
  const actor = group.userData.actor;
  return { id: spec.id, group, actor, spec, update: (dt, cam) => actor.update(dt, cam) };
}
