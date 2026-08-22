---
name: procedural-3D-species
description: AI-assisted workflow for adding a new species to the procedural-3D library — turn a one-sentence creature description into a spec table (palette/proportions/gait), wire it into the registry, and get horde instancing, hit volumes, dismemberment and ragdoll for free. Use when asked to design/add a new monster, zombie, robot or creature species, when a spec misbehaves (floating feet, unreadable silhouette, palette not applying, headshot boxes inflated by decorations), or when integrating horde rendering / hit testing / ragdoll death.
---

# procedural-3D — writing a new species

The library (repo root): `src/core/` generic machine (sands-of-the-restless, MIT,
**verbatim — never modify**), `src/` pipeline (bake/gait/rng/prims/lod/hitvol/ragdoll),
`src/species/` data tables + factories, `src/gunpals/` living weapons,
`examples/` five demo pages. Everything is code-generated; there are no asset files.

## The one-sentence-to-spec workflow

Input: a creature description ("a bloated plague zombie that waddles", "a six-legged
security spider robot"). Output: a registered species that walks in the viewer, joins
the horde, and is fully hittable/dismemberable.

1. **Pick the silhouette word first.** At 20 m the player reads only the outline.
   Each existing species owns one geometric word: hunched (zombie), barrel (bloater),
   slash/line (runner), wall (brute), V (screecher), prone (crawler), dome (tickbot)…
   If your creature's word collides with an existing one, push proportions further apart.
2. **Copy the nearest exemplar:**
   - humanoid → `src/species/zombie.js` (pure spec + textures + factory)
   - quadruped / prone → `src/species/crawler_true.js` (custom rig, humanoid-contract skeleton)
   - multi-limb robot → `src/species/robots.js` (spiderbot = 6 legs, centaurbot = 4 legs + 4 arms)
   - limbless organic → `src/species/maggot.js` (lathe/ellipsoid/cyl only, slug gait)
3. **Write the spec tables** (contracts below). Respect the iron rule
   `hipY = thighL + shinL` or the feet float.
4. **Textures** (optional): follow the wraps.js/zombie.js canvas paradigm — draw albedo
   with height/rough in the same pass, derive normal (Sobel) and packed roughness, then
   `compensate()` to preserve palette brightness. Grayscale maps let the palette tint;
   paint hues into the map for multi-tone skin.
5. **Factory**: copy `createZombie` — build actor → makeMaterials → `spec.build` →
   record scale/triangles/phase. Seeding is built in:
   `seed = (hashStr(spec.id) + index * 2654435761) >>> 0`.
6. **Register**: one line in `src/species/index.js` (`SPECIES` table). The single viewer
   and lineup pick it up automatically; add it to horde mixes / shooter HP tables in
   `examples/` only if it should join those.
7. **Verify with the pages, not by guessing**: `examples/single.html?species=<id>` for
   gait and hit volumes (`?vol=1`), `examples/lineup.html` for the 20 m silhouette check,
   `examples/horde.html?species=<id>` for instancing. Every page exposes a test hook
   (`window.__pmtk` / `__horde` / `__shooter`) with `ready`, draw calls and triangle
   counts — assert numbers, don't trust your eyes on a software renderer.

## Spec contracts (what the pipeline consumes)

Top level: `id`, `name`, `speed` (~1–3 m/s), `scale` (~0.9–1.1), `height`, `radius`,
`build` (humanoids: `buildHumanoid`), `animate` (humanoids: `MUMMY.animate`).

- **palette** — six material slots consumed by `buildHumanoid`:
  `wrap` (main: thighs/upper arms/chest/skull), `wrapDark` (pelvis/shins/forearms/belts),
  `deep` (eye sockets, near-black), `eye` (emissive eye color; `eyeGlow` for strength),
  `accent` (optional trim), `tatter` (rag strips, falls back to wrapDark).
- **proportions** (meters — this *is* the silhouette): `hipY` (**= thighL + shinL**),
  `hipW`, `bodyD`, `legX`, `legW`, `thighL`, `shinL`, `torsoY`, `chestW`, `chestH`,
  `shoulderX`, `shoulderY`, `armW`, `upperL`, `foreL`,
  `headY`, `headW`, `headH`, `headD` (head width ≈ 1/4–1/3 of shoulder span),
  `tatterRest`, `tatters[]` (`on/side/x,y,z/w,h/yaw/cut/swing/out`).
- **gait** (reads as "undead", not "actor"): `rate` (0.7–1.2, far from 1 = foot slide),
  `stride` (~0.5–0.65 rad), `armSwing`, `armReach` (-0.95 = classic zombie reach),
  `armSplay`, `elbowBend` (negative), `lean` (negative = hunched), `sway`, `hipTwist`,
  `bob`, `headLoll`, `headDroop`.

Non-humanoid bodies: a species may bring its own `build`/`animate`. The rig must match
the humanoid contract — `{group, body, hips, torso, neck, legs[{hip,knee}],
arms[{shoulder,elbow}], tatters, blob, stepSpan}`, with every registered joint's
rotation assigned by the animation every frame — then bake/horde/hitvol accept it
unchanged. `rig.legs[2..5]` / `rig.arms[2..3]` are picked up into extended joint slots
12–23 (gait dispatch via `spec.gait.kind`: `'spider'` / `'centaur'` / `'slug'`).

## Pitfalls that have bitten (check before debugging)

- **Bake zeroing contract**: baking zeroes every *registered* joint; static pose angles
  (a crawler's splayed legs) must live on unregistered mount nodes, or be re-applied by
  the animation every frame.
- **Headshots must be physically reachable**: a head buried inside a torso shell can
  never be hit — the head/eye tower must poke out of the torso silhouette.
- **Thin decorations inflate hit boxes**: antennae/fins/fangs on the head enlarge the
  head OBB and players "headshot thin air". Mark them `mesh.userData.noHit = true`
  (bake skips them for hit boxes; rendering and severed-debris subtrees unaffected).
- **Bright palette on dark texture does nothing**: `compensate()` clamps gain at
  `1/max(0.35, gain)` — raise the texture's base brightness first, then the palette.
- **Emissive restraint**: `eyeGlow`/`seamGlow` too high reads as blown-out neon; gate
  emissive seams per plate (~40 % lit) and re-screenshot after every brightness change.
- **Determinism (multiplayer premise)**: never a bare `Math.random()` in species code —
  all randomness flows through `src/rng.js` (`withSeed` wraps the unmodifiable core;
  factories derive per-instance seeds from the species id).
- **New material slot = +1 draw call per species in the horde**: decorations go into the
  existing six slots; keep one monster at ~1–2.5k triangles.

## Budgets & acceptance numbers

- Instanced horde draw calls = species × material groups (≈6) + 2, **independent of
  count**: 300 mixed monsters ≈ 38–61 calls; naive per-actor rendering of 100 = 1803.
- Shooter page steady state ≈ 42 calls, peak ≤ 48 with debris pool + ragdolls.
- Distance-tiered LOD (default on in horde): <12 m every frame, 12–25 m half rate,
  25–40 m quarter rate, >40 m frozen — phase-continuous (slowed rate, not slowed motion).
- Ragdoll pool: 32 max, 14 Verlet points; crawlers/multi-leg species fall back to
  topple-and-sink. Severed-limb debris pool: 6 slots.
