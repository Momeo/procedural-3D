// 出处：sands-of-the-restless（MIT，作者 Eddie Belaval）src/enemies/wraps.js 原样拷贝，仅加本行注释。
// 上游：https://github.com/eddiebelaval/sands-of-the-restless —— 许可原文见 ../LICENSE-sands.txt
/**
 * The linen: generated albedo, relief and roughness for a bandaged corpse.
 *
 * WHY THE OLD COMMENT WAS WRONG
 *
 * The file this replaces argued that enemy materials should carry no maps at
 * all - "a 1K albedo on a 14 cm forearm would be four texture fetches for a
 * quarter of a texel" - and that shading plus silhouette would carry it. A
 * blind side-by-side then described the result as "flat untextured tan",
 * "Roblox mannequins", and put replacing them at the top of a five-item fix
 * list. The argument was about TEXEL DENSITY and the defect is about SURFACE:
 * an unmapped MeshStandardMaterial has exactly one value per lighting term
 * across a whole limb, so every member reads as painted plastic no matter how
 * good the silhouette is. Four fetches is the correct price.
 *
 * WHAT IS ACTUALLY DRAWN, AND WHY EACH PART IS THERE
 *
 *   - BANDS. The read that matters. Wrapping is a stack of overlapping strips,
 *     and what says "bandaged" rather than "painted beige" is the repeating
 *     line where one strip laps the next: a dark seam with a bright lip above
 *     it. Sized at about 6 cm, which is a real bandage and, at the seven to
 *     twenty metres an enemy is fought at, three to seven pixels - wide enough
 *     to survive the mip chain rather than dissolving into grey.
 *   - PER-BAND TONE. Every strip gets its own value. Linen that has been buried
 *     for three thousand years does not discolour evenly, and a tone step
 *     between neighbouring strips is what makes the bands read as separate
 *     pieces of cloth instead of as a ruled pattern.
 *   - WEAVE. Fine warp and weft under everything. Sub-pixel past a few metres
 *     and that is fine: its whole job is to stop the flats being mathematically
 *     uniform up close and to give the mip chain something to average.
 *   - GRIME. Broad blotches and vertical stains, because the alternative to
 *     dirt is a clean mummy.
 *
 * THE VALUE IS HELD, DELIBERATELY.
 *
 * The palette was measured exhaustively - four candidate repaints scored
 * against identical background pixels - and darkening plus saturation LOST
 * legibility at four of five stances. An albedo map multiplies the material
 * colour, so a map whose mean is under white is a palette repaint smuggled in
 * as a texture. So the canvas is normalised: `WRAP_GAIN` is the map's mean in
 * LINEAR space (not sRGB - the mean of an sRGB image is not the mean of the
 * light it stands for), and the caller divides the palette colour by it. The
 * body then renders at the same average value it was measured at, with all of
 * the variation and none of the drift.
 */

import * as THREE from 'three';

/** Texture tiles per world unit. One tile is 38.5 cm. */
export const WRAP_TILES = 2.6;

const SIZE = 512;

// ---------------------------------------------------------------------------
// deterministic tiling noise
// ---------------------------------------------------------------------------

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise that wraps at `period`, so every map tiles seamlessly. */
function noise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;

  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);

  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(u, v, octaves, basePeriod, seed) {
  let sum = 0, amp = 1, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u * period, v * period, period, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// the maps
// ---------------------------------------------------------------------------

/** Bands per tile. 6.5 over 38.5 cm is a 5.9 cm strip. */
const BANDS = 6.5;
/** How far the wrap spirals across one tile, in bands. Nothing is level. */
const SPIRAL = 0.42;

/**
 * Which strip a texel belongs to, and where it sits within that strip.
 *
 * Returned as a pair so the albedo and the height field agree exactly on where
 * a seam is; deriving them independently produces relief that sits a texel off
 * the line it is supposed to be lifting, which reads as a printing error.
 */
function bandAt(u, v) {
  // The wobble is what stops the strips being ruled lines. Two frequencies so
  // the wobble itself has no obvious period.
  const wob = Math.sin(u * Math.PI * 2) * 0.055
            + Math.sin(u * Math.PI * 6 + 1.7) * 0.022
            + (fbm(u, v * 0.25, 2, 4, 31) - 0.5) * 0.06;

  const s = (v + u * SPIRAL + wob) * BANDS;
  const index = Math.floor(s);
  return { index, frac: s - index };
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Albedo and the height field it will be relieved from, in one pass.
 *
 * Both are written together because every feature that changes the colour also
 * changes the surface: a seam is darker AND lower, a lip is brighter AND
 * higher. Generating them from one evaluation is both cheaper and the only way
 * they can be guaranteed to agree.
 */
function drawLinen() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      const { index, frac } = bandAt(u, v);

      // --- per-strip tone -------------------------------------------------
      // One hash per strip, so the whole strip moves together. This is the
      // single loudest "these are separate pieces of cloth" cue.
      const tone = (hash2(index * 7 + 13, index * 3 + 5, 91) - 0.5) * 26;

      // --- the lap ----------------------------------------------------------
      // frac 0 is the seam. A dark line at the seam, a bright lip just above
      // it where the upper strip stands proud, then a long shallow fall.
      let lap = 0, lift = 0;
      if (frac < 0.10) {
        const k = frac / 0.10;
        lap = -34 * (1 - k);                 // the shadowed crease
        lift = -0.55 * (1 - k);
      } else if (frac < 0.26) {
        const k = (frac - 0.10) / 0.16;
        lap = 16 * (1 - k) * (1 - k);        // the lit lip of the overlap
        lift = 0.42 * (1 - k * 0.7);
      } else {
        const k = (frac - 0.26) / 0.74;
        lap = -5 * k;                        // the cloth falling away
        lift = 0.10 - k * 0.28;
      }

      // --- weave ------------------------------------------------------------
      // Warp and weft on a four texel period, cross-modulated so it reads as
      // interlocking threads rather than as a grid.
      const warp = Math.sin(x * Math.PI * 0.5);
      const weft = Math.sin(y * Math.PI * 0.5 + 0.9);
      const weave = (warp * 0.55 + weft * 0.55 + warp * weft * 0.5) * 6.0;
      const fuzz = (hash2(x, y, 7) - 0.5) * 7.0;

      // --- grime ------------------------------------------------------------
      const blot = fbm(u, v, 4, 3, 5);
      const stain = fbm(u * 0.7, v * 2.6, 3, 5, 47);     // stretched: runs down
      const dirt = -46 * Math.pow(Math.max(0, blot - 0.34), 1.35)
                   - 26 * Math.pow(Math.max(0, stain - 0.52), 1.1);

      // --- a few strips have unravelled --------------------------------------
      // A wide dark gap every so often, where the linen has gone and what is
      // under it has not.
      const gone = hash2(index * 11 + 3, 17, 313) > 0.90 ? -30 : 0;

      const value = 206 + tone + lap + weave + fuzz + dirt + gone;
      const c = Math.max(0, Math.min(255, value));

      // Warm the dirt rather than greying it: desert grime is ochre.
      const warm = (dirt + gone) * 0.22;
      const p = i * 4;
      a[p]     = Math.max(0, Math.min(255, c - warm * 0.35));
      a[p + 1] = c;
      a[p + 2] = Math.max(0, Math.min(255, c + warm * 0.75));
      a[p + 3] = 255;

      height[i] = lift + weave * 0.018 + (blot - 0.5) * 0.16;
      // Grime is matte, a fresh lip catches a little sheen.
      rough[i] = 0.90 + Math.max(0, -dirt) * 0.0016 - Math.max(0, lap) * 0.0055;
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough };
}

/**
 * Tangent-space normals from the height field.
 *
 * Sobel, wrapped, so the normal map tiles exactly like the albedo it belongs
 * to. Built from the HEIGHT rather than from the albedo's luminance: a stain is
 * dark and flat, and relieving it would emboss the dirt.
 */
function normalFromHeight(height, strength) {
  const out = makeCanvas(SIZE);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;

  const at = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const i = (y * SIZE + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

function packRough(rough) {
  const out = makeCanvas(SIZE);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < rough.length; i++) {
    const v = Math.max(0, Math.min(1, rough[i])) * 255;
    const p = i * 4;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Mean of the albedo in LINEAR light, which is the number the shader sees. */
function linearMean(canvas) {
  const src = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, SIZE, SIZE).data;
  let sum = 0;
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  for (let p = 0; p < src.length; p += 4) {
    sum += toLinear(src[p] / 255) * 0.2126
         + toLinear(src[p + 1] / 255) * 0.7152
         + toLinear(src[p + 2] / 255) * 0.0722;
  }
  return sum / (SIZE * SIZE);
}

function toTexture(canvas, colorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// the shared set
// ---------------------------------------------------------------------------

let CACHE = null;

/**
 * Three maps, built once and shared by every actor in the game.
 *
 * Materials stay per instance - the hit flash writes emissive and a shared
 * material would flash the whole horde - but a map has no per-instance state,
 * so the pool of forty costs one upload of each. That is also what keeps the
 * suite's "no texture leak over four hundred spawns" check at zero.
 *
 * Returns `{ map, normalMap, roughnessMap, gain }`. `gain` is the albedo's
 * linear mean; divide a measured palette colour by it to keep the rendered
 * value where it was measured.
 */
export function linenMaps() {
  if (CACHE) return CACHE;

  const { albedo, height, rough } = drawLinen();

  CACHE = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.9), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };

  return CACHE;
}

/**
 * Divide a palette colour by the map's mean, so the mapped body renders at the
 * same average value the unmapped one was measured at.
 *
 * Done in linear space, then clamped: a very bright palette entry against a
 * dark map could ask for a colour above 1.0, which a MeshStandardMaterial will
 * silently clip rather than reporting.
 */
export function compensate(hex, gain) {
  const c = new THREE.Color(hex);
  const k = 1 / Math.max(0.35, gain);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return c;
}
