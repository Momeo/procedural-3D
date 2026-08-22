// 出处：sands-of-the-restless（MIT，作者 Eddie Belaval）src/enemies/contact.js 原样拷贝，仅加本行注释。
// 上游：https://github.com/eddiebelaval/sands-of-the-restless —— 许可原文见 ../LICENSE-sands.txt
/**
 * The contact shadow: the thing that puts a body ON the sand instead of over
 * it.
 *
 * WHAT THE DEFECT ACTUALLY WAS. This is worth writing down, because two review
 * rounds got it wrong in opposite directions - one claimed the enemies cast no
 * shadow, another measured a cast shadow and declared the complaint false, and
 * both were reading the same correct pixels.
 *
 * The enemies DO cast a real shadow. Every mesh has castShadow set, they sit
 * well inside the sun's 136 m ortho frustum, and an A/B against the identical
 * frame with casting disabled shows the shadow arriving at full strength: the
 * darkest shadowed texel drops 159 luma out of a 150-luma sunlit background,
 * which is total occlusion, not a bias artefact.
 *
 * The shadow is INVISIBLE FOR A GEOMETRIC REASON. The sun sits at 27 degrees of
 * elevation on a bearing of about 32 degrees off the avenue's axis, and the
 * player walks the avenue. So in essentially every combat frame the shadow lies
 * almost directly AWAY from the camera along the ground plane, is foreshortened
 * by the grazing view into a sliver, and what is left of it hides behind the
 * legs that cast it. Measured on the shipped build: at 7 m the whole cast
 * shadow is 3,555 pixels in a smear beside the feet; at 20 m it is 1,540
 * pixels, a hairline about forty pixels long. Under the feet - which is the
 * only place the eye looks for contact - there is nothing at all.
 *
 * Raising the shadow-map resolution cannot fix that. Neither can bias: dropping
 * normalBias to zero was tried and it TRIPLED the changed-pixel count while
 * HALVING the mean darkening, which is acne on the dunes, not shadow. The sun's
 * angle is a world-lighting decision that lives in sky.js and is not this
 * module's to make.
 *
 * So this is the other half: a projected contact patch, directly beneath the
 * actor, visible from every angle the sun's own shadow is not. It is the
 * ambient-occlusion term a body standing on sand should have and does not - the
 * darkening in the crook where two surfaces meet - and it is view independent
 * by construction.
 *
 * ON TRANSPARENCY. The standing rule is that enemy materials must not flip
 * `transparent` mid-run, because that forces a shader program swap on the exact
 * frame the player earns a kill. This material is created transparent, once, at
 * boot, and no code path ever changes that flag or any other pipeline state on
 * it. It is also SHARED by every actor - it carries no per-instance state, so
 * unlike the body materials there is nothing to make it per instance for - so
 * the whole horde costs one material and one program.
 *
 * It takes a FRACTION of the ground's own light rather than painting a colour
 * onto it, so the patch stays the sand's hue in sun and the chamber's hue
 * indoors and cannot become a grey disc on a warm floor. See the material for
 * why that is written as alpha blending toward black rather than as the
 * multiply blend it algebraically is.
 */

import * as THREE from 'three';

const SIZE = 128;

/**
 * How much light the very centre of the patch removes, and how fast it falls
 * off.
 *
 * Both were raised after the first render. At 0.62 over a 0.86 m radius the
 * patch was a wide, gentle darkening that the sand's own ripple shadows swamped
 * - measurable, but not something the eye read as CONTACT. A contact shadow
 * wants a small firm core right under the feet and a fast falloff, because that
 * is what an occluded ambient term actually looks like where two surfaces meet.
 */
const CORE = 0.74;
const FALLOFF = 2.1;

let TEX = null;
let GEO = null;
let MAT = null;

/**
 * A soft round occlusion patch: OPAQUE at the centre, zero at the rim.
 *
 * This is an alpha map, not a colour map, and the difference is the whole
 * reason the blending below works. See the material for why.
 *
 * The noise is not decoration. A mathematically perfect radial gradient reads
 * as an airbrushed sticker the moment two of them overlap, and a horde puts
 * twenty-four of them on one patch of sand.
 */
function patchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;

  const half = SIZE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      let r = Math.hypot(dx, dy);

      // Ragged rim, keyed off the angle so it wobbles rather than dithers.
      const ang = Math.atan2(dy, dx);
      r *= 1 + Math.sin(ang * 5.0) * 0.055 + Math.sin(ang * 11.0 + 2.1) * 0.03;

      const t = Math.min(1, r);
      const occ = Math.pow(Math.max(0, 1 - t * t), FALLOFF);
      const v = Math.max(0, Math.min(1, occ * CORE)) * 255;

      // three reads an alphaMap from the GREEN channel; the other two are
      // written for the sake of anything that inspects the canvas.
      const p = (y * SIZE + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  // Clamped, not repeated: a repeat wrap on a decal tiles the rim's white ring
  // back over the patch at grazing angles.
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * One patch, ready to parent under an actor.
 *
 * @param {number} radius world radius of the patch, before the actor's scale
 */
export function contactShadow(radius) {
  if (!TEX) {
    TEX = patchTexture();
    // A unit quad, scaled per actor. Two triangles for the whole horde.
    GEO = new THREE.PlaneGeometry(2, 2, 1, 1);
    GEO.rotateX(-Math.PI / 2);
    MAT = new THREE.MeshBasicMaterial({
      /**
       * BLACK THROUGH AN ALPHA MAP, WHICH IS A MULTIPLY WRITTEN THE ONLY WAY
       * THIS PIPELINE HONOURS.
       *
       * A shadow is a fraction of the light that would otherwise arrive, so the
       * first two attempts asked for that literally. Both failed, in different
       * ways, and both are worth recording because the second failed SILENTLY.
       *
       *   THREE.MultiplyBlending logs "requires material.premultipliedAlpha =
       *   true" once per draw call. Twenty-four actors is twenty-four console
       *   errors a frame, and every harness in this project treats a console
       *   error as a hard fail.
       *
       *   Spelling the same thing out as CustomBlending with ZeroFactor /
       *   SrcColorFactor logged nothing and DREW nothing. Proved by A/B: with
       *   the identical mesh, position and depth state, an opaque black quad
       *   rendered and a normal-blended one at 0.7 opacity rendered, and the
       *   custom-blend one was a byte-for-byte no-op against the sand.
       *
       * So it is written as ordinary alpha blending toward black, which is
       * algebraically the same operation - dst*(1-a) + 0*a is dst*(1-a), a
       * uniform scale of all three channels. The patch therefore still takes a
       * FRACTION of the ground's own light rather than painting a grey disc:
       * it keeps the sand's hue in sun and the chamber's hue indoors, and it
       * composites correctly over both without retuning, which a fixed-colour
       * decal cannot do.
       */
      color: 0x000000,
      alphaMap: TEX,
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      // It must still be occluded by a pillar standing in front of it.
      depthTest: true,
      // Set once, never changed: a decal lying on a dune fights the dune for
      // the same depth value, and this is cheaper than lifting it far enough
      // off the ground to read as a floating card.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // Fogged like everything else: a contact patch at thirty-five metres
      // should recede into the aerial perspective, not stay a hole in the sand.
      fog: true,
      toneMapped: false,
    });
  }

  const m = new THREE.Mesh(GEO, MAT);
  m.scale.set(radius, 1, radius);
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noHit = true;
  // Removed from raycasting outright rather than filtered afterwards. A flat
  // quad at ankle height sits across the line to a shin, and the hitscan's
  // noHit filter takes the FIRST unfiltered hit - which works, but costs a
  // triangle test per actor per shot for a surface that can never be a target.
  m.raycast = () => {};
  // After the opaque pass, before nothing: it has no depth write, so it cannot
  // affect anything drawn later.
  m.renderOrder = 2;
  m.matrixAutoUpdate = true;
  return m;
}
