/**
 * species/index.js — Species registry: the single place where every built-in
 * species is wired up ({ spec, factory } per id). Add one entry here to ship a
 * new species; the examples pages consume this table directly.
 *
 * 物种注册表：每个内置物种一行。丧尸系走 species/zombie.js 与
 * species/zombies_ex.js 的 createZombieEx（crawler/maggot 同工厂），
 * 机器人系走 species/robots.js 的 createRobot。
 *
 * Deterministic generation: factories in species/ already embed withSeed
 * (seed = hashStr(spec.id) + index derived).
 */
import { createZombie, ZOMBIE } from './zombie.js';
import {
  createZombieEx, BLOATER, RUNNER, BRUTE, SCREECHER,
} from './zombies_ex.js';
import { CRAWLER_TRUE } from './crawler_true.js';
import { MAGGOT } from './maggot.js';
import { createRobot, TICKBOT, SPIDERBOT, CENTAURBOT, TITAN } from './robots.js';
import { CARRION, MOTH, HORNET, HOVERDRONE } from './flyers.js';
import { SPRITE, EARTH, FROST, DRACO } from './dragons.js';
import {
  SKELTROOPER, BONEHOUND, WRAITH, LICH, GRAVEKNIGHT, BONEBRUTE,
} from './undead.js';

export const SPECIES = {
  zombie:     { spec: ZOMBIE,              factory: createZombie },
  bloater:    { spec: BLOATER,             factory: createZombieEx },
  runner:     { spec: RUNNER,              factory: createZombieEx },
  brute:      { spec: BRUTE,               factory: createZombieEx },
  screecher:  { spec: SCREECHER,           factory: createZombieEx },
  crawler:    { spec: CRAWLER_TRUE,        factory: createZombieEx },  // 真四足爬行（crawler_true.js）
  maggot:     { spec: MAGGOT,              factory: createZombieEx },  // 无腿肉蛆（maggot.js，prims.js 原语样例）
  tickbot:    { spec: TICKBOT,             factory: createRobot },     // 机器人系列（robots.js）
  spiderbot:  { spec: SPIDERBOT,           factory: createRobot },     // 人形蜘蛛：六腿 LEG2/LEG3 扩展位
  centaurbot: { spec: CENTAURBOT,          factory: createRobot },     // 半人马：四腿 LEG2 + 四臂 ARM2
  titan:      { spec: TITAN,               factory: createRobot },     // 巨型人形（buildHumanoid 纯 spec）
  carrion:    { spec: CARRION,             factory: createZombieEx },  // 飞行系列（flyers.js）：尸鹫，一对翼慢扇
  moth:       { spec: MOTH,                factory: createZombieEx },  // 瘟蛾：四翼（ARM2 扩展位）扑棱
  hornet:     { spec: HORNET,              factory: createZombieEx },  // 毒蜂：高频小振幅
  hoverdrone: { spec: HOVERDRONE,          factory: createRobot },     // 浮游机：无翼悬浮 + 自旋环（破布槽）
  sprite:     { spec: SPRITE,              factory: createZombieEx },  // 龙系列（dragons.js）：精灵龙，飘带
  earth:      { spec: EARTH,               factory: createZombieEx },  // 土龙：葫芦胖身 + 小翼
  frost:      { spec: FROST,               factory: createZombieEx },  // 冰龙：骨架 + 烂翼膜
  draco:      { spec: DRACO,               factory: createZombieEx },  // 黑红大龙：王座三角，翼展 3m+
  skeltrooper: { spec: SKELTROOPER,        factory: createZombieEx },  // 亡灵系列（undead.js）：骷髅卒，瘦骨持械
  bonehound:  { spec: BONEHOUND,           factory: createZombieEx },  // 骷髅猎犬：低矮骨兽四足（centaur 步态复用）
  wraith:     { spec: WRAITH,              factory: createZombieEx },  // 怨灵：半透明悬浮幽灵（fly 悬浮支）
  lich:       { spec: LICH,                factory: createZombieEx },  // 尸巫：罩袍施法者 + 骨杖 + 胸口魂火
  graveknight: { spec: GRAVEKNIGHT,        factory: createZombieEx },  // 墓穴骑士：残破板甲精英 + 盾/大剑
  bonebrute:  { spec: BONEBRUTE,           factory: createZombieEx },  // 骸骨巨像：Boss 梯队 2.3x 骨刺塔
};
