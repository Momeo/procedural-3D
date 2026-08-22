// 出处：sands-of-the-restless（MIT，作者 Eddie Belaval）src/enemies/wallcrawl.js 原样拷贝，仅加本行注释。
// 上游：https://github.com/eddiebelaval/sands-of-the-restless —— 许可原文见 ../LICENSE-sands.txt
/**
 * THE ONE ENEMY THAT DOES NOT LIVE ON THE FLOOR.
 *
 * THE HABIT THIS IS BUILT AGAINST is the same one the gold scarab already
 * exists to punish, one axis further out. variants.js says it plainly: by wave
 * fifteen the player has a single answer to everything, which is backpedal in a
 * circle and hold fire. The gold scarab moved the soft panel to the BACK, which
 * breaks the "hold fire" half. It did not touch the other half, because every
 * body in the roster still arrives along the floor, so the player's SEARCH is
 * still a horizontal sweep at eye level and it is still complete. An enemy that
 * comes down the wall behind them, or lets go of the ceiling over their head, is
 * the first thing in the game that a horizontal sweep does not find.
 *
 * WHY THIS IS NOT A FLOW FIELD PROBLEM, AND WHY IT GETS ITS OWN STEERING.
 * enemies/flow.js is a distance-to-player map over ONE floor, keyed on (x, z),
 * and its own header says what it drops: it cannot hold the gallery floor and
 * the bridge six metres over it at the same time. A body on a wall is not on
 * either. So nothing here reads the field: the crawler's whole route is three
 * legs, each of which is a straight line in a surface it is already stuck to.
 * That is enough because the legs are short - pick a wall inside 14 m, climb it,
 * cross the ceiling of ONE room - and a body that cannot solve a maze on a
 * ceiling is a body that gives up and drops, which is the behaviour we want
 * anyway.
 *
 * WHY AXIS-ALIGNED BOXES MAKE THIS SMALL. Every wall in the game comes out of
 * emitWall() in world/build.js as `{x, z, w, d, y0, y1}`, so a wall surface
 * normal is always one of four horizontal unit vectors and never anything else.
 * There is no mesh traversal here, no raycast, no contact solver: a face is a
 * fixed coordinate plus a clamped span, and "walking on it" is two scalars.
 *
 * WHAT THE CEILING IS. Also a wall record. buildShell() emits a room's side
 * walls from the floor to the ceiling in one box, so a full-height wall's `y1`
 * IS the room's ceiling height, and `topsOut()` below is what refuses the two
 * kinds of box whose top is not a ceiling - the breast under a doorway and any
 * wall with another wall stacked over it.
 *
 * THE HUNT CYCLE, which is the part that had to be designed rather than derived:
 *
 *   ground   ordinary floor pursuit, mummy.js's, untouched. After COOL_S with
 *            the player further off than MOUNT_MIN_M it goes looking for a wall.
 *   approach still on the floor, still under separation and avoid() and the
 *            wedge escape, but steering at a wall face instead of at the player.
 *   wall     climbing, drifting sideways toward the player's lateral position.
 *   coil     stopped dead at height, TURNED TO FACE THE PLAYER. The tell.
 *   leap     in the air on a committed ballistic arc.  <- THE PAYOFF
 *   roof     upside down, crossing to a point over the player. The fallback,
 *            taken when the player is not in the leap window.
 *   drop     lets go, falls under mummy.js's own gravity, rights itself.
 *
 * A crawler that only mounted a wall it happened to be jammed against would
 * almost never leave the floor, because its heading is by definition AWAY from
 * the wall and toward the player. The approach leg is the whole reason this
 * reads as an enemy doing something rather than as a physics accident.
 *
 * ---------------------------------------------------------------------------
 * THE LEAP, AND WHY THE CLIMB HAD NO POINT WITHOUT IT
 * ---------------------------------------------------------------------------
 *
 * The owner, playing: "what if they run up the walls and jump at me? So they're
 * basically trying to get a good height so that they can jump on top of me."
 *
 * That is a diagnosis, not a feature request. As shipped, a wall was a ROUTE:
 * the only thing at the top of it was the ceiling, and the only thing the
 * ceiling did was carry the body to a point over the player's head where it let
 * go. Measured over 45 s in the Hall of Offerings, the crawler spent 28 per cent
 * of its life off the floor and the wall leg itself was pure transit - nothing
 * the player could answer happened on it, and nothing about being three metres
 * up was different from being on the ground except that the beetle was harder to
 * shoot. A climb whose payoff is a route is a climb the player has no reason to
 * look at.
 *
 * A LEAP MAKES THE HEIGHT THE POINT. The body gains altitude BECAUSE altitude
 * buys it a dive, the player can see the altitude being gained, and the dive is
 * the thing they have to answer.
 *
 * FOUR RULES HOLD IT INSIDE THIS GAME'S VOCABULARY, which is "you have one
 * second to answer this":
 *
 *   IT ANNOUNCES. COIL_S of a dead stop with the body turned off the climb to
 *   face the player. Nothing else in the roster stops moving at height, so the
 *   silhouette going still IS the telegraph, and it costs the player nothing to
 *   learn.
 *
 *   IT DOES NOT TRACK. The arc is solved once, at the instant of launch, against
 *   where the player IS. It is a thrown object from that frame on. A homing
 *   pounce is not a thing you can dodge, it is a thing you can only out-damage,
 *   and this game already has enough of those.
 *
 *   IT LAUNCHES FROM A WALL AND NEVER FROM THE ROOF. A dive that begins directly
 *   over the player's head is exactly the unblockable ambush this feature is one
 *   bad decision away from being. On a wall the arc is LATERAL, which means it
 *   crosses the player's field of view before it arrives.
 *
 *   AND IT LAUNCHES FROM FOUR METRES, NOT FROM SIXTEEN. LEAP_H caps the height,
 *   so a crawler in the Great Gallery does not plummet out of a 16 m ceiling at
 *   terminal velocity. The cap is what keeps the flight time long enough to be
 *   a beat rather than an event.
 *
 * IT LANDS AND THEN IT BITES, and the leap itself deals nothing. The whole
 * flight runs through mummy.js's `off` branch, which zeroes windup and strike
 * for exactly the reason a body on a ceiling must not bite through the roof. So
 * there is no second damage path here, systems/damage.js is untouched, and the
 * cost of being landed on is the ordinary bite with its ordinary wind-up.
 */

import * as THREE from 'three';

export const SURF_FLOOR = 0;
export const SURF_WALL = 1;
export const SURF_ROOF = 2;
/**
 * THE FOURTH SURFACE IS NO SURFACE: the body is in the air, on a ballistic arc
 * it committed to before it left the stone. See THE LEAP below.
 */
export const SURF_LEAP = 3;

/** Outward normals of the four faces, indexed 0:+X 1:-X 2:+Z 3:-Z. */
const FACE_NX = [1, -1, 0, 0];
const FACE_NZ = [0, 0, 1, -1];

// ---------------------------------------------------------------------------
// the numbers
// ---------------------------------------------------------------------------

/**
 * Climb speed, as a fraction of the spec's floor speed.
 *
 * 0.62 of the gold scarab's 3.9 is 2.42 m/s, which takes it up the Hall of
 * Offerings' 9 m ceiling in 3.7 seconds and the Great Gallery's 16 m in 6.6.
 * The upper bound on this number is not fiction, it is a firing window: the
 * whole point of a wall leg is that the player CAN look up and shoot it off the
 * stone, and a body that clears a nine-metre wall in under two seconds is a body
 * that was never really there to be shot at.
 */
const WALL_MUL = 0.62;

/**
 * Ceiling speed, same units.
 *
 * Faster than the climb because nothing is fighting it, and still 3.04 m/s -
 * UNDER the player's 5.4 m/s walk, which is the constraint GOLD_SCARAB's own
 * `speed` comment sets and for the same reason: an enemy the player cannot walk
 * out from under is an enemy with no counterplay, and here the counterplay is
 * literally to step aside.
 */
const ROOF_MUL = 0.78;

/**
 * How long the floor-to-wall and wall-to-ceiling turns take, in seconds.
 *
 * These are the readability numbers and they are the reason there is a transit
 * state at all rather than a surface swap. 0.55 and 0.50 are each about two of
 * the player's ~0.25 s reaction windows - the same currency the GOLD_SCARAB
 * wind-up is priced in - so both turns are events a player can see happen and
 * react to, instead of a body that was on the floor last frame and on the wall
 * this one.
 */
const MOUNT_S = 0.55;
const LIP_S = 0.50;

/**
 * Seconds pressed against a wall face before the mount commits.
 *
 * DELIBERATELY UNDER WEDGE_TRIP, which is 0.35 in mummy.js. A body holding a
 * heading into stone and covering no ground is exactly what the wedge detector
 * is watching for, and it would open a committed 2.4 s sideways detour and drag
 * the crawler off the face it was about to climb. 0.25 wins that race by a
 * tenth of a second, and the FLOOR branch below also zeroes st.wedge while the
 * press is building, so the two systems do not have to be read together to be
 * safe.
 */
const GRAB_S = 0.25;

/** How close the body's origin has to get to the mount spot to count as pressed. */
const GRAB_D = 0.55;

/**
 * The shortest wall worth climbing, in metres above the floor at its base.
 *
 * Room heights on this map are 5, 7, 9, 12, 16 and 30, so 4.0 admits every room
 * and excludes the two box shapes that are not rooms: the breast under a
 * doorway (sill minus one ramp thickness) and any low run. It is also about the
 * shortest drop that reads as a drop rather than as a hop.
 */
const MIN_WALL_H = 4.0;

/**
 * How far it will walk to reach a wall, and how long it will spend trying.
 *
 * 14 m at 3.9 m/s is 3.6 seconds of approach. Further than that and the player
 * has usually moved somewhere the chosen wall no longer overlooks, which turns
 * the whole cycle into a body walking away from the fight - the single worst
 * thing this feature could look like.
 */
const APPROACH_R = 14;
const APPROACH_MAX_S = 5.0;

/**
 * WHAT A FAILED APPROACH COSTS, AND WHY IT COSTS ANYTHING AT ALL.
 *
 * MEASURED, and it is the one defect the swarm scenario in test/wallcrawl.mjs
 * caught. Six gold scarabs in the Great Gallery, and the one placed at
 * (0, -192) landed on the upper ledge at y 6. From up there the nearest
 * climbable box is the head slab over a doorway - y0 4.2, which is under its
 * feet, so it passes every filter above - and the ledge does not reach the part
 * of that face the search picked. It walked at it, timed out at 5 s, re-picked
 * the same slab, and did that for the whole 45-second run: surface 0 the entire
 * time, never once closer than 13.55 m, while the ordinary scarab from the
 * identical point arrived at 1.8 m. A wall crawler that never crawls and never
 * arrives is strictly worse than the enemy it replaced.
 *
 * So a failed approach buys a full cooldown of ordinary floor pursuit rather
 * than an immediate second guess, and three failures in a row buy four of them.
 * Same argument as DETOUR_S's forceSide in mummy.js - a hand that bought nothing
 * does not get a second turn - and the same shape of consequence if it is
 * missing: a round that does not end.
 */
const FAIL_GIVEUP = 3;

/**
 * It will not start climbing with the player inside this range.
 *
 * 7 m. Closer than that, a beetle turning and scaling a wall reads as FLEEING,
 * and worse, it would be a way to break contact and heal the fight's tempo -
 * the same complaint GOLD_SCARAB's stagger note makes about chip-firing into
 * the front plate.
 */
const MOUNT_MIN_M = 7;

/**
 * Horizontal radius under which it lets go.
 *
 * 2.2 m against an effective bite reach of 1.35 x 1.18 = 1.59 plus the player's
 * radius. So it lands just inside its own attack range rather than needing a
 * second approach after the drop, which is what makes the ambush pay.
 */
const DROP_R = 2.2;

/** The tell before it lets go: it stops dead for a third of a second first. */
const POISE_S = 0.30;

/**
 * Give-up timers for the two off-floor legs.
 *
 * Same argument as DETOUR_S's "a hand that bought nothing does not get a second
 * turn": a crawler that cannot get over a player who has walked into a room it
 * cannot reach the ceiling of must come down and fight, because a round that
 * does not end is worse than an enemy that made a bad choice.
 */
const WALL_MAX_S = 8;
const ROOF_MAX_S = 7;

/**
 * Floor time between one drop and the next mount.
 *
 * 5 s, and it is a balance number rather than a technical one. The drop puts a
 * gold scarab on the floor with its back panel toward whoever it just landed
 * next to; without a cooldown it would immediately go looking for another wall
 * and spend the fight out of reach. Five seconds is about two full magazines of
 * the starting pistol, which is the window the vent is meant to be shot in.
 */
const COOL_S = 5;

/** Seconds of righting after it lets go, and how fast a heading settles. */
const RIGHT_S = 0.45;
const ORIENT_RATE = 9;

// ---------------------------------------------------------------------------
// the leap
// ---------------------------------------------------------------------------

/**
 * The height above the wall's own floor that the crawler climbs to before it
 * will consider a dive.
 *
 * 4.2 m, and the number is set by the ARC rather than by the room. The solve
 * below fixes the flight at FLIGHT_S, so launch height chooses how much of that
 * flight is spent rising: from 4.2 m at a target 6 m away the body leaves the
 * stone at 5.26 m/s upward, tops out 0.58 m ABOVE the launch point and comes
 * down the far side. That rise is the whole readability of the move - a body
 * that only ever falls reads as something that lost its grip.
 *
 * It is also a CEILING and that is the half that matters. The Great Gallery is
 * 16 m tall and a crawler that climbed to the lip before diving would arrive at
 * over 19 m/s with a flight the player could not see the start of. Capping the
 * launch keeps every leap in the game the same readable shape whatever room it
 * happens in.
 */
const LEAP_H = 4.2;

/**
 * It will not dive from lower than this, in metres above the landing floor.
 *
 * 2.8. Below it the arc is flat, the body arrives before the eye has separated
 * it from the wall, and the whole thing reads as a beetle falling off. It is
 * also comfortably over MIN_WALL_H's 4.0 minus the LIP, so every wall this file
 * will climb can support a launch.
 */
const LEAP_MIN_H = 2.8;

/**
 * The horizontal window, in metres.
 *
 * MIN 3.2, because DROP_R is 2.2: a player standing at the foot of the wall is
 * already inside the drop, and adding a second way to arrive on them from there
 * is how a readable move becomes an ambush. The floor here is deliberately a
 * metre outside it so the two never compete for the same frame.
 *
 * MAX 9.0, because the solve turns distance into horizontal SPEED at a fixed
 * flight time. At 9 m the body crosses at 10.6 m/s, which is already twice the
 * player's 5.4 m/s walk; further out it stops being a leap and becomes a
 * projectile that happens to have legs.
 */
const LEAP_MIN_R = 3.2;
const LEAP_MAX_R = 9.0;

/**
 * The tell: seconds stopped dead at height, turned off the climb to face the
 * player, before anything is committed.
 *
 * 0.45, which is a little under two of the player's ~0.25 s reaction windows -
 * the same currency MOUNT_S and LIP_S are priced in, and half again as long as
 * POISE_S because this one has to carry further. The stop is the signal: every
 * other body in this game is always moving, so a silhouette that goes still at
 * four metres up is not something a player has to be taught.
 */
const COIL_S = 0.45;

/**
 * Time in the air, in seconds.
 *
 * 0.85, and it is fixed rather than derived because the flight time IS the
 * answering window and it must not shrink when the crawler happens to be
 * closer. At 5.4 m/s a player who starts moving on the launch frame covers
 * 4.6 m before the body lands, which is more than a beetle's width in any
 * direction: the dodge exists, it is generous, and it is the same size whatever
 * range the leap was thrown from.
 *
 * Together with COIL_S the whole move is 1.30 s from the first sign to impact.
 */
const FLIGHT_S = 0.85;

/**
 * Gravity for the arc.
 *
 * The SAME 24 the fall in mummy.js integrates and the same one crawlDeathFall
 * uses. Not a constant this file gets to have an opinion about: the solve has
 * to agree with the integrator that finishes the arc after it lands, or a leap
 * that is interrupted one frame early falls at a different rate than it flew.
 */
const LEAP_G = 24;

/** How long a leap may stay in the air before it is force-landed. */
const LEAP_MAX_S = FLIGHT_S * 2.2;

/** Height on the face the mount lands at, and clearance kept under the ceiling. */
const MOUNT_H = 0.45;
const LIP = 0.5;

/** How often the wall search runs while approaching. See pickWall for the cost. */
const PICK_S = 0.75;

/**
 * How far under the ceiling the containment probe stands.
 *
 * 0.6 m. The probe passes this as `feetY` to mummy.js's pointClear, whose wall
 * test is `head <= w.y0 || feetY >= w.y1`; with a gold scarab's actorHeight of
 * 0.65 that puts the probe's head a whisker ABOVE the ceiling line, so every
 * box that reaches the ceiling - the room's own walls and the lintel over every
 * doorway - blocks it. That is what keeps a ceiling crawl inside one room
 * without this file knowing anything about the room graph.
 */
const CEIL_PROBE = 0.6;

// ---------------------------------------------------------------------------
// scratch, allocated once for the module
// ---------------------------------------------------------------------------

const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/**
 * Build the rotation that stands a body up on a surface.
 *
 * The rig convention is the one every animator in this project assumes: the
 * actor's own +Y is up and its own +Z is forward. So the target basis is
 * columns [n x f, n, f], with the forward vector projected into the surface
 * plane first because a heading toward a player standing on the floor is not
 * perpendicular to a wall normal and would shear the body if used raw.
 *
 * X = n x f rather than f x n is forced, not chosen: on the floor n is +Y and
 * f is (sin yaw, 0, cos yaw), and n x f comes out (cos yaw, 0, -sin yaw), which
 * is exactly the first column of Ry(yaw). The other order builds a mirror.
 */
function aim(q, nx, ny, nz, fx, fy, fz) {
  _up.set(nx, ny, nz);
  _fw.set(fx, fy, fz);

  _fw.addScaledVector(_up, -_fw.dot(_up));
  if (_fw.lengthSq() < 1e-6) {
    // The heading was straight into the surface. Any axis not parallel to the
    // normal will do for one frame; the steering will have a real one by the
    // next.
    _fw.set(-_up.z, _up.x, _up.y);
    _fw.addScaledVector(_up, -_fw.dot(_up));
  }
  _fw.normalize();

  _rt.crossVectors(_up, _fw);
  _m.makeBasis(_rt, _up, _fw);
  return q.setFromRotationMatrix(_m);
}

// ---------------------------------------------------------------------------
// wall geometry
// ---------------------------------------------------------------------------

/** Which face of this box a point is outside of, or -1 if it is inside it. */
function faceOf(w, px, pz) {
  const dx = px - w.x;
  const dz = pz - w.z;
  const ox = Math.abs(dx) - w.w / 2;
  const oz = Math.abs(dz) - w.d / 2;
  if (ox <= 0 && oz <= 0) return -1;
  if (ox >= oz) return dx >= 0 ? 0 : 1;
  return dz >= 0 ? 2 : 3;
}

/**
 * Is this box's top a ceiling, or is it the top of a step?
 *
 * buildShell emits three kinds of box on a wall line: floor to ceiling, floor to
 * the breast under a doorway, and the head of a doorway up to the ceiling. Only
 * the first is climbable to somewhere, and the tell is that nothing else in the
 * wall list stands ON it. The breast always has the door's head slab directly
 * above, so one overlap test separates them without this file needing to know
 * what a sill is.
 *
 * Linear over the wall list, and it runs once per candidate that has already
 * won the distance sort rather than once per candidate, so the O(n^2) shape it
 * looks like is really one extra pass every PICK_S seconds.
 */
function topsOut(walls, w) {
  for (const v of walls) {
    if (v === w || v.y0 < w.y1 - 0.05) continue;
    if (Math.abs(v.x - w.x) >= (v.w + w.w) / 2) continue;
    if (Math.abs(v.z - w.z) >= (v.d + w.d) / 2) continue;
    return false;
  }
  return true;
}

/**
 * Pick a wall to climb.
 *
 * Scored by how close the FACE is to the player rather than to the crawler,
 * because the point of the trip is to arrive over the player's head: the
 * nearest wall to the body is very often the one behind it. The crawler's own
 * distance is a filter (APPROACH_R) rather than a term in the score.
 *
 * Iterated linearly, like resolveAgainstWorld and pointClear, and for the reason
 * spelled out there: a wall record is up to 38 units long, so a spatial hash
 * either returns it from forty cells or forces a query radius that reads the
 * whole map. There are under a hundred of them and this runs at most once every
 * PICK_S per crawler, against resolveAgainstWorld's twice per frame per actor.
 */
function pickWall(c, ctx, pos, floorY, radius, px, pz) {
  const walls = ctx.walls;
  let best = null;
  let bestFace = -1;
  let bestScore = Infinity;

  for (const w of walls) {
    // A box whose base is off the floor is a lintel, not a wall to climb onto,
    // and one that does not reach MIN_WALL_H is not worth the trip.
    if (w.y0 > floorY + 0.6) continue;
    if (w.y1 - floorY < MIN_WALL_H) continue;

    const face = faceOf(w, pos.x, pos.z);
    if (face < 0) continue;

    // The face point nearest the crawler, kept a body's width in from either
    // end so it is not mounting a corner it will immediately slide off.
    const fx = face === 0 ? w.x + w.w / 2 : face === 1 ? w.x - w.w / 2
      : Math.min(w.x + w.w / 2 - radius, Math.max(w.x - w.w / 2 + radius, pos.x));
    const fz = face === 2 ? w.z + w.d / 2 : face === 3 ? w.z - w.d / 2
      : Math.min(w.z + w.d / 2 - radius, Math.max(w.z - w.d / 2 + radius, pos.z));

    const mx = fx - pos.x, mz = fz - pos.z;
    if (mx * mx + mz * mz > APPROACH_R * APPROACH_R) continue;

    const sx = fx - px, sz = fz - pz;
    const score = sx * sx + sz * sz;
    if (score < bestScore) { bestScore = score; best = w; bestFace = face; }
  }

  if (!best || !topsOut(walls, best)) return false;

  const w = best;
  c.wall = w;
  c.face = bestFace;
  c.nx = FACE_NX[bestFace];
  c.nz = FACE_NZ[bestFace];
  // Lateral axis of the face: Z for the two X-normal faces, X for the others.
  c.lx = bestFace < 2 ? 0 : 1;
  c.lz = bestFace < 2 ? 1 : 0;
  c.faceC = bestFace === 0 ? w.x + w.w / 2
    : bestFace === 1 ? w.x - w.w / 2
      : bestFace === 2 ? w.z + w.d / 2 : w.z - w.d / 2;
  c.lo = (c.lx ? w.x - w.w / 2 : w.z - w.d / 2) + radius;
  c.hi = (c.lx ? w.x + w.w / 2 : w.z + w.d / 2) - radius;
  c.ceilY = w.y1;
  c.baseY = floorY;
  c.approach = 0;

  const cur = c.lx ? pos.x : pos.z;
  const lat = Math.min(c.hi, Math.max(c.lo, cur));
  const px2 = c.lx ? lat : c.faceC;
  const pz2 = c.lx ? c.faceC : lat;
  // The standing spot is one body radius out from the stone, which is where
  // resolveAgainstWorld will hold it anyway.
  c.tgtX = px2 + c.nx * (radius + 0.04);
  c.tgtZ = pz2 + c.nz * (radius + 0.04);
  return true;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * One crawler's whole mutable state, allocated when the director builds its
 * pool and never again. Same contract as the `st` record in mummy.js: a spawn
 * is a write over this and nothing else.
 */
export function createCrawl() {
  return {
    surf: SURF_FLOOR,
    wall: null,
    face: -1,
    nx: 0, nz: 0,          // face normal, horizontal
    lx: 0, lz: 1,          // lateral axis of the face
    faceC: 0,              // the face's fixed coordinate
    lo: 0, hi: 0,          // lateral span, body radius already taken off
    ceilY: 0,
    baseY: 0,
    tgtX: 0, tgtZ: 0,      // where on the floor it is walking to
    // The heading it is driving along the face, in world axes. Rebuilt from the
    // drive every frame rather than integrated, so a body that reverses its
    // lateral correction turns around instead of crabbing sideways up a wall.
    hx: 0, hy: 1, hz: 0,

    press: 0,              // seconds pressed against the face
    hold: 0,               // seconds on the current off-floor surface
    approach: 0,           // seconds spent walking at a wall
    cool: 0,               // seconds until it may mount again
    poise: 0,              // the stop before it lets go
    pickIn: 0,             // throttle on the wall search
    fails: 0,              // approaches in a row that reached no face
    right: 0,              // seconds of righting left after a drop

    // --- the leap ----------------------------------------------------------
    coil: 0,               // seconds of the tell left to run
    air: 0,                // seconds spent on the current arc
    lvx: 0, lvy: 0, lvz: 0,  // the committed velocity. Solved once, at launch.
    // Published for the harness, and the only proof that a body which ended up
    // next to the player got there by leaping rather than by falling off.
    leaps: 0,
    launchY: 0,            // height above the landing floor it launched from
    launchR: 0,            // horizontal range it committed to

    transit: 0,            // seconds left of a surface change
    transitS: 0,
    fromX: 0, fromY: 0, fromZ: 0,
    toX: 0, toY: 0, toZ: 0,
    fromQ: new THREE.Quaternion(),

    // Published for mummy.js and for the harness.
    motion: false,         // the crawl owns position this frame
    owns: false,           // the crawl owns orientation this frame
    speed: 0,              // surface speed, for the walk cycle
    falling: false,
  };
}

/** Back to a floor animal. Called from spawn(), so a pooled body never inherits. */
export function resetCrawl(c) {
  c.surf = SURF_FLOOR;
  c.wall = null;
  c.face = -1;
  c.press = c.hold = c.approach = c.poise = c.right = 0;
  c.cool = 0;
  c.fails = 0;
  c.pickIn = 0;
  c.transit = c.transitS = 0;
  c.motion = c.owns = c.falling = false;
  c.speed = 0;
  // A pooled body must not come back mid-dive, and it must not come back
  // carrying somebody else's leap count either: the harness reads `leaps` as
  // "did THIS actor leap", and a counter that survives a respawn is a counter
  // that reports a leap the run never saw.
  c.coil = c.air = 0;
  c.lvx = c.lvy = c.lvz = 0;
  c.leaps = 0;
  c.launchY = c.launchR = 0;
}

/**
 * Override the steering heading while walking at a chosen wall.
 *
 * A FULL OVERRIDE RATHER THAN A BLEND, and that is the one place this file
 * overrules the flow field. The field's heading points at the player by
 * construction; anything short of replacing it means the crawler leans toward
 * the wall and walks past it forever. What it does NOT overrule is everything
 * mummy.js applies afterwards - separation, avoid(), the committed detour - so
 * an approach still flows around a pillar and still escapes a wedge.
 */
export function crawlSteer(c, dir, pos) {
  if (c.surf !== SURF_FLOOR || !c.wall || c.transit > 0) return;
  const dx = c.tgtX - pos.x;
  const dz = c.tgtZ - pos.z;
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) return;
  dir.x = dx / l;
  dir.z = dz / l;
}

/**
 * Let go.
 *
 * The fall itself is not written here: it hands the body back to mummy.js with
 * `st.feetY` set to where it actually is and `st.vy` at zero, and the ordinary
 * gravity in update() does the rest, including resolving out of any stone it
 * lets go next to. One integrator for falling bodies, not two.
 */
function detach(c, st, rig, radius, rideH) {
  const pos = rig.group.position;

  if (c.surf === SURF_LEAP) {
    // Already in free space and already the right way up. Stepping it off a
    // face normal it is no longer touching would teleport it sideways, which
    // is what a shot beetle looks like when it is hit at the top of its arc.
    land(c, st, rig);
    return;
  }

  if (c.surf === SURF_ROOF) {
    /**
     * TWICE THE RIDE HEIGHT, and it is a continuity fix rather than a fudge.
     * The group origin is the CONTACT point, and the body sits rideH along the
     * body's own up-axis from it. Hanging from a ceiling that puts the shell
     * rideH BELOW the origin; once it has righted itself the shell is rideH
     * ABOVE it. Dropping the origin by the difference is what stops the beetle
     * jumping half a metre upward on the frame it lets go of the roof.
     */
    pos.y -= rideH * 2;
  } else {
    // Off a wall: step clear of the face first, or the first frame of the fall
    // starts inside the stone and the resolver launches it along the room.
    pos.x += c.nx * (radius + 0.05);
    pos.z += c.nz * (radius + 0.05);
  }

  c.surf = SURF_FLOOR;
  c.wall = null;
  c.press = c.hold = c.approach = c.poise = 0;
  c.transit = 0;
  c.cool = COOL_S;
  c.right = RIGHT_S;
  c.falling = true;
  c.motion = false;

  st.feetY = pos.y;
  st.vy = 0;
  st.vx = 0;
  st.vz = 0;
}

/**
 * Commit the arc.
 *
 * SOLVED ONCE, HERE, AND NEVER TOUCHED AGAIN. Flight time is fixed at
 * FLIGHT_S, so the two horizontal components are just the offset over the
 * time, and the vertical one is whatever makes a body under LEAP_G arrive at
 * the landing height at exactly that moment:
 *
 *     vy = dy / T + G T / 2
 *
 * With a target below the launch point the first term is negative and the
 * second is 10.2, so the body still leaves the stone travelling UPWARD and
 * peaks above where it started. That rise is not decoration; it is the
 * difference between a pounce and a body that lost its footing.
 *
 * The target is the player's position AT THIS INSTANT. Everything after this
 * line is a thrown object.
 */
function launch(c, st, ctx, rig, radius) {
  const pos = rig.group.position;

  // Step off the face first, for the same reason detach() does: the first
  // frame of the arc must not start inside the stone it was holding.
  pos.x += c.nx * (radius + 0.05);
  pos.z += c.nz * (radius + 0.05);

  const tx = ctx.playerPos.x;
  const tz = ctx.playerPos.z;
  const ty = ctx.heightAt ? ctx.heightAt(tx, tz, pos.y) : 0;

  c.lvx = (tx - pos.x) / FLIGHT_S;
  c.lvz = (tz - pos.z) / FLIGHT_S;
  c.lvy = (ty - pos.y) / FLIGHT_S + 0.5 * LEAP_G * FLIGHT_S;

  c.launchY = pos.y - ty;
  c.launchR = Math.hypot(tx - pos.x, tz - pos.z);
  c.leaps++;

  c.surf = SURF_LEAP;
  c.wall = null;
  c.air = 0;
  c.coil = 0;
  c.hold = 0;
  c.press = 0;
  c.transit = 0;
  st.feetY = pos.y;
  st.vx = st.vz = st.vy = 0;
}

/**
 * Put it back on the floor's terms.
 *
 * The arc is handed to mummy.js's own integrator with the vertical velocity it
 * was CARRYING, not with zero: a leap cut short by a ceiling, a pillar or a
 * bullet has to keep falling at the rate it was already falling, or the last
 * few centimetres of the move happen under different physics than the rest of
 * it. That is the one seam in this file a player could actually see.
 */
function land(c, st, rig) {
  const vy = c.lvy;
  c.surf = SURF_FLOOR;
  c.wall = null;
  c.press = c.hold = c.approach = c.poise = c.air = c.coil = 0;
  c.transit = 0;
  c.cool = COOL_S;
  c.right = RIGHT_S;
  c.falling = true;
  c.motion = false;
  c.speed = 0;

  st.feetY = rig.group.position.y;
  st.vy = Math.min(0, vy);
  st.vx = 0;
  st.vz = 0;
}

/**
 * Killed while it was up there.
 *
 * Called from beginDeath, because update() hands a dying actor straight to
 * updateDeath and crawlTick never runs again. Returns whether it had to let go,
 * which is the fact the death path needs in order to know it owes the corpse a
 * fall.
 */
export function crawlKilled(c, st, rig, radius, rideH) {
  if (c.surf === SURF_FLOOR && c.transit <= 0) return false;
  detach(c, st, rig, radius, rideH);
  return true;
}

/** Open a timed surface change from where the body is to where it is going. */
function beginTransit(c, rig, seconds, surf, tx, ty, tz) {
  const pos = rig.group.position;
  c.fromX = pos.x; c.fromY = pos.y; c.fromZ = pos.z;
  c.toX = tx; c.toY = ty; c.toZ = tz;
  c.fromQ.copy(rig.group.quaternion);
  c.transit = seconds;
  c.transitS = seconds;
  c.surf = surf;
  c.hold = 0;
  c.poise = 0;
}

/**
 * One frame of the crawler.
 *
 * Sets `c.motion` (does this own the body's position), `c.owns` (does it own
 * the body's rotation) and `c.speed` (surface speed, for the walk cycle), and
 * is the only thing in the file mummy.js has to call.
 *
 * `clear` is mummy.js's pointClear passed in rather than imported, so this file
 * does not import the file that imports it. There is exactly one copy of the
 * "a collider over the actor's head does not block" rule and it is not this one.
 */
export function crawlTick(c, dt, ctx, actor, st, spec, rig, dist, clear) {
  const pos = rig.group.position;
  const radius = actor.radius * spec.scale;
  const rideH = (spec.proportions.rideHeight || 0.3) * actor.scale;

  if (c.cool > 0) c.cool -= dt;
  if (c.right > 0) c.right -= dt;
  if (c.pickIn > 0) c.pickIn -= dt;

  c.motion = c.surf !== SURF_FLOOR;
  c.owns = c.motion || c.right > 0;
  c.speed = 0;

  // --- a surface change in progress ----------------------------------------
  if (c.transit > 0) {
    c.transit = Math.max(0, c.transit - dt);
    const u = 1 - c.transit / c.transitS;
    const k = u * u * (3 - 2 * u);
    pos.x = c.fromX + (c.toX - c.fromX) * k;
    pos.y = c.fromY + (c.toY - c.fromY) * k;
    pos.z = c.fromZ + (c.toZ - c.fromZ) * k;
    st.feetY = pos.y;
    // The body sweeps around the lip over the same curve the position does, so
    // the turn cannot finish early or late relative to the move.
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.copy(c.fromQ).slerp(_q, k);
    c.speed = spec.speed * WALL_MUL * 0.6;
    return true;
  }

  switch (c.surf) {
    case SURF_WALL: crawlWall(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH); break;
    case SURF_ROOF: crawlRoof(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH, clear); break;
    case SURF_LEAP: crawlLeap(c, dt, ctx, actor, st, rig, radius, clear); break;
    default: crawlFloor(c, dt, ctx, actor, st, spec, rig, dist, radius); break;
  }

  if (c.owns) {
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.slerp(_q, Math.min(1, ORIENT_RATE * dt));
    if (c.surf === SURF_FLOOR && c.right <= 0) {
      // Hand the rotation back CLEAN. mummy.js's facing only writes rotation.y,
      // so any residual tilt left on the quaternion would be permanent.
      const yaw = rig.group.rotation.y;
      rig.group.rotation.set(0, yaw, 0);
      c.owns = false;
    }
  }

  return c.motion;
}

/** The body's up-axis and heading for whatever surface it is on or heading to. */
function surfaceAim(c, ctx, pos, q) {
  const px = ctx.playerPos.x, pz = ctx.playerPos.z;

  if (c.surf === SURF_LEAP) {
    /**
     * NOSE ALONG THE ARC, and this is the one pose in the file that is not
     * derived from a surface normal because there is no surface.
     *
     * Built the same way a camera basis is: forward is the velocity, right is
     * world-up crossed into it, and the body's up is what closes the set. That
     * gives a beetle whose head is pointed exactly where it is going, pitching
     * from nose-up on the rise to nose-down on the dive, with no roll - the
     * pitch IS the read on how far through its arc it is, and a player who has
     * seen the nose come over knows the thing is coming down now.
     *
     * The fallback is the floor pose, taken only if a leap were ever solved with
     * a zero velocity, which the launch window makes impossible.
     */
    const l = Math.hypot(c.lvx, c.lvy, c.lvz);
    if (l > 1e-4) {
      const fx = c.lvx / l, fy = c.lvy / l, fz = c.lvz / l;
      // right = worldUp x forward
      let rx = -fz, ry = 0, rz = fx;
      const rl = Math.hypot(rx, ry, rz);
      if (rl > 1e-4) {
        rx /= rl; rz /= rl;
        // up = forward x right, which is orthonormal to both by construction.
        const ux = fy * rz - fz * ry;
        const uy = fz * rx - fx * rz;
        const uz = fx * ry - fy * rx;
        return aim(q, ux, uy, uz, fx, fy, fz);
      }
    }
    return aim(q, 0, 1, 0, px - pos.x, 0, pz - pos.z);
  }

  if (c.surf === SURF_WALL) {
    // Head first up the wall, leaning the way it is drifting.
    return aim(q, c.nx, 0, c.nz, c.hx, c.hy, c.hz);
  }
  if (c.surf === SURF_ROOF) {
    return aim(q, 0, -1, 0, px - pos.x, 0, pz - pos.z);
  }
  return aim(q, 0, 1, 0, px - pos.x, 0, pz - pos.z);
}

/** On the floor: decide whether to go looking for a wall, and press onto it. */
function crawlFloor(c, dt, ctx, actor, st, spec, rig, dist, radius) {
  const pos = rig.group.position;

  if (st.grounded) c.falling = false;

  // No walls at all is the courtyard and the quarry, where `ctx.walls` is not
  // set. A gold scarab out there is exactly the enemy it was before this file.
  if (!ctx.walls || !ctx.walls.length || actor.dying
      || c.cool > 0 || dist < MOUNT_MIN_M || !st.grounded) {
    c.wall = null;
    c.press = 0;
    return;
  }

  if (!c.wall) {
    if (c.pickIn > 0) return;
    c.pickIn = PICK_S;
    if (!pickWall(c, ctx, pos, st.feetY, radius, ctx.playerPos.x, ctx.playerPos.z)) return;
  }

  c.approach += dt;
  if (c.approach > APPROACH_MAX_S) {
    // The wall it chose is not reachable from where it is standing. Drop it and
    // go back to being a floor scarab for a full cooldown, because the search is
    // deterministic and a second look from the same tile picks the same box.
    // See FAIL_GIVEUP for the run this line was written against.
    c.wall = null;
    c.press = 0;
    c.fails++;
    c.cool = c.fails >= FAIL_GIVEUP ? COOL_S * 4 : COOL_S;
    return;
  }

  const dx = c.tgtX - pos.x, dz = c.tgtZ - pos.z;
  if (dx * dx + dz * dz <= GRAB_D * GRAB_D) {
    c.press += dt;
    // Pressing into stone is what the wedge detector is built to catch. Held at
    // zero for the quarter second the mount takes, so the two never race.
    st.wedge = 0;
  } else {
    c.press = Math.max(0, c.press - dt * 2);
  }

  if (c.press < GRAB_S) return;

  const lat = Math.min(c.hi, Math.max(c.lo, c.lx ? pos.x : pos.z));
  const tx = c.lx ? lat : c.faceC;
  const tz = c.lx ? c.faceC : lat;
  // It got onto stone, so the run of failures that may have preceded this one
  // says nothing about where it is standing now.
  c.fails = 0;
  c.hx = 0; c.hy = 1; c.hz = 0;
  beginTransit(c, rig, MOUNT_S, SURF_WALL, tx, st.feetY + MOUNT_H, tz);
}

/**
 * Is a dive available from here, right now.
 *
 * Three questions, and every one of them is a way the move could stop being
 * readable rather than a way it could stop being possible:
 *
 *   TOO CLOSE. Inside LEAP_MIN_R the arc is nearly vertical, which is the
 *   ceiling drop wearing a wall's clothes - and DROP_R already owns that case
 *   two metres in.
 *
 *   TOO FAR. Past LEAP_MAX_R the fixed flight time turns into a horizontal
 *   speed the player cannot step out of.
 *
 *   NOT ACTUALLY ABOVE THEM. `ty` is the floor under the PLAYER. On the Great
 *   Gallery's upper ledge a crawler four metres up a wall whose base is at zero
 *   is level with a player standing at six, and a "dive" that has to climb to
 *   reach its target is not a dive. This is also the guard that stops the solve
 *   producing an absurd launch velocity, because dy going positive is exactly
 *   what makes vy run away.
 */
function leapArmed(ctx, pos, dist, ty) {
  if (dist < LEAP_MIN_R || dist > LEAP_MAX_R) return false;
  return pos.y - ty >= LEAP_MIN_H;
}

/**
 * In the air.
 *
 * NOTHING STEERS HERE, and the absence is the design: there is no reference to
 * the player's current position anywhere in this function. The arc was solved at
 * launch and this integrates it.
 *
 * `clear` is mummy.js's pointClear, the same probe the ceiling crawl uses. A
 * leap that would put the body inside stone - a pillar crossed mid-flight, a
 * lintel, the wall it just left if the player was standing tight against it -
 * lands on the spot instead of tunnelling, and lands carrying its vertical
 * velocity so the last few centimetres run under mummy.js's gravity at the rate
 * it was already falling.
 */
function crawlLeap(c, dt, ctx, actor, st, rig, radius, clear) {
  const pos = rig.group.position;
  c.air += dt;
  c.speed = 0;

  if (actor.dying) { land(c, st, rig); return; }

  c.lvy -= LEAP_G * dt;
  const nx = pos.x + c.lvx * dt;
  const ny = pos.y + c.lvy * dt;
  const nz = pos.z + c.lvz * dt;

  const floor = ctx.heightAt ? ctx.heightAt(nx, nz, ny) : 0;

  // Down through the floor is the ordinary end of a leap and it is not a
  // collision: the arc was solved to arrive here.
  if (ny <= floor) {
    pos.x = nx; pos.z = nz;
    pos.y = floor;
    land(c, st, rig);
    return;
  }

  // Into stone, or out of time. LEAP_MAX_S is the same argument WALL_MAX_S and
  // ROOF_MAX_S make: a body that cannot finish what it started comes down and
  // fights, because a round that does not end is worse than a bad decision.
  if (!clear(nx, nz, radius, ny, ctx) || c.air > LEAP_MAX_S) {
    land(c, st, rig);
    return;
  }

  pos.x = nx; pos.y = ny; pos.z = nz;
  st.feetY = ny;
}

/** On a wall: climb, drift toward the player's lateral position, or come down. */
function crawlWall(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH) {
  const pos = rig.group.position;
  c.hold += dt;

  // Coming down on top of them is the whole trip, and a player who has walked
  // under the wall is already close enough to take it.
  if (dist < DROP_R || c.hold > WALL_MAX_S || actor.dying) {
    detach(c, st, rig, radius, rideH);
    return;
  }

  /**
   * --- the coil ------------------------------------------------------------
   *
   * Nothing moves. That is the whole point of the state, and it is checked
   * before the climb rather than folded into it so there is no frame in which
   * the body is both announcing and gaining ground.
   *
   * IT CAN STILL BE CALLED OFF. A player who walks out of the window during the
   * coil gets the crawler back on the climb rather than a leap thrown at where
   * they used to be, which would be the tracking this move is written to avoid
   * wearing a different hat. The reverse - a player who walks INTO the window -
   * does not shorten the tell, because the timer keeps its own count.
   */
  if (c.coil > 0) {
    const coilY = ctx.heightAt ? ctx.heightAt(ctx.playerPos.x, ctx.playerPos.z, pos.y) : 0;
    if (!leapArmed(ctx, pos, dist, coilY)) {
      c.coil = 0;
    } else {
      c.coil -= dt;
      c.speed = 0;
      // Turn off the climb and look at them. The heading is projected into the
      // face plane by aim(), so this is the largest turn the body can make
      // while still holding the stone, and it is the visible half of the tell.
      const dx = ctx.playerPos.x - pos.x;
      const dz = ctx.playerPos.z - pos.z;
      c.hx = dx; c.hy = 0; c.hz = dz;
      if (c.coil <= 0) launch(c, st, ctx, rig, radius);
      return;
    }
  }

  const top = c.ceilY - LIP;

  /**
   * WHERE THIS CLIMB IS GOING, and it is the one line that turns a route into
   * a plan.
   *
   * `ty` is the floor UNDER THE PLAYER, not the floor at the base of this wall.
   * They are the same number in every flat room, and they are not the same
   * number on the Great Gallery's upper ledge - where the difference decides
   * both whether a dive is even downhill and how much of the 4.2 m cap has
   * already been spent by the geometry.
   */
  const ty = ctx.heightAt ? ctx.heightAt(ctx.playerPos.x, ctx.playerPos.z, pos.y) : 0;
  const armed = leapArmed(ctx, pos, dist, ty);
  const leapY = Math.min(top, ty + LEAP_H);
  // A crawler with a dive available stops at the launch height. One without
  // keeps going to the lip and takes the ceiling, exactly as it always has.
  const climbTo = armed ? leapY : top;

  const lat = c.lx ? pos.x : pos.z;
  const want = c.lx ? ctx.playerPos.x : ctx.playerPos.z;

  // Climb is the priority and the sideways drift is a correction on it, which
  // is what stops a crawler that starts thirty metres along a gallery wall from
  // running the length of it at ankle height in full view.
  const vert = pos.y < climbTo ? 1 : 0;
  const side = Math.max(-0.9, Math.min(0.9, (want - lat) / 3));
  const l = Math.hypot(vert, side) || 1;
  const step = spec.speed * WALL_MUL * dt;

  pos.y = Math.min(climbTo, pos.y + (vert / l) * step);
  const moved = Math.min(c.hi, Math.max(c.lo, lat + (side / l) * step));
  if (c.lx) pos.x = moved; else pos.z = moved;
  // Pinned to the face plane. Nothing else may write this coordinate.
  if (c.lx) pos.z = c.faceC; else pos.x = c.faceC;

  st.feetY = pos.y;
  c.speed = spec.speed * WALL_MUL;
  // Guarded because a body that has stopped climbing and has no lateral error
  // left would hand aim() a zero heading, and a zero heading is the one input
  // that makes an orthonormal basis undefined.
  if (vert !== 0 || Math.abs(side) > 1e-4) {
    c.hx = c.lx ? (side / l) : 0;
    c.hy = vert / l;
    c.hz = c.lx ? 0 : (side / l);
  }

  /**
   * HIGH ENOUGH, AND THEY ARE STILL THERE. Open the tell.
   *
   * Checked against `leapY` rather than against LEAP_MIN_H so a crawler that
   * reaches the launch height on a wall too short to give it the full 4.2 m
   * still commits: `leapY` is already clamped to the lip, and `leapArmed` has
   * separately refused anything under LEAP_MIN_H above the player's floor. The
   * two together are what let a 5 m room and a 16 m room produce the same move.
   */
  if (armed && pos.y >= leapY - 1e-3) {
    c.coil = COIL_S;
    c.speed = 0;
    return;
  }

  if (pos.y < top - 1e-3) return;

  // Over the lip. The roof point stands clear of the stone by a body radius so
  // the ceiling crawl does not start inside the wall it just climbed.
  const tx = pos.x + c.nx * (radius + 0.08);
  const tz = pos.z + c.nz * (radius + 0.08);
  beginTransit(c, rig, LIP_S, SURF_ROOF, tx, c.ceilY, tz);
}

/** On the ceiling: cross to a point over the player, then let go. */
function crawlRoof(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH, clear) {
  const pos = rig.group.position;
  c.hold += dt;

  if (actor.dying || c.hold > ROOF_MAX_S) {
    detach(c, st, rig, radius, rideH);
    return;
  }

  if (dist < DROP_R) {
    // The tell. It stops dead over their head before it lets go, which is the
    // only warning a player standing under it is ever going to get.
    c.poise += dt;
    c.speed = 0;
    if (c.poise >= POISE_S) detach(c, st, rig, radius, rideH);
    return;
  }
  c.poise = 0;

  const dx = ctx.playerPos.x - pos.x;
  const dz = ctx.playerPos.z - pos.z;
  const l = Math.hypot(dx, dz) || 1;
  const step = spec.speed * ROOF_MUL * dt;
  const hx = dx / l, hz = dz / l;

  // Probed at the ceiling rather than resolved out of it. A body under a roof
  // has no push-out direction that means anything - the only free axis is down,
  // and taking it is letting go - so a blocked step slides along one axis and a
  // doubly blocked step just stops.
  const probeY = c.ceilY - CEIL_PROBE;
  const nx = pos.x + hx * step;
  const nz = pos.z + hz * step;

  if (clear(nx, nz, radius, probeY, ctx)) {
    pos.x = nx; pos.z = nz;
    c.speed = spec.speed * ROOF_MUL;
  } else if (clear(nx, pos.z, radius, probeY, ctx)) {
    pos.x = nx;
    c.speed = spec.speed * ROOF_MUL * 0.7;
  } else if (clear(pos.x, nz, radius, probeY, ctx)) {
    pos.z = nz;
    c.speed = spec.speed * ROOF_MUL * 0.7;
  } else {
    // Boxed in against a lintel it cannot cross. Nothing up here is worth
    // waiting on, so spend the give-up timer fast rather than sit still.
    c.hold += dt * 3;
    c.speed = 0;
  }

  pos.y = c.ceilY;
  st.feetY = pos.y;
}

/**
 * A crawler killed off the floor falls.
 *
 * updateDeath in mummy.js topples a body where it stands and never integrates
 * gravity, because until this file existed nothing could die anywhere but on
 * the ground. A gilded beetle shot off a ceiling has to come down or the kill
 * does not read as a kill, so the corpse keeps falling and keeps righting until
 * it lands, and then the ordinary lie-and-crumble takes over.
 */
export function crawlDeathFall(c, dt, ctx, st, rig) {
  if (!c.falling) return;
  const pos = rig.group.position;

  st.vy -= 24 * dt;
  st.feetY += st.vy * dt;

  const floor = ctx.heightAt ? ctx.heightAt(pos.x, pos.z, st.feetY) : 0;
  if (st.feetY <= floor) {
    st.feetY = floor;
    st.vy = 0;
    c.falling = false;
    c.owns = false;
    const yaw = rig.group.rotation.y;
    rig.group.rotation.set(0, yaw, 0);
  } else {
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.slerp(_q, Math.min(1, ORIENT_RATE * dt));
  }

  pos.y = st.feetY;
}
