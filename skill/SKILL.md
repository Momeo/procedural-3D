---
name: procedural-3D-species
description: AI-assisted workflow for adding a new species to the procedural-3D library — turn a one-sentence creature description into a spec table (palette/proportions/gait), wire it into the registry, and get horde instancing, hit volumes, dismemberment and ragdoll for free. Use when asked to design/add a new monster, zombie, robot or creature species, when a spec misbehaves (floating feet, unreadable silhouette, palette not applying, headshot boxes inflated by decorations), or when integrating horde rendering / hit testing / ragdoll death.
---

# procedural-3D — writing a new species

The library (repo root): `src/core/` generic machine (frozen third-party engine, MIT — see NOTICE,
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
   - flying → `src/species/flyers.js` (carrion = single wing pair, moth/hornet = two
     wing pairs on the ARM2 slots, hoverdrone = wingless hover + spin ring)
   - dragon → `src/species/dragons.js` (long neck + protruding head, chained tatter
     pivots for the tail, membrane wings on the ARM2 slots, `buildDragonRig` shared
     skeleton: sprite = slim, earth = fat with tiny wings, frost = skeletal, draco = big)
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
12–23 (gait dispatch via `spec.gait.kind`: `'spider'` / `'centaur'` / `'slug'` / `'fly'`).
Flyers put their cruise altitude in `spec.flyY` (baked into the geometry, hit boxes
included) and their wing/flap parameters in `spec.gait.fly`. Optional hover-pose
params `fly.hoverPitch` / `fly.hoverHeadUp` (both default 0 = unchanged) are
weighted by `1 - drive`: big flyers rear up and tilt the head down at prey when
slowing to a hover (draco uses -0.20 / +0.32 for the looming Smaug pose).

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
- **fleshMaps is hue-tinted (greenish)**: saturated light palettes (lake blue, sandy
  yellow) multiply into the wrong hue — swap the wrap slot to neutral `linenMaps()`
  via `spec.makeMaterials` (sprite/earth dragons do exactly this; dark palettes like
  draco/frost are unaffected and keep the default flesh).
- **Emissive restraint**: `eyeGlow`/`seamGlow` too high reads as blown-out neon; gate
  emissive seams per plate (~40 % lit) and re-screenshot after every brightness change.
- **Determinism (multiplayer premise)**: never a bare `Math.random()` in species code —
  all randomness flows through `src/rng.js` (`withSeed` wraps the unmodifiable core;
  factories derive per-instance seeds from the species id).
- **New material slot = +1 draw call per species in the horde**: decorations go into the
  existing six slots; keep one monster at ~1–2.5k triangles.

## Quality gates (anyCreature workflow)

A species is not done when the probes are green — it is done when it passes three gates.
Evidence is kept for every round.

1. **Machine gate (hard floor)** — `tools/quality.html` driven by `tools/_probe_quality.py`
   (run inside `tools/`, with a static server on `:8622` from the repo root):
   `python _probe_quality.py`. It validates every registered species (zero **BLOCK**:
   `hipY = thighL + shinL`, `jointCount ≤ 32`, palette keys present, head hit box exists
   and is not buried inside the torso/hips box, `tri ≤ 2500`) and renders four silhouette
   views (front/side/45°/top) with 24×24 thumbnails, guarding them against
   `tools/_quality_baseline.json` at **IoU ≥ 0.85**. First run creates the whole
   baseline (normal). Later IoU in [0.85, 1) auto-updates with a WARNING — a drifting
   silhouette needs a human ack. A reshape round deliberately drops IoU below 0.85:
   confirm it explicitly with `python _probe_quality.py --accept <id1,id2>` (the FAIL
   stands without the flag — the regression guard never relaxes itself).
2. **Gate 1 RECOGNISED** — feed `_shots/quality_<id>.png` (four views + 24 px
   thumbnails, unlabeled) to a **fresh context-free reviewer** (no design intent, no
   species name) and ask only "what creature is this?". Record the answers verbatim per
   view. All four views must be recognised; one miss sends you back to silhouette
   design — never argue the reviewer into being right.
3. **Gate 2 PUNCHIER** (from the second reshape round on) — show old vs new silhouette
   grids side by side to a context-free reviewer and ask "which is bolder / more
   readable?". Only bolder is allowed; if the reshape went tame, roll back.
4. **Two strikes and you redesign**: the same symptom (same unrecognised view, same
   BLOCK) failing twice → drop the concept and restart. No third micro-tweak.
5. **Delivery ledger** — end every delivery with one line:
   `gates: <ID> pass@r<round> PUNCH pass@r<round> | restarts: <n> | unresolved: <items>`.

Silhouette-tooling notes:

- **Blind-review grids carry no names**: `_probe_quality.py` always loads
  `quality.html?noname=1` so the species name never enters the pixels (filenames still
  carry it — strip them when handing images to a reviewer).
- **Winged flyers are pinned to top-of-flap**: their silhouette pose is fixed at
  `sin(flap phase) = +1` (wings fully raised). Without the pin, any geometry edit
  shifts the factory seed stream and you end up comparing animation phases instead of
  geometry (this actually happened: vulture r1 vs r2).
- Flyer thumbnails are cropped to the mask bounding box, so a wide wingspan does not
  shrink the 24 px silhouette to noise.

## Budgets & acceptance numbers

- Instanced horde draw calls = species × material groups (≈6) + 2, **independent of
  count**: 300 mixed monsters ≈ 38–61 calls; naive per-actor rendering of 100 = 1803.
- Shooter page steady state ≈ 42 calls, peak ≤ 48 with debris pool + ragdolls.
- Distance-tiered LOD (default on in horde): <12 m every frame, 12–25 m half rate,
  25–40 m quarter rate, >40 m frozen — phase-continuous (slowed rate, not slowed motion).
- Ragdoll pool: 32 max, 14 Verlet points; crawlers/multi-leg species fall back to
  topple-and-sink. Severed-limb debris pool: 6 slots.
