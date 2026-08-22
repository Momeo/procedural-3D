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
};
