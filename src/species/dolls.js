/**
 * 破旧布娃娃谱系（dolls.js）：女童偶 dollette / 男童偶 dollad / 双子抱偶 twinsie /
 * 小猫偶 kitdoll / 小狗偶 pupdoll / 管家人偶 butler / 巨型破损布偶 bigdoll。
 * 气质：被丢弃的旧布偶，creepy-cute；小孩子体型占多数（7 种里 3 种小孩 + 2 种小宠物）。
 * （命名注意：物理布娃娃是 demo/ragdoll.js 的 ragdoll——本谱系是布艺玩偶，
 *  文件叫 dolls.js 防撞名。）
 *
 * 谱系五要素（用户明确要求，盲评逐个自查）：
 *   1. **纽扣眼**：真纽扣读法——浅色有质感扣体（eye 槽，palette.eye=扣色，
 *      lathe 旋出略凸扣缘边圈+中央微凹的四孔区）+ 四孔深点（deep 槽）
 *      + 对比色线迹（四孔交叉 X 或平行两道，线色与扣体拉开明度差：
 *      浅扣配 deep 深色线，深扣配 tatter 米白线）。特写一眼认出是纽扣；
 *      各物种扣色不同（木棕/牛角米白/深牛角）。eye 槽材质由
 *      makeDollMaterials 重做（标准套的 eye 是发光目底色近黑，不能当扣体）。
 *   2. **棉花凸出**：填充棉绒团从破口/接缝处不规则鼓出——cottonCluster
 *      （固定种子 mulberry32 选锚点+簇内抖动，不规则分布是重点），tatter 槽
 *      米白（palette.tatter；自定义几何补全白 color 属性——tatter 材质
 *      vertexColors:true 的契约）。
 *   3. **补丁**：对比色布块（accent 槽，随桶身曲面弯的贴片）+ 边缘虚线针脚
 *      （stitchPath 虚线薄片，deep 槽——surfaceStrips 同款贴面游走器）。
 *   4. **四肢接缝**：肩/髋/肘/膝一圈缝合线（seamRing 环带，deep 槽）。
 *   5. **棉布纹理**：calicoMaps() 细格纹+小碎花印花生成器（drawFlesh 同范式：
 *      albedo 同场输出 height/rough → Sobel 法线 → packRough → linearMean
 *      增益 → toTexture；图案只做在近白底明度上 = 天然中性基底，palette
 *      色相不被乘染，防绿染坑不触发自带免疫）。wrap 槽一张共享贴图，
 *      instancing 兼容，六材质槽/draw call 不破。
 *
 * 步态：人形步态参数调「软塌塌」（大 headLoll/大摆臂/低重心晃），core 不动；
 * kitdoll/pupdoll 走四足对角走姿（gait.kind='centaur' 契约，bonehound 先例：
 * arms 空表臂通道静默，臂字段给齐假值防 NaN；断腿降速不切爬行）。
 *
 * 借与自写的分界（范式照 undead.js/golem.js 顶部契约）：
 *   - 借：parts()/tornStrip（core/anatomy.js）、contactShadow（core/contact.js）、
 *     WRAP_TILES（core/wraps.js）、prims（pipeline/prims.js）、
 *     mkActorTools/flyBlob（flyers.js）、MUMMY.animate（core/mummy.js）、
 *     animateCentaurbot（robots.js，arms 空表安全复用）、
 *     quadStrips/mkRadiusFn（dragons.js）、mulberry32（pipeline/rng.js）、
 *     zombie.js 贴图 helper 全家桶（hash2/fbm/smooth/makeCanvas/
 *     normalFromHeight/packRough/linearMean/toTexture/clothMaps）、
 *     makeZombieMaterialsFrom（zombies_ex.js）。
 *   - 自写：calicoMaps 棉布印花生成器 + 布偶 rig（buildDollRig 人形契约 /
 *     buildQuaddollRig 四足契约）+ 五要素助手
 *     （buttonEyes/cottonCluster/stitchPath/patchOnBarrel/seamRing）。
 */

import * as THREE from 'three';
import { parts, tornStrip } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { WRAP_TILES } from '../core/wraps.js';
import { MUMMY } from '../core/mummy.js';
import { prims } from '../prims.js';
import { mulberry32 } from '../rng.js';
import { mkActorTools, flyBlob } from './flyers.js';
import { animateCentaurbot } from './robots.js';
import { quadStrips, mkRadiusFn } from './dragons.js';
import {
  hash2, fbm, smooth, makeCanvas,
  normalFromHeight, packRough, linearMean, toTexture, clothMaps,
} from './zombie.js';
import { makeZombieMaterialsFrom } from './zombies_ex.js';

// ---------------------------------------------------------------------------
// 棉布印花贴图：细格纹（gingham）+ 小碎花（calico 绒点）
// 范式照 zombie.js drawFlesh：albedo 与 height/rough 同场一次写出。
// 图案全做在近白底的明度上——palette 乘染不受影响（天然中性基底，
// 不需要 linenMaps 换底）。模块级单例共享（全谱系一张图，instancing 零成本）。
// ---------------------------------------------------------------------------

const SIZE = 512;

function drawCalico() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;
  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);

  const CELL = 64;                 // 细格纹格距（px）
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;
      // 细格纹：两向半透明条纹叠出三档明度（近白底 235/220/206）
      const sx = (x % CELL) / CELL, sy = (y % CELL) / CELL;
      const inX = sx < 0.28 ? 1 : 0, inY = sy < 0.28 ? 1 : 0;
      const edgeX = smooth(Math.min(sx, 0.28 - sx) / 0.05);   // 软边
      const edgeY = smooth(Math.min(sy, 0.28 - sy) / 0.05);
      const kX = inX ? edgeX : 0, kY = inY ? edgeY : 0;
      let lum = 235 - 15 * (kX + kY) - 14 * kX * kY;
      // 织物纱线起伏（经纬微纹）
      const weave = Math.sin(x * 1.9) * Math.sin(y * 1.9) * 2.5;
      // 小碎花：8×8 格 hash 门控，四成格子长四瓣绒点
      const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
      let flower = 0;
      if (hash2(gx, gy, 41) < 0.4) {
        const fx = (gx + 0.3 + hash2(gx, gy, 43) * 0.4) * CELL;
        const fy = (gy + 0.3 + hash2(gx, gy, 47) * 0.4) * CELL;
        for (let p = 0; p < 4; p++) {
          const pa = (p / 4) * Math.PI * 2 + hash2(gx, gy, 53);
          const px = fx + Math.cos(pa) * 5, py = fy + Math.sin(pa) * 5;
          const d = Math.hypot(x - px, y - py);
          flower = Math.max(flower, smooth(Math.max(0, 1 - d / 4.5)));
        }
      }
      lum -= flower * 30;                     // 花瓣更暗一档（印花凹版读法）
      const grain = (hash2(x, y, 7) - 0.5) * 5;
      const gval = Math.max(0, Math.min(255, lum + weave + grain));
      const p = i * 4;
      // 微暖白底（255 上限内偏米——旧布不读漂白）
      a[p] = Math.min(255, gval + 2);
      a[p + 1] = gval;
      a[p + 2] = Math.max(0, gval - 6);
      a[p + 3] = 255;
      height[i] = (kX + kY) * 0.12 + weave * 0.01 - flower * 0.06 + grain * 0.01;
      rough[i] = 0.86 + (kX + kY) * 0.03 + flower * 0.05;
    }
  }
  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough };
}

let CALICO = null;
export function calicoMaps() {
  if (CALICO) return CALICO;
  const { albedo, height, rough } = drawCalico();
  CALICO = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 0.9), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  return CALICO;
}

/** 布偶材质：wrap 槽换 calicoMaps 棉布印花，其余槽走标准套（wrapDark 深色
 *  布料是 clothMaps 破衣纹——补丁/裙裤的织感不同正好分层）。
 *  eye 槽重做「纽扣材质」：标准套的 eye 是发光目（底色 0x20241c 近黑 +
 *  低强度 emissive），布偶的眼睛是塑料/牛角/木质扣——浅色有质感半光泽，
 *  palette.eye 即扣色（各物种不同），eyeGlow 字段在本谱系弃用。 */
function makeDollMaterials(spec, rng) {
  const mats = makeZombieMaterialsFrom(spec, calicoMaps(), rng);
  mats.eye = new THREE.MeshStandardMaterial({
    color: spec.palette.eye,
    roughness: 0.35,         // 半光泽：扣面反光小高光是「塑料/牛角」的读法
    metalness: 0.0,
  });
  return mats;
}

// ---------------------------------------------------------------------------
// 五要素几何助手
// ---------------------------------------------------------------------------

/** 给自定义几何补全白 color 属性（tatter 槽 vertexColors:true 的契约——
 *  缺 color 属性的几何配 tatter 材质会染黑）。 */
function withWhiteColors(g) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 纽扣眼一对：真纽扣读法（特写一眼认出是纽扣）。
 *  - 扣体（eye 槽，palette.eye=扣色）：lathe 旋出——背面平贴脸、外缘一圈
 *    略凸的扣缘边圈、中央微凹的四孔区（经典四孔扣剖面）。
 *  - 四孔（deep 槽深点）：2×2 孔位小圆点（扣面上的针孔凹陷读法）。
 *  - 线迹（对比色线程薄片）：opts.style 'cross' 四孔交叉 X（两道斜线正交
 *    穿过四孔）/ 'parallel' 平行两道；线色与扣体拉开明度差——浅扣（默认）
 *    配 deep 深色线，深扣 opts.threadLight=true 配 tatter 米白线。
 *  返回 { buttons, holes, threads, threadLight }；holes/threads 是贴面装饰 noHit。 */
function buttonEyes(T, P, opts = {}) {
  const eye = prims(T);
  const deep = prims(T);
  const quads = [];
  const ey = P.headH * 0.52, ez = P.headD * 0.50, ex = P.headW * 0.24;
  const r = P.headW * 0.125;
  // 线程薄片（中心 c、切向 t、宽 w——脸上针脚是近平面件，法线朝 +z 面外）
  const dash = (c, t, len, w) => quads.push({ c, t, n: [0, 0, 1], len, w });
  const hr = r * 0.32;          // 四孔 2×2 半间距
  for (const s of [-1, 1]) {
    // 扣体（剖面自下而上：背 → 侧缘 → 凸缘圈 → 内沿 → 中央微凹面）
    eye.lathe([
      [0, -0.004], [r, -0.004], [r, 0.002], [r * 0.97, 0.010],
      [r * 0.80, 0.014], [r * 0.58, 0.004], [0, 0.004],
    ], { x: s * ex, y: ey, z: ez, rx: Math.PI / 2, segs: 10 });
    // 四孔深点（略凸出扣面，特写距离读得出针孔）
    for (const hx of [-1, 1]) for (const hy of [-1, 1]) {
      deep.cyl(0.0038, 0.0038, 0.012,
        { x: s * ex + hx * hr, y: ey + hy * hr, z: ez + 0.004, rx: Math.PI / 2, radial: 4 });
    }
    // 线迹（浮在扣面上方）
    if (opts.style === 'parallel') {
      // 平行两道（各穿过一排两孔）
      for (const hy of [-1, 1]) {
        dash([s * ex, ey + hy * hr, ez + 0.013], [1, 0, 0], r * 0.95, 0.0045);
      }
    } else {
      // 四孔交叉 X（两道对角线，各穿过对角两孔）
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const dx = Math.sin(rot), dy = Math.cos(rot);
        dash([s * ex, ey, ez + 0.013], [dx, dy, 0], hr * 2 * Math.SQRT2 * 1.15, 0.0045);
      }
    }
  }
  return { buttons: eye.build(), holes: deep.build(),
    threads: withWhiteColors(quadStrips(quads)), threadLight: !!opts.threadLight };
}

/** 虚线针脚游走器：沿折线点列铺「缝一针空一针」的虚线薄片（deep 槽）。
 *  pts = [[x,y,z],...] 折线；dash/gap 米制针距。返回 quadStrips 几何。 */
function stitchPath(pts, dash = 0.016, gap = 0.012, w = 0.004) {
  const quads = [];
  let carry = 0;               // 跨段延续针距（拐角处针脚不断档）
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const segLen = Math.hypot(dx, dy, dz);
    if (segLen < 1e-6) continue;
    const t = [dx / segLen, dy / segLen, dz / segLen];
    // 法线取折线平面外法（近似 +z；补丁/嘴上都是近平面件）
    let d = -carry;
    while (d + dash <= segLen + 1e-9) {
      if (d + dash > 0) {
        const c = [ax + dx * ((d + dash / 2) / segLen), ay + dy * ((d + dash / 2) / segLen), az + dz * ((d + dash / 2) / segLen)];
        quads.push({ c, t, n: [0, 0, 1], len: dash, w });
      }
      d += dash + gap;
    }
    carry = (segLen - Math.max(0, d - dash)) % (dash + gap);
  }
  if (!quads.length) {   // 路径太短一针都铺不下 → 退化成一针
    const [ax, ay, az] = pts[0], [bx, by, bz] = pts[1];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    quads.push({ c: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
      t: [(bx - ax) / len, (by - ay) / len, (bz - az) / len], n: [0, 0, 1], len, w });
  }
  return quadStrips(quads);
}

/** 桶身表面补丁（accent 槽对比色布块 + deep 槽边缘虚线针脚）：
 *  随 makeBarrelSurf 同款的桶面弯（3×3 采样网格贴面）。 */
function patchOnBarrel(surf, a0, y0, da, dy) {
  const N = 3;
  const pos = [], nor = [], uvA = [];
  const grid = [];
  for (let i = 0; i <= N; i++) {
    grid.push([]);
    for (let jj = 0; jj <= N; jj++) {
      const P = surf(a0 + (i / N - 0.5) * da, y0 + (jj / N - 0.5) * dy);
      grid[i].push([P.p[0] + P.n[0] * 0.005, P.p[1] + P.n[1] * 0.005, P.p[2] + P.n[2] * 0.005, P.n]);
    }
  }
  for (let i = 0; i < N; i++) for (let jj = 0; jj < N; jj++) {
    const q = [grid[i][jj], grid[i + 1][jj], grid[i + 1][jj + 1], grid[i][jj + 1]];
    const n = q[0][3];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      for (const k of tri) {
        pos.push(q[k][0], q[k][1], q[k][2]);
        nor.push(n[0], n[1], n[2]);
        uvA.push(0, 0);
      }
    }
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  patch.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  patch.computeBoundingSphere();
  // 边缘虚线针脚（沿贴片四边，贴面采样点）
  const edge = [];
  const E = 5;
  const edgePt = (t01, side) => {
    // side: 0 左 1 右 2 上 3 下
    const a = side === 0 ? a0 - da / 2 : side === 1 ? a0 + da / 2 : a0 - da / 2 + t01 * da;
    const y = side === 2 ? y0 + dy / 2 : side === 3 ? y0 - dy / 2 : y0 - dy / 2 + t01 * dy;
    const P = surf(a, y);
    return [P.p[0] + P.n[0] * 0.006, P.p[1] + P.n[1] * 0.006, P.p[2] + P.n[2] * 0.006];
  };
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < E; k++) edge.push(edgePt(k / E, side));
  }
  edge.push(edge[0]);   // 闭环
  return { patch, dashes: stitchPath(edge, 0.02, 0.013, 0.0045) };
}

/** 四肢接缝环（deep 槽）：关节处一圈凸起的缝合线带 */
function seamRing(T, r, h = 0.02) {
  const p = prims(T);
  p.cyl(r, r, h, { radial: 8, capTop: false, capBot: false });
  return p.build();
}

/** 棉花凸出簇（tatter 槽米白）：锚点处 2~4 个不规则绒团（固定种子
 *  mulberry32——不规则分布是重点，但跨加载/跨实例必须一致）。
 *  anchors = [[x,y,z],...]（所在父节点局部系）。 */
function cottonCluster(T, seed, anchors) {
  const rnd = mulberry32(seed);
  const p = prims(T);
  for (const [ax, ay, az] of anchors) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const r = 0.018 + rnd() * 0.026;
      p.ellipsoid(r, r * (0.7 + rnd() * 0.6), r, {
        x: ax + (rnd() - 0.5) * 0.05, y: ay + (rnd() - 0.5) * 0.05,
        z: az + (rnd() - 0.5) * 0.05, rings: 3, segs: 5,
      });
    }
  }
  return withWhiteColors(p.build());
}

/** 缝线嘴（deep 槽虚线）：嘴部一条横向微笑弧（两端略上挑） */
function stitchMouth(P, width = 0.6, droop = 0.12) {
  const y = P.headH * 0.26, z = P.headD * 0.52, w = P.headW * width;
  // 微笑弧：两端略上挑
  const pts = [];
  const N = 5;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    pts.push([(t - 0.5) * w, y + Math.abs(t - 0.5) * P.headH * droop, z + Math.sin(t * Math.PI) * 0.01]);
  }
  return stitchPath(pts, 0.014, 0.010, 0.004);
}

// ---------------------------------------------------------------------------
// 布偶 rig（人形契约，五种行走种共用；小孩体型 = 大头矮身比例）
// ---------------------------------------------------------------------------

function buildDollRig(spec, mats, actor, G) {
  const P = spec.proportions;
  const { meshes, add, count } = mkActorTools(mats, actor);
  // R = 逐实例随机：工厂（createZombieEx）withSeed 流内调用，保持原样
  const R = () => Math.random();
  const j = {
    leg: 0.93 + R() * 0.15, arm: 0.92 + R() * 0.17, girth: 0.90 + R() * 0.22,
    chest: 0.93 + R() * 0.15, chestW: 0.90 + R() * 0.20, head: 0.93 + R() * 0.14,
  };
  const asym = {
    scale: 0.90 + R() * 0.20,
    tilt: (R() - 0.5) * 0.5,       // 布偶头歪得比尸体更夸张（软塌气质）
    droop: (R() - 0.5) * 0.07,
    reach: (R() - 0.5) * 0.38,
  };
  const lead = asym.reach >= 0 ? 1 : -1;
  const gait = { stride: 0.85 + R() * 0.32, swing: 0.8 + R() * 0.45 };

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = P.hipY * j.leg;
  body.add(hips);
  add(hips, G.pelvis, mats.wrapDark, 'body').scale.set(j.chestW, 1, j.chestW);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX * j.chestW, 0,
      side === lead ? P.legX * 0.42 : -P.legX * 0.26);
    hips.add(hip);
    add(hip, G.thigh, mats.wrap, 'body').scale.set(j.girth, j.leg, j.girth);
    if (G.seamHip) add(hip, G.seamHip, mats.deep, 'body', true);      // 髋缝（贴面装饰 noHit）
    const knee = new THREE.Group();
    knee.position.y = -P.thighL * j.leg;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body').scale.set(j.girth, j.leg, j.girth);
    if (G.seamKnee) add(knee, G.seamKnee, mats.deep, 'body', true);   // 膝缝
    legs.push({ hip, knee, side });
  }

  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  torso.rotation.y = asym.reach * 0.85;
  hips.add(torso);
  add(torso, G.torso, mats.wrap, 'body').scale.set(j.chestW, j.chest, j.chestW);
  if (G.outfit) add(torso, G.outfit, mats.wrapDark, 'body').scale.set(j.chestW, j.chest, j.chestW);
  if (G.cotton) add(torso, G.cotton, mats.tatter, 'body', true);      // 棉花凸出 noHit
  if (G.patches) add(torso, G.patches, mats.accent, 'body', true);    // 补丁布块 noHit
  if (G.dashes) add(torso, G.dashes, mats.deep, 'body', true);        // 虚线针脚 noHit

  const arms = [];
  for (const side of [-1, 1]) {
    const w = side === lead ? 1.11 : 0.93;
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.shoulderX * j.chestW * w,
      P.shoulderY * j.chest + side * asym.droop,
      side === lead ? P.shoulderX * 0.18 : -P.shoulderX * 0.10);
    torso.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body').scale.set(j.girth, j.arm, j.girth);
    if (G.seamShoulder) add(shoulder, G.seamShoulder, mats.deep, 'body', true);  // 肩缝
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL * j.arm;
    shoulder.add(elbow);
    add(elbow, G.fore, mats.wrapDark, 'body').scale.set(j.girth, j.arm, j.girth);
    if (G.seamElbow) add(elbow, G.seamElbow, mats.deep, 'body', true);  // 肘缝
    arms.push({ shoulder, elbow, side, bias: side * asym.reach });
  }

  // 头（纽扣眼/缝线嘴/物种头部件全在 G/后挂里）
  const neck = new THREE.Group();
  neck.position.y = P.headY * j.chest;
  neck.scale.setScalar(j.head);
  neck.rotation.y = -asym.reach * 1.15;
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.buttons, mats.eye, 'head');                          // 纽扣扣体（扣色= palette.eye）
  if (G.holes) add(neck, G.holes, mats.deep, 'head', true);        // 四孔深点 noHit
  if (G.threads) add(neck, G.threads, G.threadLight ? mats.tatter : mats.deep, 'head', true);  // 线迹 noHit（深扣配米白线）
  if (G.mouth) add(neck, G.mouth, mats.deep, 'head', true);          // 缝线嘴 noHit
  if (G.hair) add(neck, G.hair, mats.accent, 'head', true);          // 毛线发 noHit

  // 松脱线头（破布槽：布偶下摆/袖口拖线——tatter 槽米白）
  const tatters = [];
  for (const t of (P.tatters || [])) {
    const pivot = new THREE.Group();
    pivot.position.set(t.x * j.chestW, (t.y || 0) * j.chest, t.z || 0);
    pivot.rotation.y = (t.yaw || 0) + (R() - 0.5) * 0.5;
    const restZ = (t.out || 0) * (t.x < 0 ? -1 : 1);
    pivot.rotation.z = restZ;
    (t.on === 'arm' ? arms[t.side > 0 ? 1 : 0].elbow : torso).add(pivot);
    const m = new THREE.Mesh(tornStrip(t.w, t.h, t.cut || 0, 7, WRAP_TILES), mats.tatter);
    m.scale.set(0.82 + R() * 0.4, 0.8 + R() * 0.45, 1);
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);
    meshes.push(m);
    tatters.push({ pivot, restZ, phase: R() * 6.283, swing: (t.swing ?? 1) * gait.swing });
  }

  const blob = contactShadow((spec.radius ?? 0.45) * 1.75);
  blob.position.y = 0.03;
  group.add(blob);

  const rig = {
    group, body, hips, torso, neck, legs, arms, tatters, meshes,
    triangles: 0, asym, gait, lead, blob,
    stepSpan: 2 * ((P.thighL || 0.4) + (P.shinL || 0.4)) * j.leg,
    twistBase: torso.rotation.y,
    neckBase: neck.rotation.y,
    tools: { add, count },
  };
  rig.triangles = count();
  return rig;
}

// ---------------------------------------------------------------------------
// 共享体型底子：小孩体型（矮身大头）/ 成年管家（高瘦弯背）/ 巨偶（圆胖 Boss）
// ---------------------------------------------------------------------------

/** 小孩布偶几何（dollette/dollad/twinsie 共用框架，G 字典按 P 缓存）：
 *  矮圆躯干 + 短四肢 + 大头。P.outfit 控制衣服件。 */
function kidGeometry(P) {
  let out = KIDGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.18, P.bodyD * 0.9, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  {
    // 短圆四肢（布偶的腿是布筒，末端布脚平头——没有脚脖）
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW, { y: -P.thighL / 2, top: 1.05, bottom: 0.95 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(P.legW * 0.92, P.shinL, P.legW * 0.92, { y: -P.shinL / 2, top: 1.0, bottom: 0.95 });
    ps.box(P.legW * 0.95, 0.07, P.legW * 1.6, { y: -P.shinL + 0.03, z: P.legW * 0.25, top: 0.95, bottom: 0.95 });
    out.shin = ps.build();
  }
  {
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW, { y: -P.upperL / 2, top: 1.05, bottom: 0.95 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 0.88, P.foreL, P.armW * 0.88, { y: -P.foreL / 2, top: 1.0, bottom: 0.95 });
    pf.box(P.armW * 1.0, 0.06, P.armW * 1.1, { y: -P.foreL - 0.02, top: 0.9, bottom: 0.9 });   // 布手
    out.fore = pf.build();
  }
  {
    // 矮圆躯干（lathe 小桶）
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
  }
  {
    // 圆头（小孩头大）+ 微凸颊
    const p = prims(T);
    p.ellipsoid(P.headW * 0.52, P.headH * 0.48, P.headD * 0.50, { y: P.headH * 0.48, rings: 5, segs: 8 });
    for (const s of [-1, 1]) {
      p.ellipsoid(P.headW * 0.16, P.headH * 0.14, P.headD * 0.16, { x: s * P.headW * 0.30, y: P.headH * 0.36, z: P.headD * 0.36, rings: 3, segs: 5 });
    }
    out.skull = p.build();
  }
  // 四肢接缝环（deep 槽；在关节局部系原点是细带）
  out.seamShoulder = seamRing(T, P.armW * 0.62, 0.018);
  out.seamElbow = seamRing(T, P.armW * 0.55, 0.016);
  out.seamHip = seamRing(T, P.legW * 0.62, 0.018);
  out.seamKnee = seamRing(T, P.legW * 0.56, 0.016);
  KIDGEO.set(P, out);
  return out;
}
const KIDGEO = new Map();

/** 小孩桶半径表（矮圆桶） */
const KID_PROFILE = [[0.001, -0.02], [0.20, 0.0], [0.26, 0.12], [0.27, 0.26],
  [0.24, 0.38], [0.18, 0.46], [0.001, 0.50]];

/** 桶身表面（patchOnBarrel 用）：直立桶 P(a,y)=(r·cos a, y, r·sin a) */
function makeBarrelSurf(rFn) {
  return (a, y) => {
    const r = rFn(y);
    return { p: [r * Math.cos(a), y, r * Math.sin(a)], n: [Math.cos(a), 0, Math.sin(a)] };
  };
}

// ---------------------------------------------------------------------------
// 物种一：女童偶 dollette —— 连衣裙 + 毛线双辫 + 木棕纽扣眼（四孔交叉线）
// ---------------------------------------------------------------------------

const DOLLETTEGEO = new Map();

function dolletteGeometry(P) {
  let out = DOLLETTEGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = kidGeometry(P);
  const surf = makeBarrelSurf(mkRadiusFn(KID_PROFILE));
  {
    // 连衣裙（wrapDark）：上身覆布 + 裙摆喇叭（lathe 扩口）
    const p = prims(T);
    p.lathe([[0.20, 0.06], [0.27, 0.16], [0.285, 0.30], [0.26, 0.42], [0.20, 0.50]], { segs: 10 });
    out.outfit = p.build();
  }
  {
    // 毛线双辫（accent 槽）：两侧各三节渐细的毛线节，垂到肩
    const p = prims(T);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        p.ellipsoid(0.045 - k * 0.008, 0.055, 0.045 - k * 0.008, {
          x: s * (P.headW * 0.52 + 0.01), y: P.headH * (0.55 - k * 0.30), z: -P.headD * 0.1,
          rings: 3, segs: 5 });
      }
      // 辫根毛线球
      p.ellipsoid(0.055, 0.05, 0.055, { x: s * P.headW * 0.48, y: P.headH * 0.62, z: -P.headD * 0.08, rings: 3, segs: 5 });
    }
    out.hair = p.build();
  }
  {
    // 纽扣眼：双正常木棕扣（四孔交叉线）
    const be = buttonEyes(T, P, { style: 'cross' });
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
    out.mouth = stitchMouth(P, 0.55, 0.10);
  }
  {
    // 补丁：裙摆左侧一块 + 针脚
    const pt = patchOnBarrel(surf, -0.5, 0.16, 0.5, 0.14);
    out.patches = pt.patch;
    out.dashes = pt.dashes;
  }
  {
    // 棉花凸出：右肩缝 + 左肘缝 + 裙摆破口三处簇
    out.cotton = cottonCluster(T, 20260831, [
      [0.24, 0.44, 0.05], [-0.22, 0.20, 0.14], [0.08, 0.10, 0.22],
    ]);
  }
  DOLLETTEGEO.set(P, out);
  return out;
}

export function buildDollette(spec, mats, actor) {
  return buildDollRig(spec, mats, actor, dolletteGeometry(spec.proportions));
}

export const DOLLETTE = {
  id: 'dollette',
  name: 'Dollette（女童偶）',

  speed: 1.35,
  scale: 0.62,           // 标准小孩体型（~1.1m）
  height: 1.12,
  radius: 0.30,

  palette: {
    wrap: 0xd8c8b8,      // 米杏棉布（calico 印花）
    wrapDark: 0x9a4a4a,  // 暗红连衣裙
    deep: 0x14100c,      // 深色缝线/针孔
    eye: 0x8a5a34,       // 木棕扣（纽扣眼扣体色）
    eyeGlow: 0.08,
    accent: 0xc86a6a,    // 暗粉（毛线辫/补丁）
    tatter: 0xe8e0d0,    // 米白（棉花/线头）
  },

  proportions: {
    hipY: 0.55, hipW: 0.30, bodyD: 0.24,
    legX: 0.10, legW: 0.11, thighL: 0.27, shinL: 0.28,   // hipY=thighL+shinL，铁律
    torsoY: 0.08, chestW: 0.42, chestH: 0.44,
    torsoProfile: KID_PROFILE,
    shoulderX: 0.19, shoulderY: 0.36, armW: 0.085, upperL: 0.30, foreL: 0.32,
    headY: 0.50, headW: 0.30, headH: 0.32, headD: 0.29,  // 小孩大头；头坐到桶顶（0.50=KID_PROFILE 顶），头缝在身上不留颈缝
    tatterRest: 0.3,
    tatters: [
      // 裙摆松脱线头两条
      { on: 'torso', x: 0.10, y: 0.06, z: 0.10, w: 0.05, h: 0.22, yaw: 0.3, cut: 2, swing: 1.2, out: 0.18 },
      { on: 'torso', x: -0.12, y: 0.05, z: -0.06, w: 0.04, h: 0.18, yaw: -0.4, cut: 1, swing: 1.1, out: 0.16 },
    ],
  },

  gait: {
    rate: 0.9,
    stride: 0.55,
    armSwing: 0.45,        // 软塌塌：甩臂幅大
    armReach: -0.10,
    armSplay: 0.18,
    elbowBend: -0.15,
    lean: -0.10,
    sway: 0.18,
    hipTwist: 0.10,
    bob: 0.06,
    headLoll: 0.30,        // 头晃得狠（布偶头只在脖子上坐一圈线）
    headDroop: -0.06,
  },

  makeMaterials: makeDollMaterials,
  build: buildDollette,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种二：男童偶 dollad —— 背带裤 + 短毛线头 + 双膝补丁
// ---------------------------------------------------------------------------

const DOLLADGEO = new Map();

function dolladGeometry(P) {
  let out = DOLLADGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = kidGeometry(P);
  const surf = makeBarrelSurf(mkRadiusFn(KID_PROFILE));
  {
    // 背带裤（wrapDark）：裤身覆布 + 两条背带
    const p = prims(T);
    p.lathe([[0.20, 0.02], [0.26, 0.12], [0.27, 0.24]], { segs: 10 });
    const pb = parts(T);
    for (const s of [-1, 1]) {
      pb.box(0.045, 0.24, 0.015, { x: s * 0.10, y: 0.38, z: 0.20, rx: -0.08, chamfer: 0.004 });
    }
    out.outfit = mergeTwo(p.build(), pb.build());
  }
  {
    // 短毛线头（accent 槽）：头顶三撮短毛线
    const p = prims(T);
    for (const k of [-1, 0, 1]) {
      p.cyl(0, 0.020, 0.10, { x: k * 0.05, y: P.headH * 0.92, z: -0.02 + Math.abs(k) * 0.02, rx: -0.3, rz: -k * 0.6, radial: 4 });
    }
    out.hair = p.build();
  }
  {
    const be = buttonEyes(T, P, { style: 'parallel' });   // 平行两道线（男童扣）
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
    out.mouth = stitchMouth(P, 0.6, 0.14);
  }
  {
    // 双膝补丁（accent；挂小腿）+ 腹前一块大补丁
    const pt = patchOnBarrel(surf, 0.3, 0.22, 0.44, 0.13);
    out.patches = pt.patch;
    out.dashes = pt.dashes;
    const pk = parts(T);
    for (const s of [-1, 1]) {
      pk.box(0.055, 0.06, 0.012, { x: s * 0.008, y: -P.shinL * 0.35, z: P.legW * 0.5, chamfer: 0.003 });
    }
    out.kneePatches = pk.build();
  }
  {
    // 棉花凸出：右膝破口 + 左肩缝
    out.cotton = cottonCluster(T, 20260901, [
      [0.13, 0.06, 0.10], [-0.20, 0.40, 0.04],
    ]);
  }
  DOLLADGEO.set(P, out);
  return out;
}

/** 两几何合并（同材质同关节的组件并一件；与 bake 契约同读 position/normal/uv） */
function mergeTwo(g1, g2) {
  const n = g1.attributes.position.count + g2.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  pos.set(g1.attributes.position.array); pos.set(g2.attributes.position.array, g1.attributes.position.count * 3);
  nor.set(g1.attributes.normal.array); nor.set(g2.attributes.normal.array, g1.attributes.position.count * 3);
  uv.set(g1.attributes.uv.array); uv.set(g2.attributes.uv.array, g1.attributes.position.count * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export function buildDollad(spec, mats, actor) {
  const rig = buildDollRig(spec, mats, actor, dolladGeometry(spec.proportions));
  const G = dolladGeometry(spec.proportions);
  // 双膝补丁挂小腿（随腿走；补 color 契约不需要——accent 槽无 vertexColors）
  add_knee(rig, G, mats);
  return rig;
}
function add_knee(rig, G, mats) {
  const { add, count } = rig.tools;
  add(rig.legs[0].knee, G.kneePatches, mats.accent, 'leg', true).position.set(0.01, 0, 0);
  add(rig.legs[1].knee, G.kneePatches, mats.accent, 'leg', true).position.set(-0.01, 0, 0);
  rig.triangles = count();
}

export const DOLLAD = {
  id: 'dollad',
  name: 'Dollad（男童偶）',

  speed: 1.5,            // 男孩偶比女孩偶快半拍（调皮）
  scale: 0.60,
  height: 1.06,
  radius: 0.29,

  palette: {
    wrap: 0xc8c0a8,      // 米灰棉布
    wrapDark: 0x4a5a7a,  // 蓝灰背带裤
    deep: 0x14100c,
    eye: 0xd8c8a8,       // 牛角米白扣
    eyeGlow: 0.08,
    accent: 0x8a7a4a,    // 棕黄（毛线头/补丁）
    tatter: 0xe8e0d0,
  },

  proportions: {
    hipY: 0.53, hipW: 0.28, bodyD: 0.23,
    legX: 0.095, legW: 0.105, thighL: 0.26, shinL: 0.27,
    torsoY: 0.08, chestW: 0.40, chestH: 0.42,
    torsoProfile: KID_PROFILE,
    shoulderX: 0.18, shoulderY: 0.34, armW: 0.08, upperL: 0.28, foreL: 0.30,
    headY: 0.50, headW: 0.29, headH: 0.30, headD: 0.28,  // 头坐到桶顶不留颈缝
    tatterRest: 0.3,
    tatters: [
      // 背带裤脚拖线
      { on: 'torso', x: -0.08, y: 0.03, z: 0.08, w: 0.045, h: 0.18, yaw: -0.2, cut: 2, swing: 1.2, out: 0.16 },
    ],
  },

  gait: {
    rate: 0.95,
    stride: 0.58,
    armSwing: 0.48,
    armReach: -0.12,
    armSplay: 0.16,
    elbowBend: -0.18,
    lean: -0.12,
    sway: 0.19,
    hipTwist: 0.11,
    bob: 0.065,
    headLoll: 0.32,
    headDroop: -0.05,
  },

  makeMaterials: makeDollMaterials,
  build: buildDollad,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 四足小偶 rig（centaur 契约：legs[0..1]=前对、legs[2..3]=后对，arms 空表
// 臂通道静默；kitdoll/pupdoll 共用）——横放布桶躯干 + 四布筒腿 + 大头纽扣眼。
// bonehound 先例：gait.kind='centaur' 的种死亡不进布娃娃（回退倾倒+沉入），
// 断腿只降速不切爬行。
// ---------------------------------------------------------------------------

function buildQuaddollRig(spec, mats, actor, G) {
  const P = spec.proportions;
  const { meshes, add, count } = mkActorTools(mats, actor);
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = P.rideHeight;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const jw = 0.92 + R() * 0.16;
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  if (G.mark) add(torso, G.mark, mats.wrapDark, 'body').scale.set(jw, 1, 1);   // 斑纹带（猫鞍斑/狗臀斑）
  if (G.cotton) add(torso, G.cotton, mats.tatter, 'body', true);              // 棉花凸出 noHit
  if (G.patches) add(torso, G.patches, mats.accent, 'body', true);            // 补丁布块 noHit
  if (G.dashes) add(torso, G.dashes, mats.deep, 'body', true);                // 虚线针脚 noHit
  if (G.tail) add(torso, G.tail, mats.wrapDark, 'body', true);                // 尾（弧度烘进几何定格；细长件 noHit）

  // 头（颈关节扛抬起角，动画每帧写 headDroop，同 centaur 契约）
  const neck = new THREE.Group();
  neck.position.set(0, P.torsoH * 0.30, P.torsoD * 0.46);
  torso.add(neck);
  add(neck, G.skull, mats.wrap, 'head');
  add(neck, G.buttons, mats.eye, 'head');                                     // 纽扣扣体
  if (G.holes) add(neck, G.holes, mats.deep, 'head', true);                   // 四孔深点 noHit
  if (G.threads) add(neck, G.threads, G.threadLight ? mats.tatter : mats.deep, 'head', true);  // 线迹 noHit
  if (G.muzzle) add(neck, G.muzzle, mats.wrapDark, 'head');                   // 吻部（pupdoll；并头盒是脸的一部分）
  if (G.nose) add(neck, G.nose, mats.deep, 'head', true);                     // 鼻头 noHit
  if (G.ears) add(neck, G.ears, mats.wrapDark, 'head', true);                 // 尖耳/垂耳 noHit（不撑头盒）
  if (G.whiskers) add(neck, G.whiskers, mats.tatter, 'head', true);           // 毛线胡须 noHit

  // 四腿：centaur 槽位约定 legs[0..1] = 前对（HIP/KNEE）、legs[2..3] = 后对
  // （LEG2）；外张/后掠全走静态 mount 烘进几何，注册关节只扛步态。
  const legs = [];
  for (const side of [-1, 1]) {
    // 前腿：肩线下，近垂直
    const mountF = new THREE.Group();
    mountF.position.set(side * P.torsoW * 0.42 * jw, -P.torsoH * 0.05, P.torsoD * 0.30);
    mountF.rotation.z = side * 0.08;
    torso.add(mountF);
    const hipF = new THREE.Group();
    mountF.add(hipF);
    add(hipF, G.frontUp, mats.wrap, 'body');
    if (G.seamLegF) add(hipF, G.seamLegF, mats.deep, 'body', true);           // 前腿根接缝 noHit
    const kneeF = new THREE.Group();
    kneeF.position.y = -P.upperL;
    hipF.add(kneeF);
    add(kneeF, G.frontLo, mats.wrapDark, 'body');
    legs.push({ hip: hipF, knee: kneeF, side });

    // 后腿：骨盆下，略后掠（犬科/猫科站式）
    const mountR = new THREE.Group();
    mountR.position.set(side * P.torsoW * 0.40 * jw, -P.torsoH * 0.02, -P.torsoD * 0.38);
    mountR.rotation.z = side * 0.10;
    mountR.rotation.x = 0.14;
    torso.add(mountR);
    const hipR = new THREE.Group();
    mountR.add(hipR);
    add(hipR, G.rearUp, mats.wrap, 'body');
    if (G.seamLegR) add(hipR, G.seamLegR, mats.deep, 'body', true);           // 后腿根接缝 noHit
    const kneeR = new THREE.Group();
    kneeR.position.y = -P.thighL;
    hipR.add(kneeR);
    add(kneeR, G.rearLo, mats.wrapDark, 'body');
    legs.push({ hip: hipR, knee: kneeR, side });
  }

  const tatters = [];
  const blob = contactShadow((spec.radius ?? 0.26) * 1.8);
  blob.position.y = 0.02;
  group.add(blob);
  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms: [], tatters, meshes,
    triangles: count(), asym, lead: 1, blob,
    // 对角对一步的地面覆盖：四腿平均展开长（strideRate 步频推导用）
    stepSpan: 2 * ((P.upperL + P.foreL + P.thighL + P.shinL) / 4) * 0.85,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

/** 四足小偶共享身体底子：横放布桶躯干 + 布筒四腿 + 大圆头 + 腿根接缝。
 *  物种差全在头部件/斑纹/尾（各物种几何函数里补）。 */
function petBaseGeometry(P, T) {
  const out = {};
  const D = P.torsoD, W = P.torsoW;
  {
    // 躯干：横放布桶（lathe rx=π/2：尾端收细、胸肩饱满）
    const p = prims(T);
    p.lathe([[0.001, -D * 0.52], [W * 0.34, -D * 0.48], [W * 0.50, -D * 0.26],
      [W * 0.54, D * 0.04], [W * 0.50, D * 0.30], [W * 0.36, D * 0.46], [0.001, D * 0.50]],
      { rx: Math.PI / 2, segs: 8 });
    out.torso = p.build();
  }
  {
    // 布筒四腿（两段圆节 + 布爪垫；前后腿分两套几何，后腿略粗）
    const mkLeg = (up, lo, r0) => {
      const pu = prims(T);
      pu.cyl(r0 * 0.62, r0 * 0.70, up, { y: -up / 2, radial: 6 });
      const u = pu.build();
      const pl = prims(T);
      pl.cyl(r0 * 0.55, r0 * 0.62, lo, { y: -lo / 2, radial: 6 });
      pl.ellipsoid(r0 * 0.68, 0.030, r0 * 0.85, { y: -lo - 0.01, z: 0.012, rings: 3, segs: 5 });  // 布爪
      return [u, pl.build()];
    };
    [out.frontUp, out.frontLo] = mkLeg(P.upperL, P.foreL, P.legW);
    [out.rearUp, out.rearLo] = mkLeg(P.thighL, P.shinL, P.legW * 1.1);
  }
  // 腿根接缝环（deep 槽）
  out.seamLegF = seamRing(T, P.legW * 0.72, 0.016);
  out.seamLegR = seamRing(T, P.legW * 0.80, 0.016);
  {
    // 大圆头（小偶头大）+ 微凸颊
    const p = prims(T);
    p.ellipsoid(P.headW * 0.52, P.headH * 0.50, P.headD * 0.50, { y: P.headH * 0.50, rings: 5, segs: 8 });
    for (const s of [-1, 1]) {
      p.ellipsoid(P.headW * 0.17, P.headH * 0.15, P.headD * 0.17,
        { x: s * P.headW * 0.30, y: P.headH * 0.38, z: P.headD * 0.34, rings: 3, segs: 5 });
    }
    out.skull = p.build();
  }
  return out;
}

/** 链式布尾（弧度烘进几何定格——centaur 支不写破布列）：
 *  从尾根逐节递进转角，segsT = [[rx, rBot, rTop, len], ...]。 */
function chainTail(p, root, segsT) {
  let tip = root.slice();
  for (const [rx, r0, r1, len] of segsT) {
    const dir = [0, Math.cos(rx), Math.sin(rx)];
    p.cyl(r1, r0, len, {
      x: tip[0] + dir[0] * len / 2, y: tip[1] + dir[1] * len / 2, z: tip[2] + dir[2] * len / 2,
      rx, radial: 5,
    });
    tip = [tip[0] + dir[0] * len, tip[1] + dir[1] * len, tip[2] + dir[2] * len];
  }
}

// ---------------------------------------------------------------------------
// 物种三：小猫偶 kitdoll —— 橘猫小偶（尖耳 + 毛线胡须 + 细尾上翘；
// 四足小碎步，体型比小孩偶小一号）
// ---------------------------------------------------------------------------

const KITDOLLGEO = new Map();

function kitdollGeometry(P) {
  let out = KITDOLLGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = petBaseGeometry(P, T);
  const D = P.torsoD, W = P.torsoW, H = P.torsoH;
  {
    // 橘猫鞍斑（wrapDark：背上一圈斑纹带，随桶面）
    const p = prims(T);
    p.lathe([[0.001, -D * 0.30], [W * 0.52, -D * 0.24], [W * 0.56, -D * 0.02],
      [W * 0.53, D * 0.16], [0.001, D * 0.20]], { rx: Math.PI / 2, segs: 8 });
    out.mark = p.build();
  }
  {
    // 尖耳（wrapDark 四棱锥，向外微撇）
    const p = prims(T);
    for (const s of [-1, 1]) {
      p.cyl(0, 0.045, 0.09, {
        x: s * P.headW * 0.30, y: P.headH * 0.96, z: -P.headD * 0.06,
        rz: -s * 0.28, rx: -0.15, radial: 4 });
    }
    out.ears = p.build();
  }
  {
    // 毛线胡须（tatter 槽米白：每侧三根横出细丝，贴颊外伸）
    const quads = [];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const ty = 0.14 - k * 0.12;
        const tz = 0.30;
        const tl = Math.hypot(1, ty, tz);
        quads.push({
          c: [s * P.headW * 0.50, P.headH * (0.44 - k * 0.06), P.headD * 0.38],
          t: [s / tl, ty / tl, tz / tl], n: [0, 1, 0], len: 0.10, w: 0.003 });
      }
    }
    out.whiskers = withWhiteColors(quadStrips(quads));
  }
  {
    // 细尾上翘（wrapDark 橘尾：三节渐细递进上翘）
    const p = prims(T);
    chainTail(p, [0, H * 0.20, -D * 0.50],
      [[-0.85, 0.020, 0.016, 0.12], [-0.40, 0.016, 0.012, 0.11], [-0.05, 0.012, 0.007, 0.10]]);
    out.tail = p.build();
  }
  {
    // 纽扣眼（木棕扣四孔交叉线）
    const be = buttonEyes(T, P, { style: 'cross' });
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
  }
  {
    // 体侧补丁（accent 布块 + deep 虚线针脚闭环）
    const pk = parts(T);
    pk.box(0.10, 0.09, 0.012, { x: W * 0.53, y: 0.02, z: -D * 0.05, ry: 0.12, chamfer: 0.004 });
    out.patches = pk.build();
    const x0 = W * 0.53 + 0.008, y0 = 0.02, z0 = -D * 0.05;
    out.dashes = stitchPath([
      [x0, y0 - 0.045, z0 - 0.05], [x0, y0 + 0.045, z0 - 0.05],
      [x0, y0 + 0.045, z0 + 0.05], [x0, y0 - 0.045, z0 + 0.05],
      [x0, y0 - 0.045, z0 - 0.05],
    ], 0.016, 0.011, 0.004);
  }
  {
    // 棉花凸出：左后腿根缝 + 右肩缝两簇
    out.cotton = cottonCluster(T, 20260906, [
      [-W * 0.38, 0.0, -D * 0.30], [W * 0.36, 0.03, D * 0.12],
    ]);
  }
  KITDOLLGEO.set(P, out);
  return out;
}

export function buildKitdoll(spec, mats, actor) {
  return buildQuaddollRig(spec, mats, actor, kitdollGeometry(spec.proportions));
}

export const KITDOLL = {
  id: 'kitdoll',
  name: 'Kitdoll（小猫偶）',

  speed: 2.8,            // 小猫窜得快（小碎步高步频）
  scale: 0.78,
  height: 0.48,
  radius: 0.26,

  palette: {
    wrap: 0xe0d0b8,      // 米黄棉布（calico 印花）
    wrapDark: 0xc07838,  // 橘（鞍斑/尖耳/细尾/布爪）
    deep: 0x14100c,
    eye: 0x9a6a38,       // 木棕扣
    eyeGlow: 0.08,
    accent: 0x7a8a6a,    // 灰绿补丁
    tatter: 0xe8e0d0,    // 米白（棉花/胡须）
  },

  proportions: {
    rideHeight: 0.24,
    torsoW: 0.22, torsoH: 0.20, torsoD: 0.46,
    headW: 0.22, headH: 0.20, headD: 0.22,   // 大头（小偶头占比例大）
    legW: 0.075, upperL: 0.12, foreL: 0.12, thighL: 0.13, shinL: 0.12,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'centaur',     // 矢状面对角四足（fillCentaurJoints / animateCentaurbot）
    rate: 1.6,
    stride: 0.50,        // 小跨幅高步频 = 猫的小碎步
    knBend: 0.50,        // 膝静止折角（动画每帧还原）
    flex: 0.65,          // 摆动收拢
    bob: 0.035,
    swayRoll: 0.07, swayYaw: 0.10,
    lean: 0.0,
    headDroop: -0.28,    // 头抬平前视（-x = 抬起）
    headScan: 0.45,      // 错拍扫视（猫的好奇读法）
    // 臂通道对本种无几何挂载（静默），但 fillCentaurJoints 攻击支会读这些字段
    // ——必须给齐，否则 windup 时四元数写 NaN 进纹理行
    armReach: 0, armSplay: 0, elBend: 0, armSwing: 0,
    arm2Reach: 0, arm2Splay: 0, el2Bend: 0, arm2Swing: 0,
  },

  makeMaterials: makeDollMaterials,
  build: buildKitdoll,
  animate: animateCentaurbot,   // arms 空数组：臂循环零迭代，安全复用
};

// ---------------------------------------------------------------------------
// 物种四：小狗偶 pupdoll —— 棕白花狗小偶（垂耳 + 吻部 + 短尾上翘 + 臀斑；
// 比小猫略壮，步幅大一号）
// ---------------------------------------------------------------------------

const PUPDOLLGEO = new Map();

function pupdollGeometry(P) {
  let out = PUPDOLLGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = petBaseGeometry(P, T);
  const D = P.torsoD, W = P.torsoW, H = P.torsoH;
  {
    // 棕臀斑（wrapDark：后身一圈花斑带，随桶面）
    const p = prims(T);
    p.lathe([[0.001, -D * 0.54], [W * 0.36, -D * 0.50], [W * 0.52, -D * 0.34],
      [W * 0.54, -D * 0.16], [0.001, -D * 0.12]], { rx: Math.PI / 2, segs: 8 });
    out.mark = p.build();
  }
  {
    // 垂耳（wrapDark 两片布耳贴颊下垂）
    const p = prims(T);
    for (const s of [-1, 1]) {
      p.ellipsoid(0.018, 0.075, 0.045, {
        x: s * P.headW * 0.50, y: P.headH * 0.55, z: -P.headD * 0.02,
        rz: s * 0.25, rings: 3, segs: 5 });
    }
    out.ears = p.build();
  }
  {
    // 吻部（wrapDark 短吻筒 + deep 鼻头；并头盒是脸的一部分）
    const p = prims(T);
    p.cyl(P.headW * 0.15, P.headW * 0.21, P.headD * 0.30,
      { y: P.headH * 0.30, z: P.headD * 0.56, rx: Math.PI / 2 - 0.15, radial: 6 });
    out.muzzle = p.build();
    const pn = prims(T);
    pn.ellipsoid(0.020, 0.016, 0.014, { y: P.headH * 0.34, z: P.headD * 0.72, rings: 3, segs: 5 });
    out.nose = pn.build();
  }
  {
    // 短尾上翘（wrapDark 两节）
    const p = prims(T);
    chainTail(p, [0, H * 0.22, -D * 0.50],
      [[-0.50, 0.022, 0.018, 0.09], [-0.05, 0.018, 0.010, 0.08]]);
    out.tail = p.build();
  }
  {
    // 纽扣眼（牛角米白扣平行两道线）
    const be = buttonEyes(T, P, { style: 'parallel' });
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
  }
  {
    // 体侧补丁（accent 布块 + deep 虚线针脚闭环）
    const pk = parts(T);
    pk.box(0.10, 0.09, 0.012, { x: -W * 0.53, y: 0.02, z: D * 0.05, ry: -0.12, chamfer: 0.004 });
    out.patches = pk.build();
    const x0 = -W * 0.53 - 0.008, y0 = 0.02, z0 = D * 0.05;
    out.dashes = stitchPath([
      [x0, y0 - 0.045, z0 - 0.05], [x0, y0 + 0.045, z0 - 0.05],
      [x0, y0 + 0.045, z0 + 0.05], [x0, y0 - 0.045, z0 + 0.05],
      [x0, y0 - 0.045, z0 - 0.05],
    ], 0.016, 0.011, 0.004);
  }
  {
    // 棉花凸出：右臀缝 + 左肩缝两簇
    out.cotton = cottonCluster(T, 20260907, [
      [W * 0.38, 0.01, -D * 0.28], [-W * 0.36, 0.03, D * 0.14],
    ]);
  }
  PUPDOLLGEO.set(P, out);
  return out;
}

export function buildPupdoll(spec, mats, actor) {
  return buildQuaddollRig(spec, mats, actor, pupdollGeometry(spec.proportions));
}

export const PUPDOLL = {
  id: 'pupdoll',
  name: 'Pupdoll（小狗偶）',

  speed: 2.4,
  scale: 0.82,
  height: 0.52,
  radius: 0.28,

  palette: {
    wrap: 0xd8ccbc,      // 米白棉布
    wrapDark: 0x7a5238,  // 棕（垂耳/吻部/臀斑/短尾/布爪）
    deep: 0x14100c,
    eye: 0xd0bf9a,       // 牛角米白扣
    eyeGlow: 0.08,
    accent: 0x9a6a4a,    // 棕补丁
    tatter: 0xe8e0d0,
  },

  proportions: {
    rideHeight: 0.26,
    torsoW: 0.24, torsoH: 0.22, torsoD: 0.50,
    headW: 0.24, headH: 0.22, headD: 0.24,
    legW: 0.08, upperL: 0.13, foreL: 0.13, thighL: 0.14, shinL: 0.13,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'centaur',
    rate: 1.4,
    stride: 0.55,        // 步幅比猫大一号（狗的颠步）
    knBend: 0.45,
    flex: 0.60,
    bob: 0.045,
    swayRoll: 0.09, swayYaw: 0.12,
    lean: 0.02,
    headDroop: -0.22,
    headScan: 0.35,
    armReach: 0, armSplay: 0, elBend: 0, armSwing: 0,
    arm2Reach: 0, arm2Splay: 0, el2Bend: 0, arm2Swing: 0,
  },

  makeMaterials: makeDollMaterials,
  build: buildPupdoll,
  animate: animateCentaurbot,
};


// ---------------------------------------------------------------------------
// 物种四：双子抱偶 twinsie —— 小孩体型变体：大孩背后绑着一个迷你偶
// （背后小偶的纽扣眼越过肩膀前视——creepy-cute 的双视线读法）
// ---------------------------------------------------------------------------

const TWINSIEGEO = new Map();

function twinsieGeometry(P) {
  let out = TWINSIEGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = kidGeometry(P);
  const surf = makeBarrelSurf(mkRadiusFn(KID_PROFILE));
  {
    // 罩袍（wrapDark）：无裙长罩衫
    const p = prims(T);
    p.lathe([[0.20, 0.04], [0.26, 0.14], [0.275, 0.28], [0.24, 0.40], [0.18, 0.48]], { segs: 10 });
    out.outfit = p.build();
  }
  {
    // 大孩毛线帽（accent 平顶帽）
    const p = prims(T);
    p.cyl(P.headW * 0.5, P.headW * 0.52, 0.06, { y: P.headH * 0.86, radial: 8 });
    p.cyl(0.02, 0.02, 0.04, { y: P.headH * 0.92, radial: 5 });   // 帽顶球
    out.hair = p.build();
  }
  {
    const be = buttonEyes(T, P, { style: 'cross', threadLight: true });   // 深棕扣配米白线
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
    out.mouth = stitchMouth(P, 0.5, 0.08);
  }
  {
    // 背后迷你偶（绑带+小偶：小躯干/小头/细肢全缩比；纽扣眼越过肩前视）
    const p = prims(T);
    const bx = 0, by = 0.30, bz = -0.24;      // 背挂位（桶背后）
    p.ellipsoid(0.085, 0.10, 0.06, { x: bx, y: by, z: bz, rings: 4, segs: 6 });       // 小躯干
    p.ellipsoid(0.065, 0.062, 0.06, { x: bx + 0.02, y: by + 0.155, z: bz + 0.01, rings: 4, segs: 6 }); // 小头
    for (const s of [-1, 1]) {
      p.cyl(0.012, 0.014, 0.12, { x: bx + s * 0.09, y: by + 0.02, z: bz + 0.02, rz: s * 0.5, radial: 4 });   // 小臂
      p.cyl(0.014, 0.016, 0.12, { x: bx + s * 0.04, y: by - 0.14, z: bz, rx: 0.3, radial: 4 });              // 小腿
    }
    out.miniBody = p.build();
    // 迷你偶纽扣眼（eye 槽扣色两点，越过肩线前视）
    const pe = prims(T);
    for (const s of [-1, 1]) {
      pe.cyl(0.012, 0.012, 0.008, { x: bx + 0.02 + s * 0.026, y: by + 0.165, z: bz + 0.065, rx: Math.PI / 2, radial: 6 });
    }
    out.miniEyes = pe.build();
    // 绑带（wrapDark 两带交叉）
    const pb = parts(T);
    pb.box(0.30, 0.035, 0.02, { y: by - 0.02, z: bz + 0.10, rz: 0.5, chamfer: 0.004 });
    pb.box(0.30, 0.035, 0.02, { y: by - 0.02, z: bz + 0.10, rz: -0.5, chamfer: 0.004 });
    out.straps = pb.build();
  }
  {
    const pt = patchOnBarrel(surf, 0.55, 0.18, 0.5, 0.15);
    out.patches = pt.patch;
    out.dashes = pt.dashes;
  }
  {
    out.cotton = cottonCluster(T, 20260903, [
      [0.20, 0.42, 0.06], [-0.16, 0.12, 0.16], [0.0, 0.30, -0.20],
    ]);
  }
  TWINSIEGEO.set(P, out);
  return out;
}

export function buildTwinsie(spec, mats, actor) {
  const rig = buildDollRig(spec, mats, actor, twinsieGeometry(spec.proportions));
  const G = twinsieGeometry(spec.proportions);
  const { add, count } = rig.tools;
  // 背挂迷你偶：region body（并躯干盒——绑在背上就是它该在的判定位）
  add(rig.torso, G.miniBody, mats.wrap, 'body');
  add(rig.torso, G.miniEyes, mats.eye, 'body', true);    // 小扣眼贴面件 noHit
  add(rig.torso, G.straps, mats.wrapDark, 'body', true);
  rig.triangles = count();
  return rig;
}

export const TWINSIE = {
  id: 'twinsie',
  name: 'Twinsie（双子抱偶）',

  speed: 1.2,            // 背着小偶走得更沉
  scale: 0.66,
  height: 1.18,
  radius: 0.32,

  palette: {
    wrap: 0xd0c0c8,      // 米紫棉布
    wrapDark: 0x6a5a7a,  // 紫罩袍
    deep: 0x14100c,
    eye: 0x5a3a28,       // 深棕扣（配米白线迹）
    eyeGlow: 0.08,
    accent: 0x7a8a9a,    // 蓝灰（毛线帽/补丁）
    tatter: 0xe8e0d0,
  },

  proportions: {
    hipY: 0.58, hipW: 0.31, bodyD: 0.26,
    legX: 0.105, legW: 0.115, thighL: 0.28, shinL: 0.30,
    torsoY: 0.08, chestW: 0.44, chestH: 0.46,
    torsoProfile: KID_PROFILE,
    shoulderX: 0.20, shoulderY: 0.38, armW: 0.09, upperL: 0.31, foreL: 0.33,
    headY: 0.50, headW: 0.31, headH: 0.33, headD: 0.30,  // 头坐到桶顶不留颈缝
    tatterRest: 0.3,
    tatters: [
      { on: 'torso', x: 0.11, y: 0.05, z: 0.09, w: 0.05, h: 0.24, yaw: 0.3, cut: 2, swing: 1.2, out: 0.18 },
    ],
  },

  gait: {
    rate: 0.85,
    stride: 0.52,
    armSwing: 0.42,
    armReach: -0.08,
    armSplay: 0.18,
    elbowBend: -0.14,
    lean: -0.14,           // 背着东西更佝
    sway: 0.18,
    hipTwist: 0.10,
    bob: 0.06,
    headLoll: 0.30,
    headDroop: -0.08,
  },

  makeMaterials: makeDollMaterials,
  build: buildTwinsie,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种五：管家人偶 butler —— 瘦高成年体型（细长四肢弯背 + 燕尾服下摆 +
// 礼帽 + 宽缝线微笑；~1.95m）
// ---------------------------------------------------------------------------

const BUTLERGEO = new Map();

function butlerGeometry(P) {
  let out = BUTLERGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.20, P.bodyD * 0.85, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  {
    // 细长四肢（管家臂腿是布筒拉长）
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW, { y: -P.thighL / 2, top: 1.05, bottom: 0.92 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(P.legW * 0.88, P.shinL, P.legW * 0.88, { y: -P.shinL / 2, top: 1.0, bottom: 0.92 });
    ps.box(P.legW * 0.9, 0.07, P.legW * 1.7, { y: -P.shinL + 0.03, z: P.legW * 0.3, top: 0.95, bottom: 0.95 });
    out.shin = ps.build();
  }
  {
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW, { y: -P.upperL / 2, top: 1.05, bottom: 0.92 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 0.85, P.foreL, P.armW * 0.85, { y: -P.foreL / 2, top: 1.0, bottom: 0.92 });
    pf.box(P.armW * 1.0, 0.07, P.armW * 1.05, { y: -P.foreL - 0.02, top: 0.9, bottom: 0.9 });
    out.fore = pf.build();
  }
  {
    // 高瘦躯干（细高桶）
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
    // 燕尾服上身（wrapDark 覆布 + 胸衬）
    const po = prims(T);
    po.lathe([[0.17, 0.10], [0.21, 0.30], [0.22, 0.52], [0.19, 0.62], [0.14, 0.68]], { segs: 10 });
    out.outfit = po.build();
  }
  out.seamShoulder = seamRing(T, P.armW * 0.62, 0.018);
  out.seamElbow = seamRing(T, P.armW * 0.55, 0.016);
  out.seamHip = seamRing(T, P.legW * 0.62, 0.018);
  out.seamKnee = seamRing(T, P.legW * 0.56, 0.016);
  {
    // 长脸头（成年偶脸长）
    const p = prims(T);
    p.ellipsoid(P.headW * 0.48, P.headH * 0.52, P.headD * 0.46, { y: P.headH * 0.5, rings: 5, segs: 8 });
    out.skull = p.build();
    const be = buttonEyes(T, P, { style: 'parallel', threadLight: true });   // 深牛角扣配米白线
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
    // 宽缝线微笑（管家的咧嘴）
    out.mouth = stitchMouth(P, 0.85, 0.20);
  }
  {
    // 补丁：肘部小补丁由 seam 兼任；背后一块长方补
    const surf = makeBarrelSurf(mkRadiusFn(P.torsoProfile));
    const pt = patchOnBarrel(surf, Math.PI * 0.5, 0.30, 0.4, 0.20);
    out.patches = pt.patch;
    out.dashes = pt.dashes;
  }
  {
    out.cotton = cottonCluster(T, 20260904, [
      [0.16, 0.55, 0.08], [-0.15, 0.18, 0.12],
    ]);
  }
  BUTLERGEO.set(P, out);
  return out;
}

export function buildButler(spec, mats, actor) {
  const rig = buildDollRig(spec, mats, actor, butlerGeometry(spec.proportions));
  const G = butlerGeometry(spec.proportions);
  const P = spec.proportions;
  const { add, count } = rig.tools;
  // 礼帽（wrapDark；头顶高帽是管家的剪影词）+ 燕尾摆（破布槽两条后摆尾）
  const T = WRAP_TILES;
  const hat = prims(T);
  hat.cyl(P.headW * 0.42, P.headW * 0.46, P.headH * 0.42, { y: P.headH * 1.05, radial: 8 });      // 帽筒
  hat.cyl(P.headW * 0.68, P.headW * 0.68, 0.014, { y: P.headH * 0.86, radial: 8 });               // 帽檐
  add(rig.neck, hat.build(), mats.wrapDark, 'head', true);   // 礼帽细长件 noHit
  rig.triangles = count();
  return rig;
}

export const BUTLER = {
  id: 'butler',
  name: 'Butler（管家人偶）',

  speed: 1.1,
  scale: 1.05,           // ~1.95m 成年体型
  height: 1.95,
  radius: 0.36,

  palette: {
    wrap: 0xb8b0a0,      // 浅灰棉布（脸/臂）
    wrapDark: 0x2e2e34,  // 黑燕尾服
    deep: 0x14100c,
    eye: 0x3a3230,       // 深牛角扣（别纯黑；配米白线迹）
    eyeGlow: 0.08,
    accent: 0x8a8a92,    // 灰补丁
    tatter: 0xe8e0d0,
  },

  proportions: {
    hipY: 0.96, hipW: 0.30, bodyD: 0.24,
    legX: 0.10, legW: 0.10, thighL: 0.47, shinL: 0.49,   // hipY=thighL+shinL，铁律
    torsoY: 0.10, chestW: 0.38, chestH: 0.62,
    torsoProfile: [[0.001, -0.02], [0.15, 0.02], [0.19, 0.20], [0.20, 0.40],
      [0.18, 0.54], [0.13, 0.64], [0.001, 0.68]],
    shoulderX: 0.21, shoulderY: 0.52, armW: 0.075, upperL: 0.44, foreL: 0.47,
    headY: 0.74, headW: 0.24, headH: 0.30, headD: 0.25,
    tatterRest: 0.2,
    tatters: [
      // 燕尾服两条后摆尾（管家的尾巴）
      { on: 'torso', x: 0.08, y: 0.16, z: -0.13, w: 0.10, h: 0.42, yaw: -0.3, cut: 1, swing: 0.9, out: 0.14 },
      { on: 'torso', x: -0.08, y: 0.16, z: -0.13, w: 0.10, h: 0.42, yaw: 0.3, cut: 1, swing: 0.9, out: 0.14 },
    ],
  },

  gait: {
    rate: 0.8,
    stride: 0.60,          // 长腿大步
    armSwing: 0.50,        // 软塌塌长臂甩
    armReach: -0.06,
    armSplay: 0.14,
    elbowBend: -0.12,
    lean: -0.26,           // 弯背（管家的恭敬前倾读作 creepy）
    sway: 0.15,
    hipTwist: 0.09,
    bob: 0.055,
    headLoll: 0.26,
    headDroop: 0.10,       // 头前探
  },

  makeMaterials: makeDollMaterials,
  build: buildButler,
  animate: MUMMY.animate,
};

// ---------------------------------------------------------------------------
// 物种六：巨型破损布偶 bigdoll —— Boss 档（scale 2.2 < draco 2.8）：
// 圆胖巨身 + 棉花大量爆出 + 大补丁 + 锯齿缝线嘴
// ---------------------------------------------------------------------------

const BIGDOLLGEO = new Map();

const BIG_PROFILE = [[0.001, -0.02], [0.30, 0.0], [0.38, 0.18], [0.40, 0.38],
  [0.36, 0.54], [0.26, 0.64], [0.001, 0.68]];

function bigdollGeometry(P) {
  let out = BIGDOLLGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};
  {
    const p = parts(T);
    p.box(P.hipW, 0.26, P.bodyD * 0.9, { y: 0.02, top: 1.0, bottom: 0.85 });
    out.pelvis = p.build();
  }
  {
    // 粗短四肢（巨偶是圆桶四肢）
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW, { y: -P.thighL / 2, top: 1.08, bottom: 0.92 });
    out.thigh = p.build();
    const ps = parts(T);
    ps.box(P.legW * 0.95, P.shinL, P.legW * 0.95, { y: -P.shinL / 2, top: 1.0, bottom: 0.95 });
    ps.box(P.legW * 1.1, 0.09, P.legW * 1.8, { y: -P.shinL + 0.04, z: P.legW * 0.3, top: 0.95, bottom: 0.95 });
    out.shin = ps.build();
  }
  {
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW, { y: -P.upperL / 2, top: 1.08, bottom: 0.92 });
    out.upper = p.build();
    const pf = parts(T);
    pf.box(P.armW * 0.9, P.foreL, P.armW * 0.9, { y: -P.foreL / 2, top: 1.0, bottom: 0.92 });
    pf.box(P.armW * 1.3, 0.12, P.armW * 1.3, { y: -P.foreL - 0.03, top: 0.9, bottom: 0.9 });   // 大布手
    out.fore = pf.build();
  }
  {
    const p = prims(T);
    p.lathe(P.torsoProfile, { segs: 10 });
    out.torso = p.build();
  }
  out.seamShoulder = seamRing(T, P.armW * 0.62, 0.026);
  out.seamElbow = seamRing(T, P.armW * 0.55, 0.022);
  out.seamHip = seamRing(T, P.legW * 0.62, 0.026);
  out.seamKnee = seamRing(T, P.legW * 0.56, 0.022);
  {
    // 大圆脸 + 大纽扣眼 + 锯齿缝线大嘴
    const p = prims(T);
    p.ellipsoid(P.headW * 0.52, P.headH * 0.48, P.headD * 0.5, { y: P.headH * 0.46, rings: 5, segs: 8 });
    out.skull = p.build();
    const be = buttonEyes(T, P, { style: 'cross' });   // 大木扣四孔交叉粗线
    out.buttons = be.buttons;
    out.holes = be.holes;
    out.threads = be.threads;
    out.threadLight = be.threadLight;
    // 锯齿大嘴（缝线 Z 字折线 = 「破损被粗缝上」的读法）
    const w = P.headW * 0.7, y = P.headH * 0.22, z = P.headD * 0.52;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      pts.push([(k / 6 - 0.5) * w, y + (k % 2 ? -0.03 : 0.015), z + Math.sin(k / 6 * Math.PI) * 0.01]);
    }
    out.mouth = stitchPath(pts, 0.02, 0.012, 0.006);
  }
  {
    // 三块大补丁（accent 对比色）+ 各自针脚
    const surf = makeBarrelSurf(mkRadiusFn(P.torsoProfile));
    const p1 = patchOnBarrel(surf, 0.3, 0.20, 0.5, 0.18);
    const p2 = patchOnBarrel(surf, Math.PI - 0.4, 0.34, 0.55, 0.20);
    const p3 = patchOnBarrel(surf, Math.PI * 0.5, 0.18, 0.45, 0.16);
    out.patches = mergeTwo(mergeTwo(p1.patch, p2.patch), p3.patch);
    out.dashes = mergeTwo(mergeTwo(p1.dashes, p2.dashes), p3.dashes);
  }
  {
    // 棉花大量爆出（Boss 的破损读法：八处锚点大簇）
    out.cotton = cottonCluster(T, 20260905, [
      [0.34, 0.50, 0.10], [-0.32, 0.44, 0.14], [0.16, 0.26, 0.32],
      [-0.10, 0.12, 0.30], [0.0, 0.56, -0.28], [0.24, 0.06, -0.20],
      [-0.26, 0.30, -0.24], [0.10, 0.62, 0.12],
    ]);
  }
  BIGDOLLGEO.set(P, out);
  return out;
}

export function buildBigdoll(spec, mats, actor) {
  return buildDollRig(spec, mats, actor, bigdollGeometry(spec.proportions));
}

export const BIGDOLL = {
  id: 'bigdoll',
  name: 'Bigdoll（巨型破损布偶）',

  speed: 0.75,
  scale: 2.2,            // Boss 档（< draco 2.8 铁律）
  height: 3.9,
  radius: 0.72,

  palette: {
    wrap: 0xc8b89a,      // 旧黄棉布
    wrapDark: 0x6a5a48,  // 深棕下段
    deep: 0x14100c,
    eye: 0x7a4a28,       // 大木扣
    eyeGlow: 0.08,
    accent: 0x4a6a8a,    // 蓝补丁（对比色）
    tatter: 0xe8e0d0,
  },

  proportions: {
    hipY: 0.92, hipW: 0.55, bodyD: 0.50,
    legX: 0.20, legW: 0.20, thighL: 0.45, shinL: 0.47,   // hipY=thighL+shinL，铁律
    torsoY: 0.10, chestW: 0.80, chestH: 0.68,
    torsoProfile: BIG_PROFILE,
    shoulderX: 0.42, shoulderY: 0.52, armW: 0.16, upperL: 0.48, foreL: 0.52,
    headY: 0.76, headW: 0.32, headH: 0.36, headD: 0.33,
    tatterRest: 0.25,
    tatters: [
      // 巨偶全身破口拖线
      { on: 'torso', x: 0.14, y: 0.08, z: 0.10, w: 0.08, h: 0.34, yaw: 0.3, cut: 2, swing: 0.9, out: 0.16 },
      { on: 'torso', x: -0.16, y: 0.30, z: -0.08, w: 0.07, h: 0.38, yaw: -0.4, cut: 1, swing: 1.0, out: 0.18 },
      { on: 'arm', side: 1, x: 0.02, y: -0.24, z: 0, w: 0.06, h: 0.26, yaw: 0.6, cut: 2, swing: 1.2, out: 0.16 },
    ],
  },

  gait: {
    rate: 0.6,
    stride: 0.55,
    armSwing: 0.4,
    armReach: 0.04,
    armSplay: 0.30,
    elbowBend: -0.08,
    lean: -0.10,
    sway: 0.15,
    hipTwist: 0.05,
    bob: 0.09,
    headLoll: 0.24,
    headDroop: -0.10,
  },

  windupLean: 0.10,      // 巨偶蓄力后仰压小（golem 同款读法坑）
  makeMaterials: makeDollMaterials,
  build: buildBigdoll,
  animate: MUMMY.animate,
};
