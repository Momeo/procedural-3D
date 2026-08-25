/**
 * procedural-3D — public entry point.
 *
 * Zero-asset, spec-driven procedural monsters + horde instancing pipeline +
 * living "gun pal" weapons, for three.js (ESM, no build step).
 *
 * Layers:
 *   core/     Generic humanoid machine, copied verbatim from
 *             a frozen third-party engine (MIT, see NOTICE) — do not modify.
 *   (root)    Pipeline: bake.js (bake a rig into one geometry per material +
 *             per-vertex joint ids), gait.js (JS re-implementation of the
 *             walk/attack/stagger formulas writing joint quaternions into a
 *             DataTexture), rng.js (seeded determinism), prims.js (curved
 *             geometry primitives), lod.js (distance-tiered animation +
 *             grid frustum culling), hitvol.js (per-part OBB hit volumes),
 *             ragdoll.js (hand-rolled Verlet death ragdoll).
 *   species/  Spec tables + factories for the 25 built-in species
 *             (registry: species/index.js, export SPECIES).
 *   gunpals/  Living creature-weapons: 5 built-in guns with a four-state
 *             behavior actor (idle/aim/fire/overheat).
 *
 * The host page must provide an importmap entry for the bare specifier
 * 'three' (three >= 0.170). See examples/ for complete integrations.
 */

// --- core (frozen engine layer, verbatim) ----------------------------------
export {
  MUMMY, buildHumanoid, createEnemy, strideRate,
} from './core/mummy.js';

// --- pipeline ---------------------------------------------------------------
export { bakeMummy, J, MAX_JOINTS, MAX_CHAIN, SEVER_JOINTS } from './bake.js';
export {
  makeActionState, makeGaitParams, triggerAttack, triggerStagger,
  advanceActions, stepRate, fillJoints,
} from './gait.js';
export {
  mulberry32, hashStr, setSeed, random, currentSeed, withSeed, seededFactory,
} from './rng.js';
export { prims } from './prims.js';
export { LOD_TIERS, makeLodGater, makeCullGrid } from './lod.js';
export {
  PART_MULT, rowReader, beginFk, fkBoxMatrix,
  raycastLocal, coarseSphereWorld, raycastWorld, hitboxCenterWorld,
} from './hitvol.js';
export { RAGDOLL_MAX, buildRagdollTemplate, makeRagdollPool } from './ragdoll.js';

// --- species ----------------------------------------------------------------
export { SPECIES } from './species/index.js';
export { createZombie, ZOMBIE } from './species/zombie.js';
export {
  createZombieEx, BLOATER, RUNNER, BRUTE, SCREECHER,
} from './species/zombies_ex.js';
export { CRAWLER_TRUE } from './species/crawler_true.js';
export { MAGGOT } from './species/maggot.js';
export {
  createRobot, TICKBOT, SPIDERBOT, CENTAURBOT, TITAN,
} from './species/robots.js';

// --- gun pals ---------------------------------------------------------------
export {
  GUNPAL_VERSION, GUNS, GUN_IDS, buildGun, GunActor,
} from './gunpals/gunpals.js';
