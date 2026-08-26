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
import {
  ROCKGOLEM, MAGMAGOLEM, FROSTGOLEM, CRYSTALGOLEM,
} from './golem.js';
import {
  DOLLETTE, DOLLAD, KITDOLL, PUPDOLL, TWINSIE, BUTLER, BIGDOLL,
} from './dolls.js';

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
  rockgolem:  { spec: ROCKGOLEM,           factory: createZombieEx },  // 魔像系列（golem.js）：岩石魔像，圆石桶+装甲板
  magmagolem: { spec: MAGMAGOLEM,          factory: createZombieEx },  // 熔岩魔像：Boss 档 2.3x 黑岩裂炉
  frostgolem: { spec: FROSTGOLEM,          factory: createZombieEx },  // 冰霜魔像：苍白冰塔+半透明冰甲
  crystalgolem: { spec: CRYSTALGOLEM,      factory: createZombieEx },  // 水晶魔像：紫晶半悬浮+碎晶环
  dollette:   { spec: DOLLETTE,            factory: createZombieEx },  // 布偶系列（dolls.js）：女童偶，连衣裙+毛线双辫+木棕纽扣眼
  dollad:     { spec: DOLLAD,              factory: createZombieEx },  // 男童偶：背带裤+短毛线头+双膝补丁
  kitdoll:    { spec: KITDOLL,             factory: createZombieEx },  // 小猫偶：四足小偶，尖耳+毛线胡须+细尾（centaur 步态）
  pupdoll:    { spec: PUPDOLL,             factory: createZombieEx },  // 小狗偶：四足小偶，垂耳+吻部+短尾（centaur 步态）
  twinsie:    { spec: TWINSIE,             factory: createZombieEx },  // 双子抱偶：大孩背迷你偶
  butler:     { spec: BUTLER,              factory: createZombieEx },  // 管家人偶：瘦高成年弯背+燕尾摆+礼帽
  bigdoll:    { spec: BIGDOLL,             factory: createZombieEx },  // 巨型破损布偶：Boss 档 2.2x 棉花爆出
};
