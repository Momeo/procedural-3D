// 出处：sands-of-the-restless（MIT，作者 Eddie Belaval）src/enemies/anatomy.js 原样拷贝，仅加本行注释。
// 上游：https://github.com/eddiebelaval/sands-of-the-restless —— 许可原文见 ../LICENSE-sands.txt
/**
 * Bodies, not boxes: the geometry primitives a wrapped corpse is built from.
 *
 * WHY THIS LIVES HERE AND NOT IN world/geometry.js
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The first is that a character needs a shape the world does not: a TAPERED
 * member. Architecture is made of prisms - a course, a lintel, a drum - and a
 * prism is the right answer for all of them. A body is made of nothing else.
 * A thigh is thick at the hip and thin at the knee, a forearm narrows to a
 * wrist, and a torso is a wedge that is wide at the shoulders and narrow at the
 * waist. That single property is most of what separates a humanoid silhouette
 * from a mannequin's, and it is unavailable from a box.
 *
 * The second is DRAW CALLS. Twenty-four actors is the live cap, and at nineteen
 * meshes each that is 456 draw calls before the world has drawn a single stone.
 * Triangles are close to free here and draw calls are not, so this module is
 * built around an accumulator rather than a factory: you push as many members as
 * you like into one `parts()` and get ONE BufferGeometry out. Everything that
 * shares a rig group and a material collapses into a single mesh, which is how
 * this rebuild adds hands, feet, a neck, deltoids and tapered limbs and comes
 * out with FEWER draw calls than the box-man it replaces.
 *
 * The bevel is reimplemented here rather than imported. It is thirty lines, and
 * owning it means a change to the world's chamfer rule - which is tuned for a
 * forty-metre pyramid step - can never silently reshape a fourteen-centimetre
 * forearm.
 */

import * as THREE from 'three';

/**
 * How wide a bevel should be on a member of a given thickness.
 *
 * The world's rule scales with the LONGEST dimension and floors at 9 cm,
 * because it is sizing an arris on a stone course read from ninety metres. On a
 * limb that floor is the whole member. Here the bevel scales with the THINNEST
 * dimension and caps at 3.5 cm, which at the seven-to-twenty metres an enemy is
 * actually read from is two to four pixels: enough to hold a highlight, not
 * enough to turn an arm into a lozenge.
 */
export function limbChamfer(w, h, d) {
  const thin = Math.min(w, h, d);
  return Math.min(Math.max(thin * 0.26, 0.010), 0.035, thin * 0.32);
}

/**
 * An accumulator that welds many members into one geometry.
 *
 * Every member is generated in its own local frame, tapered, rotated,
 * translated, and appended to shared arrays. Normals are recomputed per
 * TRIANGLE from the final vertex positions, which keeps the flat shading that
 * makes a bevel read as a cut edge, and keeps it correct through the rotation.
 *
 * UVs are projected from the POST-transform position onto the dominant axis of
 * the post-transform normal. That is what makes a wrap line continue across a
 * shin and its foot instead of restarting at every member, and it is why the
 * bandage rings on a vertical limb come out horizontal without a UV pass: on
 * any side face the dominant axis is horizontal, so the texture's V runs with
 * world height.
 */
export function parts(tilesPerUnit = 2.6) {
  const pos = [];
  const nor = [];
  const uv = [];

  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();

  function emit(tri3, uvOffU, uvOffV) {
    const [a, b, c] = tri3;

    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;           // a taper can collapse a bevel sliver
    nx /= len; ny /= len; nz /= len;

    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let uAxis, vAxis;
    if (ax >= ay && ax >= az)      { uAxis = 2; vAxis = 1; }
    else if (ay >= ax && ay >= az) { uAxis = 0; vAxis = 2; }
    else                           { uAxis = 0; vAxis = 1; }

    for (const p of tri3) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
      uv.push(p[uAxis] * tilesPerUnit + uvOffU, p[vAxis] * tilesPerUnit + uvOffV);
    }
  }

  const api = {
    /**
     * One member.
     *
     * @param {number} w  width at the widest cross-section
     * @param {number} h  height along the member's own +Y
     * @param {number} d  depth at the widest cross-section
     * @param {object} o
     *   x,y,z      translation, applied last
     *   rx,ry,rz   rotation, XYZ order, applied before the translation
     *   top        cross-section scale at +h/2, default 1
     *   bottom     cross-section scale at -h/2, default 1
     *   depthTop   an independent depth scale at +h/2, so a chest can taper
     *              in width and stay deep
     *   depthBottom same at -h/2
     *   chamfer    override; otherwise limbChamfer()
     *   u, v       UV offset in tiles, so two members cut from the same shape
     *              do not wear the identical patch of linen
     */
    box(w, h, d, o = {}) {
      const c = o.chamfer ?? limbChamfer(w, h, d);
      const cc = Math.min(c, Math.min(w, h, d) * 0.32);

      const x = w / 2, y = h / 2, z = d / 2;
      const xi = x - cc, yi = y - cc, zi = z - cc;

      const top = o.top ?? 1, bottom = o.bottom ?? 1;
      const dTop = o.depthTop ?? top, dBottom = o.depthBottom ?? bottom;

      const hasRot = o.rx || o.ry || o.rz;
      if (hasRot) {
        _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ');
        _m.makeRotationFromEuler(_e);
      }

      const tx = o.x || 0, ty = o.y || 0, tz = o.z || 0;
      const u0 = o.u || 0, v0 = o.v || 0;

      /** local -> tapered -> rotated -> translated */
      const P = (px, py, pz) => {
        const t = h > 1e-9 ? (py + y) / h : 0.5;         // 0 at the base, 1 at the top
        const sw = bottom + (top - bottom) * t;
        const sd = dBottom + (dTop - dBottom) * t;
        _v.set(px * sw, py, pz * sd);
        if (hasRot) _v.applyMatrix4(_m);
        return [_v.x + tx, _v.y + ty, _v.z + tz];
      };

      const quad = (a, b, e, f) => {
        emit([P(...a), P(...b), P(...e)], u0, v0);
        emit([P(...a), P(...e), P(...f)], u0, v0);
      };
      const tri = (a, b, e) => emit([P(...a), P(...b), P(...e)], u0, v0);

      // --- the six inset flats, wound counter-clockwise seen from outside ----
      quad([x, -yi, zi], [x, -yi, -zi], [x, yi, -zi], [x, yi, zi]);
      quad([-x, -yi, -zi], [-x, -yi, zi], [-x, yi, zi], [-x, yi, -zi]);
      quad([-xi, y, zi], [xi, y, zi], [xi, y, -zi], [-xi, y, -zi]);
      quad([-xi, -y, -zi], [xi, -y, -zi], [xi, -y, zi], [-xi, -y, zi]);
      quad([-xi, -yi, z], [xi, -yi, z], [xi, yi, z], [-xi, yi, z]);
      quad([xi, -yi, -z], [-xi, -yi, -z], [-xi, yi, -z], [xi, yi, -z]);

      // --- twelve edge bevels -----------------------------------------------
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
        const flip = sx * sz < 0;
        const a = [sx * x, -yi, sz * zi];
        const b = [sx * xi, -yi, sz * z];
        const e = [sx * xi, yi, sz * z];
        const f = [sx * x, yi, sz * zi];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }
      for (const sy of [1, -1]) for (const sz of [1, -1]) {
        const flip = sy * sz < 0;
        const a = [-xi, sy * y, sz * zi];
        const b = [xi, sy * y, sz * zi];
        const e = [xi, sy * yi, sz * z];
        const f = [-xi, sy * yi, sz * z];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }
      for (const sy of [1, -1]) for (const sx of [1, -1]) {
        const flip = sy * sx > 0;
        const a = [sx * xi, sy * y, -zi];
        const b = [sx * xi, sy * y, zi];
        const e = [sx * x, sy * yi, zi];
        const f = [sx * x, sy * yi, -zi];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }

      // --- eight corner triangles -------------------------------------------
      for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
        const a = [sx * x, sy * yi, sz * zi];
        const b = [sx * xi, sy * y, sz * zi];
        const e = [sx * xi, sy * yi, sz * z];
        if (sx * sy * sz > 0) tri(a, b, e); else tri(a, e, b);
      }

      return api;
    },

    /** How many members have been pushed, in triangles. */
    get triangles() { return pos.length / 9; },
    get empty() { return pos.length === 0; },

    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      return g;
    },
  };

  return api;
}

/**
 * A torn wrap.
 *
 * WHAT THE STRIP THIS REPLACES GOT WRONG, MEASURED
 *
 * The wraps were modelled, believed, and never rendered. Photographed in
 * isolation at three angles they contributed ONE dark sliver at the hip and
 * nothing at all from the front or the side, and the figure read as an
 * articulated wooden mannequin. Four blind judges in four rounds named the
 * actors as the build's ceiling; the last said no lighting pass would fix it,
 * it was a material and silhouette problem. Three separate things were wrong
 * and every one of them alone was enough:
 *
 *   TOO NARROW. Authored at 12 to 13 cm and then multiplied by a taper that
 *   took the hem to as little as 36 per cent of that. At the fifteen metres an
 *   enemy is fought at, one metre is about 47 px in a 1000 px frame, so a 5 cm
 *   hem is TWO PIXELS. Under the mip chain that is not thin cloth, it is
 *   nothing.
 *
 *   INSIDE THE OUTLINE. Every strip hung plumb from a pivot inboard of the body
 *   it was attached to, so it could only ever draw over the torso and the
 *   thighs. A silhouette is the thing that identifies a figure at distance, and
 *   decoration painted inside one does not change it.
 *
 *   NO VALUE BREAK ALONG ITS LENGTH. One flat colour on a rag that hangs
 *   sometimes against sunlit limestone and sometimes against an unlit chamber
 *   will match one of them. What survives both is a strip carrying more than one
 *   value along its own length, so whatever is behind it, some part of the cloth
 *   is separated from it.
 *
 * SO: the profile widens rather than tapers and its two edges are cut
 * independently, the centre line WALKS SIDEWAYS as it falls so the hem finishes
 * clear of the vertical band the root occupies, a fold runs down the strip so it
 * has two faces to the sun instead of one, the out-of-plane curl is scaled off
 * the strip's LENGTH rather than its width, and three value bands are baked into
 * a colour attribute the tatter material reads.
 *
 * PER ROW, NOT PER VERTEX. Width, drift and curl are properties of a height on
 * a ribbon. The strip this replaces drew all three per vertex, which is what
 * turned a hanging wrap into torn confetti that averaged back out to a straight
 * edge. Only the hem tear stays per vertex, because each strand of a tear does
 * have its own length.
 *
 * `cut` seeds every decision, so a shape is stable across a run and shareable
 * between every instance that asks for the same one - which is what keeps the
 * pool at one BufferGeometry per (w, h, cut) no matter how deep it is.
 */
export function tornStrip(w, h, cut = 0, segments = 7, tilesPerUnit = 2.6) {
  const COLS = 3;
  const g = new THREE.PlaneGeometry(w, h, COLS, segments);

  let seed = (cut + 1) * 9301 + 49297;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const rows = segments + 1;
  const stride = COLS + 1;
  const widthL = new Float32Array(rows);
  const widthR = new Float32Array(rows);
  const driftX = new Float32Array(rows);
  const driftZ = new Float32Array(rows);
  const fold = new Float32Array(rows);
  const value = new Float32Array(rows);

  // The sideways walk of the centre line, integrated so it is smooth. `lean`
  // biases the whole walk one way, which is what makes the hem finish OUTSIDE
  // the band the root hangs in instead of wandering back to plumb. This is the
  // entire mechanism by which a rag breaks an outline.
  const lean = (rnd() - 0.5) * 2;
  let dx = 0, dz = 0;
  for (let r = 0; r < rows; r++) {
    const t = r / segments;
    dx += (lean * 0.62 + (rnd() - 0.5) * 0.9) * h * 0.085;
    dz += (rnd() - 0.5) * h * 0.13;
    driftX[r] = dx;
    driftZ[r] = dz;
    // Narrow where the wrap is still bound, widest around two thirds down.
    // Loose cloth is WIDER than its binding; a triangle is a pennant.
    //
    // The two EDGES are independent, and that is what makes the outline read as
    // torn. A single width scales both edges about the centre line, so however
    // ragged the profile is the strip stays a symmetrical leaf - and a
    // symmetrical leaf is a shape a machine cut.
    const base = 0.74 + 0.58 * Math.sin(Math.PI * t * 0.86);
    widthL[r] = base * (0.70 + rnd() * 0.62);
    widthR[r] = base * (0.70 + rnd() * 0.62);
    // THE FOLD ACROSS THE WIDTH, and it is what separates cloth from cardboard.
    // The first pass at this widened the strips and left them planar, and three
    // angles of the result photographed as a cape cut from board: a flat plane
    // takes exactly one value from the sun no matter how ragged its outline is.
    // A fold running down the strip gives it two faces at different angles to
    // the light, which is the whole reason a real rag reads as fabric.
    fold[r] = (0.55 + rnd() * 0.9) * (r % 2 ? -1 : 1);
    // Per ROW, not per vertex. Cloth discolours in bands along its length -
    // per-vertex noise here just averages back to the mean one mip level up.
    value[r] = (rnd() - 0.5) * 0.20;
  }

  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const r = Math.floor(i / stride);
    const c = i % stride;
    const t = r / segments;
    const x = pos.getX(i), y = pos.getY(i);

    pos.setX(i, x * (x < 0 ? widthL[r] : widthR[r]) + driftX[r]);
    // The fold is a V across the width, deepest in the middle and pinned at the
    // torn edges, scaled off the strip's own width so a narrow rag creases
    // proportionally rather than absolutely.
    pos.setZ(i, driftZ[r] + Math.sin((c / COLS) * Math.PI) * fold[r] * w * 0.30);

    // Ragged, and only ever SHORTER than authored: lengthening a row can carry
    // it past the row below and fold the strip inside out.
    if (r === segments) pos.setY(i, y - rnd() * h * 0.30);
    else if (r === segments - 1) pos.setY(i, y - rnd() * h * 0.05);

    // THE VALUE, BAKED IN: a multiplier on the material colour, so one strip of
    // cloth carries more than one value along its length.
    //
    // THREE BANDS, ALL BELOW THE BODY, and every number here was set by a
    // measurement that contradicted the previous one.
    //
    // Round one, a monotonic t^0.78 ramp: past the body's own value a third of
    // the way down, so the strip photographed as a uniformly pale cloak. A value
    // SHIFT rather than a value RANGE.
    //
    // Round two, t^1.4 topping out at 1.38: the hem became the brightest thing on
    // the actor, brighter than the sunlit skull, and the eye went to the cloth
    // instead of to the figure.
    //
    // Round three, peak 1.06, measured against a flat limestone-value wall: the
    // share of figure pixels landing WITHIN SIX LUMA OF THE WALL went from 3.8
    // per cent to 9.3, and the figure's median luma rose 24 toward the wall's
    // 144. The cloth is a third of the silhouette now, so wherever its value
    // sits is where a third of the actor sits - and a bleached hem sits exactly
    // where limestone and sand do.
    //
    // So no part of the strip is ever BRIGHTER than the limbs it hangs on, and
    // the internal range is kept: 0.26 at the bind, 0.86 where it hangs slack,
    // 0.44 at the torn hem, with a per-row wobble of a tenth on top - so the
    // slack band peaks at 0.96 on a lucky row and no higher.
    // That is also the physical truth the material this replaces was
    // right about and the geometry was wrong about - dragged, buried linen is
    // DIRTIER than the wrapped body, not cleaner. Every background in this game
    // is mid to bright, sunlit limestone through brazier-lit stone, so a dark rag
    // separates from all of them and a pale one separates from none.
    const up = Math.min(1, t / 0.62);
    const dn = Math.max(0, (t - 0.62) / 0.38);
    const k = Math.max(0.08,
      0.26 + 0.60 * (up * up * (3 - 2 * up)) - 0.42 * dn * dn + value[r]);
    // Barely any hue in it, and that is a correction. A 16 per cent blue lift at
    // the hem looked right in a neutral studio and rendered BLUE-GREY in situ:
    // a rag hanging in a wall's shade is lit almost entirely by the cool
    // hemisphere fill, so a cool tint in the albedo compounds with a cool light
    // instead of reading as bleach. Weathering is a VALUE change here, not a hue
    // one. Four per cent is enough to keep the slack band from being an exact
    // multiple of the limb behind it and no more.
    col[i * 3] = k;
    col[i * 3 + 1] = k * (1 + 0.015 * t);
    col[i * 3 + 2] = k * (1 + 0.04 * t);
  }

  // Texel density in the same units as everything else, so a hanging wrap wears
  // the same weave as the limb it came off.
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * tilesPerUnit, uv.getY(i) * h * tilesPerUnit);
  }

  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  g.computeVertexNormals();
  // Built in XY around its centre; the anchor swings from the top, so shift it
  // down once here rather than on every instance.
  g.translate(0, -h / 2, 0);
  g.computeBoundingSphere();
  return g;
}
