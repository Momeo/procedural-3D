/**
 * gunpals/gunpals.js — entry module of the "gun pals" layer.
 *
 * Gun pals are living creature-weapons (machine × animal/plant/insect): the
 * muzzle is the creature's mouth, it turns to look at you, blinks, and runs a
 * four-state behavior machine (idle/aim/fire/overheat) with muzzle flash,
 * recoil, tracers, laser sight and overheat smoke built in.
 *
 * Minimal integration (host provides three via importmap):
 *
 *   import { buildGun } from './gunpals.js';
 *   const gun = buildGun('stagbite');          // or any id in GUNS
 *   scene.add(gun.group);
 *   // per frame: gun.update(dt, camera);      // camera = look-back target
 *   // input:     gun.actor.requestState('fire');  // 'idle' | 'aim' | 'fire'
 *
 * 中文原文档（设计细节）保留在下方。
 */
/**
 * gunpals.js — gunpals 层入口模块。
 *
 * 「怪物枪」= 机械 × 动/植/昆虫的活体枪械：枪口=怪物的嘴、会回头看你、
 * 卡通眨眼、四档行为状态（idle/aim/fire/overheat）、开火三件套（闪光/后坐/
 * 曳光）+ 激光瞄准线 + 过热冒烟泛红。
 *
 * 最小接入（宿主自备 three，importmap 提供 bare specifier 'three'）：
 *
 *   import { buildGun } from './gunpals.js';
 *   const gun = buildGun('stagbite');          // 或 GUNS 里任一把
 *   scene.add(gun.group);
 *   // 每帧：gun.update(dt, camera);           // camera 用于回头注视
 *   // 输入：gun.actor.requestState('fire');   // 'idle' | 'aim' | 'fire'
 *
 * 拷贝复用约定见 README「同步协议」一节（接入后放 gunpal-kit.json）。
 */

import { mulberry32, hashStr } from './actor.js';
import { GUN_DEFS } from './guns.js';

export const GUNPAL_VERSION = '0.1.0';

export { GUN_DEFS as GUNS } from './guns.js';
export { GunActor, mulberry32, hashStr } from './actor.js';
export { prims } from '../prims.js';
// 自定义新枪用的全套零件（attach/addEyes/emitBrows/特效/材质…）
export {
  bioMat, metalMat, boxGeo, dirEuler, mergeGeoms, attach,
  capProfile, emitBrows, addEyes, addFlash, makeLaser, makeTracer, makeSmoke,
  shell, LID_FULL_DEFAULT,
} from './actor.js';

const BY_ID = Object.fromEntries(GUN_DEFS.map(d => [d.id, d]));

/** 内置枪 id 列表。 */
export const GUN_IDS = GUN_DEFS.map(d => d.id);

/**
 * 建一把怪物枪。
 * @param id    GUN_IDS 之一
 * @param opts  { seed } 可选 32 位种子（默认 hashStr(id)，同 id 跨端一致）
 * @returns {{ id, group, update(dt, camera), actor, tris, def }}
 *   group 可直接 add 进场景（枪口 +Z、上 +Y）；actor 是 GunActor 实例，
 *   状态/计数/调试钩子都在上面（requestState/state/counts/debugBlink/lidAngle）。
 */
export function buildGun(id, { seed } = {}) {
  const def = BY_ID[id];
  if (!def) throw new Error(`gunpals: 未知枪 id "${id}"（可选：${GUN_IDS.join('/')}）`);
  const rng = mulberry32((seed ?? hashStr(id)) >>> 0);
  const out = def.build(id, rng);
  return { ...out, def };
}
