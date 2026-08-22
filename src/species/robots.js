/**
 * 机器人物种系列：蜱虫 tickbot / 蛛卫 spiderbot / 半人马 centaurbot / 泰坦 titan。
 * 纯代码零资产，与丧尸族同一套 pipeline（bake/gait/hitvol/ragdoll）全链路可用。
 *
 * 借与自写的分界（范式照 crawler_true.js 顶部契约）：
 *   - 借：几何原语 parts()（core/anatomy.js）、接触影 contactShadow
 *     （core/contact.js）、WRAP_TILES/compensate（core/wraps.js）、贴图管线
 *     helper（zombie.js export 的 hash2/fbm/normalFromHeight/packRough/
 *     linearMean/toTexture 全套）、爬行者走姿 animateCrawler（tickbot 直接复用）。
 *     titan 是纯 spec：buildHumanoid + MUMMY.animate 一行不写新几何。
 *   - 自写：金属贴图集（拉丝装甲板/铆钉/焊缝/锈迹 + 银灰执行器肋纹 +
 *     阵营装饰层：危险警示条纹/stencil 徽记（按物种 texSeed 四种风格）/
 *     emissive 发光接缝，全部同场写进 wrap 材质槽），
 *     tickbot/spiderbot/centaurbot 三个自定义 rig（骨架层级对齐人形契约：
 *     group→body→hips→torso→neck + legs[{hip,knee}]/arms[{shoulder,elbow}]，
 *     多出来的肢体走 bake.js 扩展关节位 LEG2/LEG3/ARM2），以及配套的
 *     animateSpiderbot/animateCentaurbot（与 src/gait.js 的
 *     fillSpiderJoints/fillCentaurJoints 逐行对应，同 fillCrawlJoints↔
 *     animateCrawler 的关系）。titan 用 buildTitan 包装 core buildHumanoid：
 *     rig 原样拿来，头部天线阵/散热片/目缝与躯干排气管/反应炉在物种层后挂。
 *
 * 头部剪影词（四物种一眼区分）：tickbot 复眼簇+双天线、spiderbot 复眼
 * 点阵+獠牙+传感角、centaurbot 骑士盔冠鳍+T 形目镜、 titan 天线阵列+
 * 耳部散热片。细长突出装饰件一律 mesh.userData.noHit（bake.js 跳过其
 * 碰撞盒合并，渲染与断肢子树收集不受影响），贴面件/贴身件保留判定。
 *
 * 金属质感读法：
 *   - wrap = 装甲板：metalness 0.95 + metalnessMap 分区（焊缝/锈迹掉到 0，
 *     锈处 albedo 转橙褐、roughness 升高——「有些地方有金属质感」分区可读）；
 *     拉丝横纹 + 板缝 + 铆钉 + 边缘磨损全部画进 albedo/height/rough 同场。
 *   - wrapDark = 银灰执行器/关节：钢色、肋纹（波纹管读法）、中高 metalness。
 *   - eye = 发光传感器：机器人的「脸」全靠它（emissive 强度高）。
 *   - 机器人无破布：tatters: []、tatterRest: 0（makeGaitParams 对空数组安全）。
 *
 * 骨架契约备忘（bake 会把注册关节旋转归零再烘）：
 *   腿的大外张/偏航全在静态 mount Group 上（烘进几何，不占动画关节）；
 *   注册关节（hip/knee/shoulder/elbow）只扛动画，膝的静止反折角由
 *   animateX / fillXJoints 每帧还原（同 crawler 的 elBend/knBend 契约）。
 */

import * as THREE from 'three';
import { MUMMY, buildHumanoid } from '../core/mummy.js';
import { parts } from '../core/anatomy.js';
import { contactShadow } from '../core/contact.js';
import { compensate, WRAP_TILES } from '../core/wraps.js';
import { mulberry32, hashStr, withSeed, random } from '../rng.js';
import {
  hash2, fbm, smooth, makeCanvas,
  normalFromHeight, packRough, linearMean, toTexture,
} from './zombie.js';
import { animateCrawler } from './crawler_true.js';
import { prims } from '../prims.js';

const SIZE = 512;

// ---------------------------------------------------------------------------
// 金属贴图：装甲板（wrap）与银灰执行器（wrapDark）
// ---------------------------------------------------------------------------

/**
 * 装甲板：拉丝金属底 + 3×3 装甲板分块（板缝凹陷、metalness 掉 0）+
 * 四角铆钉 + 板缘磨损亮边 + 锈迹斑（albedo 橙褐、metalness 0、roughness 高）。
 * albedo 与 height/rough/metal 同场一次写出（范式同 zombie.js drawFlesh：
 * 变色的特征必然改变表面）。
 *
 * 阵营装饰层（同场追加，区域级定位——wrap tiles 的 UV 由 parts() 按世界
 * 坐标投影，贴图里的一块区域会散布到各构件表面，不追求精确定位）：
 *   - 危险警示条纹：tile 内 hu∈[0.06,0.34]×hv∈[0.68,0.94] 的黄黑斜纹，
 *     噪声侵蚀掉漆；漆面 roughness 提、metalness 掉（漆不是裸金属）。
 *   - stencil 徽记：hu∈[0.58,0.90]×hv∈[0.10,0.38] 的白色印刷符号，
 *     四种几何风格（三角/条码/伪数字/折角）按 seed 选——每物种一个
 *     texSeed，共享本函数。边缘噪声侵蚀。
 *   - 发光接缝：独立 emissive 画布，沿板缝外侧勾亮线 + 板角传感节点
 *     亮点；暗底亮线，交给材质 emissive（物种 palette.eye 上色）。
 */
function drawArmor(seed = 0) {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);
  const metal = new Float32Array(SIZE * SIZE);
  const emis = new Float32Array(SIZE * SIZE);

  const PLATES = 3;   // 每平铺单元 3×3 块装甲板
  const STYLE = seed % 4;   // stencil 符号风格（物种 texSeed）

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // 拉丝：单向拉长的条带纹（u 向低频、v 向高频 → 横向长丝）
      const brush = fbm(u * 0.35, v * 5.0, 3, 4, 21) - 0.5;
      const grain = (hash2(x, y, 7) - 0.5);
      // 板级色阶：每块装甲板一个整体明度偏置（同 zombie 的 patchTone 理由：
      // 肢体 UV 只覆盖贴图一角，没有块级色阶会读成纯平塑料）
      const plateTone = (hash2(Math.floor(u * PLATES), Math.floor(v * PLATES), 43) - 0.5) * 30;

      let r = 158 + brush * 42 + plateTone + grain * 10;
      let g = 164 + brush * 40 + plateTone + grain * 10;
      let b = 172 + brush * 38 + plateTone * 0.95 + grain * 10;

      // 板缝：距最近分块界线的归一距离（平铺安全：fract 周期即 PLATES 格）
      const fu = u * PLATES, fv = v * PLATES;
      const du = Math.min(fu - Math.floor(fu), 1 - (fu - Math.floor(fu)));
      const dv = min0(fv);   // 同上，抽函数防行宽
      const seamD = Math.min(du, dv);
      const seam = smooth(Math.max(0, 1 - seamD / 0.030));        // 缝线本体
      const wear = smooth(Math.max(0, 1 - seamD / 0.075)) * (1 - seam); // 缝旁磨损亮边
      r += (54 - r) * seam * 0.85 + 46 * wear;
      g += (58 - g) * seam * 0.85 + 46 * wear;
      b += (64 - b) * seam * 0.85 + 44 * wear;

      // 装饰：tile 内局部坐标（fract 即平铺周期，区域随平铺散布到整机）
      const hu = u - Math.floor(u), hv = v - Math.floor(v);
      // 危险警示条纹（黄黑斜纹，漆面：糙、非金属、噪声侵蚀掉漆）
      let hazard = 0, hazardYellow = 0;
      if (hu > 0.06 && hu < 0.34 && hv > 0.68 && hv < 0.94) {
        const stripe = Math.sin((hu + hv) * 56) > 0 ? 1 : 0;
        const edge = Math.min(
          smooth((hu - 0.06) / 0.02), smooth((0.34 - hu) / 0.02),
          smooth((hv - 0.68) / 0.02), smooth((0.94 - hv) / 0.02));
        const chip = smooth((fbm(u * 3, v * 3, 3, 5, 71 + seed) - 0.30) / 0.35);
        hazard = edge * chip;
        hazardYellow = stripe;
      }
      if (hazard > 0) {
        const yr = 196, yg = 150, yb = 38, dr = 34, dg = 34, db = 37;
        r += ((hazardYellow ? yr : dr) - r) * hazard * 0.92;
        g += ((hazardYellow ? yg : dg) - g) * hazard * 0.92;
        b += ((hazardYellow ? yb : db) - b) * hazard * 0.92;
      }

      // stencil 徽记：白色印刷符号（风格按物种 texSeed），噪声侵蚀边缘
      let stencil = 0;
      if (hu > 0.58 && hu < 0.90 && hv > 0.10 && hv < 0.38) {
        const su = (hu - 0.58) / 0.32, sv = (hv - 0.10) / 0.28;
        let shape = 0;
        if (STYLE === 0) {          // 三角箭头（朝上）
          shape = (Math.abs(su - 0.5) < sv * 0.55 - 0.06 && sv > 0.18) ? 1 : 0;
        } else if (STYLE === 1) {   // 条码（五竖条）
          shape = (sv > 0.18 && sv < 0.82 && (su * 9) % 2 < 1 && su > 0.08 && su < 0.92) ? 1 : 0;
        } else if (STYLE === 2) {   // 伪数字（两方框带横槽）
          const bx = su < 0.5 ? su * 2 : (su - 0.5) * 2;
          shape = (bx > 0.12 && bx < 0.88 && sv > 0.15 && sv < 0.85
            && !(bx > 0.30 && bx < 0.70 && (sv * 3) % 1 > 0.35 && sv > 0.25 && sv < 0.78)) ? 1 : 0;
        } else {                    // 折角 chevron（朝下 V）
          const cy = 0.72 - Math.abs(su - 0.5) * 0.9;
          shape = Math.abs(sv - cy) < 0.13 ? 1 : 0;
        }
        const chip = smooth((fbm(u * 5, v * 5, 3, 7, 97 + seed) - 0.42) / 0.28);
        stencil = shape * chip;
      }
      if (stencil > 0) {
        r += (222 - r) * stencil * 0.95;
        g += (226 - g) * stencil * 0.95;
        b += (230 - b) * stencil * 0.95;
      }

      // 铆钉：板角附近的小凸点（每板四角，平铺后即成四角共点）
      const rivU = du * PLATES * SIZE, rivV = dv * PLATES * SIZE;   // 距板角的像素
      const rivD = Math.hypot(rivU, rivV);
      const rivet = smooth(Math.max(0, 1 - rivD / 9));
      r += 34 * rivet; g += 34 * rivet; b += 32 * rivet;

      // 锈迹：低频岛斑，软边；锈处金属死、表面糙、色相橙褐
      const rustN = fbm(u, v, 4, 3, 61);
      const rust = smooth(Math.max(0, Math.min(1, (rustN - 0.56) / 0.14)));
      r += (128 - r) * rust * 0.85;
      g += (72 - g) * rust * 0.88;
      b += (46 - b) * rust * 0.92;

      const p = i * 4;
      a[p]     = Math.max(0, Math.min(255, r));
      a[p + 1] = Math.max(0, Math.min(255, g));
      a[p + 2] = Math.max(0, Math.min(255, b));
      a[p + 3] = 255;

      height[i] = brush * 0.10 - seam * 0.7 + rivet * 0.55 - rust * 0.15
        - hazard * 0.06 - stencil * 0.04;
      rough[i] = 0.32 + Math.abs(brush) * 0.14 + seam * 0.28 + rust * 0.52 - wear * 0.10
        + hazard * 0.30 + stencil * 0.45;
      metal[i] = Math.max(0, 0.96 - seam * 0.9 - rust * 1.0 - wear * 0.06
        - hazard * 0.85 - stencil * 0.9);

      // 发光接缝：板缝外侧一道亮线 + 板角斜向偏移的传感节点亮点。亮线
      // 避开缝本体（缝是暗的），贴着缝走才读成「接缝里透出光」。
      // 关键克制：按板格 hash 门控，只有约四成板格的缝透光——全缝描边会
      // 读成 tron 霓虹网（第一轮截图实证），稀疏才像「线路从缝里漏光」。
      const cellGlow = hash2(Math.floor(fu), Math.floor(fv), 91 + seed) < 0.40 ? 1 : 0;
      const line = smooth(Math.max(0, 1 - Math.abs(seamD - 0.048) / 0.008));
      const nodeD = Math.hypot(rivU - 17, rivV - 17);
      const node = smooth(Math.max(0, 1 - nodeD / 4));
      emis[i] = Math.max(line, node) * cellGlow * (1 - rust);   // 锈死的地方灯也死
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough, metal, emis };

  function min0(f) { const t = f - Math.floor(f); return Math.min(t, 1 - t); }
}

/**
 * 银灰执行器/关节件：钢色底 + 环向肋纹（波纹管/散热鳍片读法）。
 * 中高金属、中粗糙——与装甲板的镜面板区分质感，但本身是银灰金属
 * （v2 调色：原为近黑橡胶读法，用户要求肢体改银灰）。
 */
function drawActuator() {
  const albedo = makeCanvas(SIZE);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  const aimg = actx.createImageData(SIZE, SIZE);
  const a = aimg.data;

  const height = new Float32Array(SIZE * SIZE);
  const rough = new Float32Array(SIZE * SIZE);
  const metal = new Float32Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // 肋纹：v 向正弦环带 + 轻微相位扰动防机械感过死
      const wob = fbm(u, v, 2, 4, 17) * 0.8;
      const rib = Math.sin((v * 22 + wob) * Math.PI * 2);
      const grain = (hash2(x, y, 7) - 0.5);
      const tone = (hash2(Math.floor(u * 4), Math.floor(v * 4), 31) - 0.5) * 14;

      const c = Math.max(0, Math.min(255, 150 + rib * 18 + tone + grain * 8));
      const p = i * 4;
      a[p] = c; a[p + 1] = c + 2; a[p + 2] = c + 5; a[p + 3] = 255;

      height[i] = rib * 0.5;
      rough[i] = 0.50 + rib * 0.07 + Math.abs(grain) * 0.06;
      metal[i] = 0.72 + rib * 0.10;
    }
  }

  actx.putImageData(aimg, 0, 0);
  return { albedo, height, rough, metal };
}

const ARMOR = new Map();   // 按物种 texSeed 缓存（stencil 风格随 seed 变）
export function armorMaps(seed = 0) {
  let m = ARMOR.get(seed);
  if (m) return m;
  const { albedo, height, rough, metal, emis } = drawArmor(seed);
  m = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.5), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    metalnessMap: toTexture(packRough(metal), THREE.NoColorSpace),
    emissiveMap: toTexture(packRough(emis), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  ARMOR.set(seed, m);
  return m;
}

let ACTUATOR = null;
export function actuatorMaps() {
  if (ACTUATOR) return ACTUATOR;
  const { albedo, height, rough, metal } = drawActuator();
  ACTUATOR = {
    map: toTexture(albedo, THREE.SRGBColorSpace),
    normalMap: toTexture(normalFromHeight(height, 1.8), THREE.NoColorSpace),
    roughnessMap: toTexture(packRough(rough), THREE.NoColorSpace),
    metalnessMap: toTexture(packRough(metal), THREE.NoColorSpace),
    gain: linearMean(albedo),
  };
  return ACTUATOR;
}

// ---------------------------------------------------------------------------
// 材质：六槽位契约同 makeZombieMaterials（bake/查看器只认槽位名）
// ---------------------------------------------------------------------------

// rng 省略时走模块级 RNG（rng.js，受 ?seed= 控制）；工厂传实例专用流。
export function makeRobotMaterials(spec, rng = random) {
  const armor = armorMaps(spec.texSeed ?? 0);
  const act = actuatorMaps();
  const jitter = (hex, gain, h, s, l) =>
    compensate(hex, gain).offsetHSL(h, s, l);

  // 逐实例色调抖动幅度比丧尸小：工业产品，个体差靠体量/姿态不靠涂装
  const dh = (rng() - 0.5) * 0.03;
  const ds = (rng() - 0.5) * 0.06;
  const dl = (rng() - 0.5) * 0.08;

  const wrap = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrap, armor.gain, dh, ds, dl),
    map: armor.map,
    normalMap: armor.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: armor.roughnessMap,
    roughness: 1.0,
    metalnessMap: armor.metalnessMap,
    metalness: 1.0,           // 基值乘 metalnessMap：板面 0.96 / 缝与锈 0
    // 发光接缝：暗底亮线的 emissiveMap，按物种 palette.eye 上色，
    // 强度克制——是点缀不是霓虹（SwiftShader 截图下也要读得出）
    emissive: new THREE.Color(spec.palette.eye),
    emissiveMap: armor.emissiveMap,
    emissiveIntensity: spec.palette.seamGlow ?? 0.8,
    envMapIntensity: 1.15,
  });

  const wrapDark = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrapDark, act.gain, dh, ds * 0.5, dl * 0.5),
    map: act.map,
    normalMap: act.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: act.roughnessMap,
    roughness: 1.0,
    metalnessMap: act.metalnessMap,
    metalness: 1.0,
    envMapIntensity: 1.0,   // 银灰肢体要靠环境反射读「钢」（原 0.8 是近黑读法）
  });

  const deep = new THREE.MeshStandardMaterial({
    color: spec.palette.deep,
    roughness: 0.55,
    metalness: 0.6,
  });

  // 发光传感器：机器人读法的全部焦点。底色拉黑让 emissive 独占。
  const eye = new THREE.MeshStandardMaterial({
    color: 0x0a0c0e,
    roughness: 0.25,
    metalness: 0.4,
    emissive: spec.palette.eye,
    emissiveIntensity: spec.palette.eyeGlow ?? 1.9,
  });

  // 黄铜饰件/铭牌（accent）：暗金金属，与钢甲分色相
  const accent = new THREE.MeshStandardMaterial({
    color: spec.palette.accent,
    roughness: spec.palette.accentRough ?? 0.38,
    metalness: spec.palette.accentMetal ?? 0.9,
    envMapIntensity: 1.0,
  });

  // 机器人无破布；槽位留位保契约（DoubleSide + vertexColors 同 zombie 契约）
  const tatter = new THREE.MeshStandardMaterial({
    color: spec.palette.tatter ?? spec.palette.wrapDark,
    roughness: 0.85,
    metalness: 0.3,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  return { wrap, wrapDark, deep, eye, accent, tatter };
}

// ---------------------------------------------------------------------------
// 工厂：createZombie 的最小同构（bake.js / 查看器只消费这些字段）
// ---------------------------------------------------------------------------

export function createRobot(spec, index) {
  // 确定性生成：与 createZombie 同契约（seed = hashStr(spec.id) + index 派生，
  // withSeed 包 build——tickbot/spiderbot/centaurbot 的 buildXxx 与 titan 的
  // buildHumanoid 内部 R()/Math.random 全部落在实例种子流里，rng.js 有说明）。
  const seed = (hashStr(spec.id) + (index || 0) * 2654435761) >>> 0;
  return withSeed(seed, () => {
    const actor = { spec, variant: spec.id, index };
    const mats = makeRobotMaterials(spec, mulberry32((seed ^ 0x9e3779b9) >>> 0));
    const rig = spec.build(spec, mats, actor);
    actor.rig = rig;
    actor.materials = mats;
    actor.scale = spec.scale * (rig.asym ? rig.asym.scale : 1);
    actor.triangles = Math.round(rig.triangles);
    actor.st = { phase: Math.random() * 6.283 };   // withSeed 流内，已确定性
    return actor;
  });
}

// ---------------------------------------------------------------------------
// 共享 build 小件（三个自定义 rig 的公共骨架/记账件）
// ---------------------------------------------------------------------------

function mkActorTools(spec, mats, actor) {
  const meshes = [];
  let triangles = 0;
  const add = (parent, g, mat, region) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    m.userData.region = region;
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    triangles += g.attributes.position.count / 3;
    return m;
  };
  return { meshes, add, count: () => triangles };
}

// ---------------------------------------------------------------------------
// 物种一：蜱虫 tickbot —— 小型四足爬机（crawler 范式，双腿双臂槽当四条腿）
// ---------------------------------------------------------------------------

const TICKGEO = new Map();

function tickbotGeometry(P) {
  let out = TICKGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};

  {
    // 圆顶甲壳：ellipsoid 半球（wrap 装甲板）——原两级收分盒叠出的阶台穹顶
    // 换成切面穹顶（几何语言扩展的回改样例，prims.js）。半径/高度按旧盒包络
    // 校准：顶高齐平旧第二级盒顶（0.74·shellH），穹面在双天线/警示灯埋点处
    // 仍与件相交不悬浮；rz 略大于 shellD/2 让眼塔尾缘仍咬进壳面
    const p = prims(T);
    p.ellipsoid(P.shellW / 2, P.shellH * 1.05, P.shellD * 0.55,
      { y: -P.shellH * 0.31, half: 'top', rings: 5, segs: 12 });
    out.dome = p.build();
  }
  {
    // 腹底设备舱（wrapDark 执行器）
    const p = parts(T);
    p.box(P.shellW * 0.78, P.shellH * 0.40, P.shellD * 0.78,
      { y: -P.shellH * 0.42, top: 1.0, bottom: 0.86 });
    out.belly = p.build();
  }
  {
    // 眼塔：deep 基座 + 单发大眼（eye 满槽）+ 顶盖（wrap）
    const p = parts(T);
    p.box(P.eyeW * 1.5, P.eyeH * 1.7, P.eyeW * 1.1, { y: 0, top: 0.9, bottom: 1.0 });
    out.turret = p.build();

    const pe = parts(T);
    pe.box(P.eyeW * 0.74, P.eyeH * 0.68, 0.035, { y: 0, z: P.eyeW * 0.56, chamfer: 0.010 });
    out.eye = pe.build();

    // 复眼簇：主独眼周围一圈 5 个小发光传感点（eye 槽，合并单几何）——
    // 「警觉的小侦察虫」的读法全靠这圈小点把独眼从「摄像头」变成「复眼」
    const pc0 = parts(T);
    for (let k = 0; k < 5; k++) {
      const th = (k / 5) * Math.PI * 2 + 0.31;
      pc0.box(0.020, 0.020, 0.024, {
        x: Math.cos(th) * P.eyeW * 0.74,
        y: Math.sin(th) * P.eyeH * 0.98,
        z: P.eyeW * 0.52, chamfer: 0.004,
      });
    }
    out.eyeCluster = pc0.build();

    const pc = parts(T);
    pc.box(P.eyeW * 1.6, P.eyeH * 0.35, P.eyeW * 1.2, { y: P.eyeH * 0.95, top: 0.8, bottom: 1.0 });
    out.turretCap = pc.build();
  }
  {
    // 天线 ×2（accent 黄铜细杆，竖在穹顶后缘；根部埋进顶板防悬浮感）。
    // 一长一短双天线是 tickbot 的剪影词之一；细长突出物标 noHit。
    const p = parts(T);
    p.box(0.014, P.shellH * 0.7, 0.014, { y: P.shellH * 0.35, chamfer: 0.004 });
    p.box(0.012, P.shellH * 0.42, 0.012,
      { x: P.shellW * 0.16, y: P.shellH * 0.21, z: -0.02, rz: -0.12, chamfer: 0.004 });
    out.antenna = p.build();
  }
  {
    // 背部警示小灯（eye 槽）：穹顶后缘一盏常亮小方块，远距剪影里的
    // 「这是机器不是虫」的第二读点
    const p = parts(T);
    p.box(0.034, 0.024, 0.034, { y: 0.012, chamfer: 0.006 });
    out.beacon = p.build();
  }
  {
    // 腿：近段（wrap）/ 远段 + 足垫（wrapDark）
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW * 1.05, { y: -P.thighL / 2, top: 1.05, bottom: 0.75 });
    out.thigh = p.build();

    const ps = parts(T);
    ps.box(P.legW * 0.78, P.shinL, P.legW * 0.82, { y: -P.shinL / 2, top: 1.05, bottom: 0.6 });
    ps.box(P.legW * 1.5, 0.022, P.legW * 1.9, { y: -P.shinL - 0.008, z: 0.01, chamfer: 0.006 });
    out.shin = ps.build();
  }

  TICKGEO.set(P, out);
  return out;
}

export function buildTickbot(spec, mats, actor) {
  const P = spec.proportions;
  const G = tickbotGeometry(P);
  const { meshes, add, count } = mkActorTools(spec, mats, actor);

  // R = 逐实例随机：本函数只经 spec.build 在工厂（createRobot）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();               // 静态壳（bob/受击下沉走动画）
  group.add(body);
  const hips = new THREE.Group();               // J.HIPS：position 扛 rideHeight
  hips.position.y = P.rideHeight;
  body.add(hips);
  const torso = new THREE.Group();              // J.TORSO：快速捣步时身体拧滚
  hips.add(torso);

  const jw = 0.92 + R() * 0.16;
  add(torso, G.dome, mats.wrap, 'body').scale.set(jw, 1, jw);
  add(torso, G.belly, mats.wrapDark, 'body').scale.set(jw, 1, jw);
  // 双天线（合并单几何）：细长突出物 noHit——否则一根细杆把躯干盒顶撑高
  const ant = add(torso, G.antenna, mats.accent, 'body');
  ant.position.set(0, P.shellH * 0.56, -P.shellD * 0.13);
  ant.userData.noHit = true;
  // 背部警示小灯：贴在壳顶后缘（贴身件，保留判定）
  add(torso, G.beacon, mats.eye, 'body')
    .position.set(-P.shellW * 0.18 * jw, P.shellH * 0.62, -P.shellD * 0.16);

  // --- 眼塔：头位（J.NECK），抬起/扫视是动画值 ------------------------------
  // z 顶到穹顶前缘之外（头盒必须探出躯干剪影，否则正面射线永远先中躯干——
  // crawler 的头位同款考量）
  const neck = new THREE.Group();
  neck.position.set(0, P.shellH * 0.25, P.shellD * 0.72);
  torso.add(neck);
  add(neck, G.turret, mats.deep, 'head');
  add(neck, G.eye, mats.eye, 'head');
  add(neck, G.eyeCluster, mats.eye, 'head');   // 复眼簇贴面，不撑头盒
  add(neck, G.turretCap, mats.wrap, 'head');

  // --- 四条细腿：静态 mount 扛外张（烘进几何），注册关节只扛动画 -----------
  // 契约同 buildCrawler：arms = 前肢（SH/EL 槽），legs = 后肢（HIP/KNEE 槽）
  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    const mountA = new THREE.Group();
    mountA.position.set(side * P.shellW * 0.52 * jw, -P.shellH * 0.1, P.shellD * 0.28);
    mountA.rotation.z = side * P.splayArm;
    mountA.rotation.y = -side * 0.15;
    torso.add(mountA);
    const shoulder = new THREE.Group();
    mountA.add(shoulder);
    add(shoulder, G.thigh, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -P.thighL;
    shoulder.add(elbow);
    add(elbow, G.shin, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });

    const mountL = new THREE.Group();
    mountL.position.set(side * P.shellW * 0.48 * jw, -P.shellH * 0.14, -P.shellD * 0.30);
    mountL.rotation.z = side * P.splayLeg;
    mountL.rotation.y = side * 0.32;
    torso.add(mountL);
    const hip = new THREE.Group();
    mountL.add(hip);
    add(hip, G.thigh, mats.wrap, 'body');
    const knee = new THREE.Group();
    knee.position.y = -P.thighL;
    hip.add(knee);
    add(knee, G.shin, mats.wrapDark, 'body');
    legs.push({ hip, knee, side });
  }

  const blob = contactShadow((spec.radius ?? 0.3) * 1.9);
  blob.position.y = 0.02;
  group.add(blob);

  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters: [], meshes,
    triangles: count(), asym, lead: 1, blob,
    stepSpan: 2 * (P.thighL + P.shinL) * 0.8,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

export const TICKBOT = {
  id: 'tickbot',
  name: 'Tickbot',
  texSeed: 0,            // stencil 风格：三角箭头

  speed: 3.4,            // 小快灵：腿短步频高，斜穿怪海
  scale: 1.0,
  height: 0.45,
  radius: 0.28,

  palette: {
    wrap: 0x9aa2a8,      // 钢灰装甲
    wrapDark: 0x9ba3ac,  // 银灰执行器（原近黑，v2 用户要求肢体银灰）
    deep: 0x0e1013,
    eye: 0xff4020,       // 红色独眼——最小型号用最凶的眼
    eyeGlow: 1.1,        // 再高会把独眼曝成平橙块（截图实证 2.4/1.8/1.4 都糊）
    accent: 0x8a6a34,    // 黄铜天线
  },

  proportions: {
    rideHeight: 0.19,
    shellW: 0.30, shellH: 0.20, shellD: 0.34,
    eyeW: 0.115, eyeH: 0.075,
    headH: 0.12,                    // index.html 黄点探针契约字段（眼塔高）
    legW: 0.042, thighL: 0.19, shinL: 0.23,
    splayArm: 2.05, splayLeg: 1.95,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    crawl: true,         // 完全复用 fillCrawlJoints / animateCrawler 公式
    rate: 1.7,           // 捣步快——小机体靠频率读出「快」
    stride: 0.50,
    lift: 0.34,
    flex: 0.60,
    elBend: 2.45,        // 前肢静止反折角（动画每帧还原，bake 归零）
    knBend: 2.30,
    swayRoll: 0.05,
    swayYaw: 0.05,
    bob: 0.018,
    headUp: -0.35,       // 眼塔微抬朝前
    headScan: 0.8,       // 错拍扫视：小机器的「警觉」
  },

  build: buildTickbot,
  animate: animateCrawler,
};

// ---------------------------------------------------------------------------
// 物种二：蛛卫 spiderbot —— 人形蜘蛛（直立人形躯干 + 双臂 + 六条蜘蛛腿）
// 六腿 = 双腿槽 + LEG2 + LEG3（bake.js 扩展关节位 12-19），静态 mount 烘外张，
// tripod 步态由 animateSpiderbot / fillSpiderJoints 同款公式驱动。
// ---------------------------------------------------------------------------

const SPIDGEO = new Map();

function spiderbotGeometry(P) {
  let out = SPIDGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};

  {
    // 下腹舱（wrapDark）：六腿的挂载鼓包，垂在髋下
    const p = parts(T);
    p.box(P.pelvisW, P.pelvisH, P.pelvisD, { y: -P.pelvisH * 0.15, top: 0.95, bottom: 0.8 });
    out.pelvis = p.build();
  }
  {
    // 人形胸甲（wrap）：肩宽腰收 taper + 胸前反应甲板（accent 框 + eye 发光核）
    const p = parts(T);
    p.box(P.torsoW, P.torsoH, P.torsoD, { y: P.torsoH * 0.5, top: 1.0, bottom: 0.68 });
    out.torso = p.build();

    const pa = parts(T);
    pa.box(P.torsoW * 0.52, P.torsoH * 0.30, 0.035,
      { y: P.torsoH * 0.62, z: P.torsoD * 0.52, top: 0.85, bottom: 1.0, chamfer: 0.008 });
    out.chestCore = pa.build();

    // 胸口发光核心：eye 槽小块嵌进 accent 甲板框里（贴面件，不撑躯干盒）
    const pg = parts(T);
    pg.box(P.torsoW * 0.34, P.torsoH * 0.16, 0.022,
      { y: P.torsoH * 0.62, z: P.torsoD * 0.545, chamfer: 0.006 });
    out.coreGlow = pg.build();

    const pd = parts(T);
    pd.box(P.torsoW * 0.7, P.torsoH * 0.16, P.torsoD * 0.9, { y: P.torsoH * 0.10, top: 1.0, bottom: 0.9 });
    out.waist = pd.build();
  }
  {
    // 蜘蛛脸传感头：deep 颅座 + wrap 顶甲 + 两排复眼点阵（eye，上 4 下 2）
    // + 下颚双机械獠牙（deep，noHit）+ 头两侧传感器短角（wrapDark，noHit）。
    // 正面读法必须一眼「蜘蛛脸」：复眼点阵取代旧横视带。
    const p = parts(T);
    p.box(P.headW, P.headH, P.headD, { y: P.headH * 0.5, top: 0.92, bottom: 1.0 });
    out.skull = p.build();

    const pc = parts(T);
    pc.box(P.headW * 1.04, P.headH * 0.34, P.headD * 1.02, { y: P.headH * 0.88, top: 0.8, bottom: 1.0 });
    out.crown = pc.build();

    const pe = parts(T);
    for (let k = 0; k < 4; k++) {   // 上排 4 点
      pe.box(0.026, 0.024, 0.026,
        { x: (k - 1.5) * P.headW * 0.22, y: P.headH * 0.58, z: P.headD * 0.52, chamfer: 0.005 });
    }
    for (const s of [-1, 1]) {      // 下排 2 点（稍大，主眼读法）
      pe.box(0.034, 0.030, 0.026,
        { x: s * P.headW * 0.17, y: P.headH * 0.38, z: P.headD * 0.52, chamfer: 0.005 });
    }
    out.visor = pe.build();

    // 下颚双獠牙/钳须：向前下探的弯杆（两段折角），细长突出物 noHit
    const pf = parts(T);
    for (const s of [-1, 1]) {
      pf.box(0.024, P.headH * 0.34, 0.030,
        { x: s * P.headW * 0.20, y: P.headH * 0.02, z: P.headD * 0.44, rx: 0.55, chamfer: 0.004 });
      pf.box(0.018, P.headH * 0.22, 0.022,
        { x: s * P.headW * 0.20, y: -P.headH * 0.16, z: P.headD * 0.55, rx: -0.25, chamfer: 0.003 });
    }
    out.fangs = pf.build();

    // 头两侧传感器短角：斜向后上的短杆，细长突出物 noHit
    const ph = parts(T);
    for (const s of [-1, 1]) {
      ph.box(0.018, 0.018, P.headD * 0.55,
        { x: s * P.headW * 0.52, y: P.headH * 0.74, z: -P.headD * 0.10, ry: s * 0.5, rx: -0.3, chamfer: 0.003 });
    }
    out.horns = ph.build();
  }
  {
    // 手臂：上臂（wrap）/ 前臂 + 双指钳（wrapDark + accent 钳尖）
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW * 1.05, { y: -P.upperL / 2, top: 1.05, bottom: 0.8 });
    out.upper = p.build();

    const pf = parts(T);
    pf.box(P.armW * 0.82, P.foreL, P.armW * 0.85, { y: -P.foreL / 2, top: 1.05, bottom: 0.7 });
    out.fore = pf.build();

    const pc2 = parts(T);
    for (const s of [-1, 1]) {
      pc2.box(P.armW * 0.30, P.armW * 1.6, P.armW * 0.42,
        { x: s * P.armW * 0.30, y: -P.foreL - P.armW * 0.7, z: 0.01, rx: s * 0.18, chamfer: 0.005 });
    }
    out.claw = pc2.build();
  }
  {
    // 蜘蛛腿：股节（wrap，粗短）/ 胫节（wrapDark，细长 + 尖端足）
    // + accent 色环（每条腿膝下一节，跟着腿关节走的机型识别环）
    const p = parts(T);
    p.box(P.legW * 1.25, P.thighL, P.legW * 1.3, { y: -P.thighL / 2, top: 1.1, bottom: 0.72 });
    out.femur = p.build();

    const pt = parts(T);
    pt.box(P.legW * 0.72, P.shinL, P.legW * 0.75, { y: -P.shinL / 2, top: 1.1, bottom: 0.42 });
    pt.box(P.legW * 0.5, 0.09, P.legW * 0.6, { y: -P.shinL - 0.03, top: 0.8, bottom: 0.3, chamfer: 0.004 });
    out.tibia = pt.build();

    const pr = parts(T);
    pr.box(P.legW * 1.05, 0.030, P.legW * 1.1, { y: -0.10, chamfer: 0.005 });
    out.legRing = pr.build();
  }

  SPIDGEO.set(P, out);
  return out;
}

export function buildSpiderbot(spec, mats, actor) {
  const P = spec.proportions;
  const G = spiderbotGeometry(P);
  const { meshes, add, count } = mkActorTools(spec, mats, actor);

  // R = 逐实例随机：本函数只经 spec.build 在工厂（createRobot）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();               // J.HIPS：六腿直接挂这里
  hips.position.y = P.rideHeight;
  body.add(hips);
  const torso = new THREE.Group();              // J.TORSO：人形上半身
  torso.position.set(0, P.pelvisH * 0.30, P.pelvisD * 0.10);
  hips.add(torso);

  const jw = 0.92 + R() * 0.16;
  add(hips, G.pelvis, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.waist, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.chestCore, mats.accent, 'body').scale.set(jw, 1, 1);
  add(torso, G.coreGlow, mats.eye, 'body').scale.set(jw, 1, 1);

  // --- 蜘蛛脸传感头 -----------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.set(0, P.torsoH + 0.02, 0);
  torso.add(neck);
  add(neck, G.skull, mats.deep, 'head');
  add(neck, G.crown, mats.wrap, 'head');
  add(neck, G.visor, mats.eye, 'head');                    // 复眼点阵（贴面）
  add(neck, G.fangs, mats.deep, 'head').userData.noHit = true;   // 獠牙：细长件
  add(neck, G.horns, mats.wrapDark, 'head').userData.noHit = true; // 传感短角

  // --- 六条蜘蛛腿：三对，静态 mount 烘外张 + 前后偏航展开 -------------------
  // legs[0/1]=前对（HIP 槽）legs[2/3]=中对（LEG2 槽）legs[4/5]=后对（LEG3 槽），
  // L 偶 R 奇——与 bake.js jmap、fillSpiderJoints 的 LEGS 表同序。
  const legs = [];
  const rowZ = [P.legRowZ, 0, -P.legRowZ];
  const rowYaw = [1, 0, -1];                // 前对朝前、后对朝后（× legRowYaw）
  for (let r = 0; r < 3; r++) {
    for (const side of [-1, 1]) {
      const mount = new THREE.Group();
      mount.position.set(side * P.pelvisW * 0.60 * jw, -P.pelvisH * 0.10, rowZ[r]);
      mount.rotation.y = -side * rowYaw[r] * P.legRowYaw;
      mount.rotation.z = side * P.legSplay;   // 大腿指向外上（拐点高过腹线）
      hips.add(mount);
      const hip = new THREE.Group();
      mount.add(hip);
      add(hip, G.femur, mats.wrap, 'body');
      const knee = new THREE.Group();
      knee.position.y = -P.thighL;
      hip.add(knee);
      add(knee, G.tibia, mats.wrapDark, 'body');
      add(knee, G.legRing, mats.accent, 'body');   // 膝下识别环，随腿关节走
      legs.push({ hip, knee, side });
    }
  }

  // --- 双臂：人形位，带钳 ----------------------------------------------------
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.torsoW * 0.56 * jw, P.torsoH * 0.86, 0.02);
    torso.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL;
    shoulder.add(elbow);
    add(elbow, G.fore, mats.wrapDark, 'body');
    add(elbow, G.claw, mats.accent, 'body');
    arms.push({ shoulder, elbow, side });
  }

  const blob = contactShadow((spec.radius ?? 0.6) * 1.6);
  blob.position.y = 0.02;
  group.add(blob);

  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters: [], meshes,
    triangles: count(), asym, lead: 1, blob,
    // 外张腿的有效步幅 ≈ 腿展开的竖直分量摆动，比全长小得多
    stepSpan: 2 * (P.thighL + P.shinL) * 0.42,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

/**
 * 六足 tripod 步态（与 src/gait.js fillSpiderJoints 逐行对应）。
 * 相位表同壳体六足系：第 r 对 + 侧别 → off = (r + (side<0?0:1)) % 2 · π。
 * 前后扒走 hip.rotation.x（外张腿以竖直分量换算步幅，crawler 实证同款），
 * 抬腿走 hip.rotation.z（沿外张轴），膝的静止反折角 g.knBend 每帧还原。
 */
export function animateSpiderbot(rig, spec, s) {
  const g = spec.gait;
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * (rig.gait ? rig.gait.stride : 1) * (0.35 + 0.65 * drive);
  // 攻击/受击（与 src/gait.js fillSpiderJoints 逐行对应）：windup 扬起
  // 前对步足 + 后仰蓄力 → strike 前对下劈 + 躯干前压 + 钳臂挥扫；趔趄折进
  // hips/torso，hit 落点抽动打在传感头上。
  const wu = s.windup || 0, stk = s.strike || 0;
  const stg = s.stagger || 0;
  const sRoll = s.staggerRoll || 0, sPitch = s.staggerPitch || 0;
  const hk = s.hit || 0;

  for (let i = 0; i < 6; i++) {
    const limb = rig.legs[i];
    const side = limb.side;
    const r = i >> 1;
    const off = ((r + (side < 0 ? 0 : 1)) % 2) * Math.PI;
    const sw = Math.sin(p + off);
    const lift = Math.max(0, Math.cos(p + off));
    if (r === 0 && wu > 0) {              // 前对扬起（步态让位）
      limb.hip.rotation.x = sw * amp * (1 - wu) - 0.60 * wu;
      limb.hip.rotation.z = -side * (lift * g.lift * drive + wu * 0.80);
      limb.knee.rotation.z = -side * (g.knBend * (1 + wu * 0.30) + lift * g.flex * drive * (1 - wu));
    } else if (r === 0 && stk > 0) {      // 前对下劈
      limb.hip.rotation.x = 0.75 - 1.40 * stk;
      limb.hip.rotation.z = -side * 0.18 * stk;
      limb.knee.rotation.z = -side * g.knBend * (0.50 + 0.50 * stk);
    } else {
      limb.hip.rotation.x = sw * amp;
      limb.hip.rotation.z = -side * lift * g.lift * drive;
      limb.knee.rotation.z = -side * (g.knBend + lift * g.flex * drive);
    }
    limb.hip.rotation.y = 0;
    limb.knee.rotation.x = 0;
  }

  // 双臂：平时与对侧前腿反相的攻击性摆动（钳臂前探，收放像捕猎）；
  // 攻击时被前摇/挥击整个接管（结构同人形 WINDUP_ARM/FOLLOW_ARM）
  const WINDUP_ARM = g.armReach - 0.8;
  const FOLLOW_ARM = 0.5;
  for (const arm of rig.arms) {
    const side = arm.side;
    if (wu > 0) {
      arm.shoulder.rotation.x = g.armReach + (WINDUP_ARM - g.armReach) * wu;
      arm.shoulder.rotation.z = side * (g.armSplay + wu * 0.35);
      arm.elbow.rotation.x = -g.elBend * (1 - wu) - 0.15;
    } else if (stk > 0) {
      arm.shoulder.rotation.x = FOLLOW_ARM + (WINDUP_ARM - FOLLOW_ARM) * stk;
      arm.shoulder.rotation.z = side * g.armSplay;
      arm.elbow.rotation.x = -0.10;
    } else {
      const off = side < 0 ? Math.PI : 0;
      const sw = Math.sin(p + off);
      arm.shoulder.rotation.x = g.armReach + sw * g.armSwing * drive;
      arm.shoulder.rotation.z = side * g.armSplay;
      arm.elbow.rotation.x = -g.elBend - Math.max(0, sw) * 0.2 * drive;
    }
    arm.shoulder.rotation.y = 0;
    arm.elbow.rotation.z = 0;
  }

  // 人形躯干随 tripod 支撑小幅拧滚；髋（腿鼓包）不动——六腿云台自稳。
  // 攻击：windup 后仰 / strike 前压。
  let torsoX = g.lean + Math.sin(p * 2) * 0.03 * drive;
  if (wu > 0) torsoX += wu * 0.25;
  else if (stk > 0) torsoX -= (1 - stk) * 0.35;
  torsoX += sPitch * 1.2;
  rig.hips.rotation.set(sPitch * 0.5, 0, sRoll * 0.5);   // 趔趄折进 hips（复算侧同款）
  rig.torso.rotation.x = torsoX;
  rig.torso.rotation.y = Math.sin(p) * g.swayYaw * drive;
  rig.torso.rotation.z = Math.sin(p) * g.swayRoll * drive + sRoll * 1.2;
  rig.body.position.y = Math.abs(Math.sin(p)) * g.bob * drive
    + wu * 0.05 - (stk > 0 ? (1 - stk) * 0.05 : 0) - stg * 0.05;
  rig.body.rotation.set(0, 0, 0);

  rig.neck.rotation.x = g.headDroop + Math.sin(p * 2) * 0.05 * drive + hk * 0.45;
  rig.neck.rotation.y = Math.sin(p * 0.47) * g.headScan;
  rig.neck.rotation.z = 0;
}

export const SPIDERBOT = {
  id: 'spiderbot',
  name: 'Spiderbot',
  texSeed: 1,            // stencil 风格：条码

  speed: 2.2,
  scale: 1.0,
  height: 1.6,
  radius: 0.62,

  palette: {
    wrap: 0x8f979e,
    wrapDark: 0x98a0aa,
    deep: 0x0d0f12,
    eye: 0xffb02a,       // 琥珀视带
    eyeGlow: 2.0,
    accent: 0x7d5f2e,
  },

  proportions: {
    rideHeight: 0.93,
    pelvisW: 0.38, pelvisH: 0.26, pelvisD: 0.44,
    torsoW: 0.46, torsoH: 0.52, torsoD: 0.30,
    headW: 0.22, headH: 0.24, headD: 0.24,
    armW: 0.10, upperL: 0.38, foreL: 0.40,
    legW: 0.075, thighL: 0.55, shinL: 0.72,
    legSplay: 1.15,      // 大腿外张（指外上，拐点高过腹线）
    legRowZ: 0.20, legRowYaw: 0.55,
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'spider',      // src/gait.js 分派到 fillSpiderJoints
    rate: 1.0,
    stride: 0.50,
    lift: 0.30,          // 摆动半拍沿外张轴抬腿
    flex: 0.50,          // 摆动时胫节收拢
    knBend: 1.10,        // 膝静止反折角（动画每帧还原，bake 归零）
    armReach: -0.55,     // 钳臂前探
    armSwing: 0.30,
    armSplay: 0.20,
    elBend: 0.55,        // 前臂前折成钳（正值=向前，螳臂读法）
    lean: -0.10,
    swayRoll: 0.04,
    swayYaw: 0.06,
    bob: 0.035,
    headDroop: -0.05,
    headScan: 0.35,
  },

  build: buildSpiderbot,
  animate: animateSpiderbot,
};

// ---------------------------------------------------------------------------
// 物种三：半人马 centaurbot —— 马身四腿 + 前端竖人身 + 四条手臂
// 四腿 = 双腿槽（前对）+ LEG2（后对），四臂 = 双臂槽 + ARM2（胸下短臂）。
// ---------------------------------------------------------------------------

const CENTGEO = new Map();

function centaurbotGeometry(P) {
  let out = CENTGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};

  {
    // 马身：主躯干（wrap）+ 后躯发动机舱（wrapDark）+ 背脊散热条（accent）
    const p = parts(T);
    p.box(P.bodyW, P.bodyH, P.bodyL * 0.72, { z: -P.bodyL * 0.06, top: 0.94, bottom: 1.0 });
    p.box(P.bodyW * 0.86, P.bodyH * 0.8, P.bodyL * 0.30, { z: P.bodyL * 0.33, top: 0.9, bottom: 1.0 });
    out.barrel = p.build();

    const ph = parts(T);
    ph.box(P.bodyW * 0.88, P.bodyH * 0.86, P.bodyL * 0.30,
      { z: -P.bodyL * 0.40, top: 0.92, bottom: 1.0 });
    out.haunch = ph.build();

    const pf = parts(T);
    for (const s of [-1, 1]) {
      pf.box(0.03, 0.05, P.bodyL * 0.5, { x: s * P.bodyW * 0.30, y: P.bodyH * 0.52, z: -P.bodyL * 0.1, chamfer: 0.008 });
    }
    out.vents = pf.build();
  }
  {
    // 人身胸甲（wrap）+ 腰环（wrapDark）+ 胸核（accent）+ 黄铜徽记板
    const p = parts(T);
    p.box(P.chestW, P.chestH, P.chestD, { y: P.chestH * 0.5, top: 1.0, bottom: 0.7 });
    out.torso = p.build();

    const pw = parts(T);
    pw.box(P.chestW * 1.05, P.chestH * 0.14, P.chestD * 1.05, { y: P.chestH * 0.06, top: 1.0, bottom: 0.9 });
    out.waistRing = pw.build();

    const pc = parts(T);
    pc.box(P.chestW * 0.44, P.chestH * 0.26, 0.035,
      { y: P.chestH * 0.60, z: P.chestD * 0.52, chamfer: 0.008 });
    out.core = pc.build();

    // 胸前徽记板：accent 黄铜菱形挂牌（rz 45°），叠在胸核上方——骑士纹章读法
    const pe2 = parts(T);
    pe2.box(P.chestW * 0.20, P.chestW * 0.20, 0.020,
      { y: P.chestH * 0.80, z: P.chestD * 0.53, rz: Math.PI / 4, chamfer: 0.006 });
    out.emblem = pe2.build();

    // 双肩甲片（wrap）：覆在主肩上的拱瓦，贴身件保留判定
    const pp = parts(T);
    pp.box(P.chestW * 0.34, P.chestH * 0.15, P.chestD * 0.85,
      { y: 0.015, rz: 0.10, top: 0.82, bottom: 1.0, chamfer: 0.010 });
    out.pauldron = pp.build();
  }
  {
    // 马身两侧裙板（wrapDark）：遮住腿根的长挡板，贴身件
    const psk = parts(T);
    for (const s of [-1, 1]) {
      psk.box(0.030, P.bodyH * 0.50, P.bodyL * 0.46,
        { x: s * P.bodyW * 0.52, y: -P.bodyH * 0.12, z: -P.bodyL * 0.08, chamfer: 0.008 });
    }
    out.skirt = psk.build();
  }
  {
    // 骑士盔头：deep 颅座 + wrap 顶甲 + 纵向冠鳍（accent 黄铜 mohawk，
    // front-to-back，noHit）+ T 形目镜缝（eye，竖缝+横缝）+ 面甲呼吸
    // 格栅（deep 竖棱，贴面）。与蛛卫的方颅语言彻底分开。
    const p = parts(T);
    p.box(P.headW, P.headH, P.headD, { y: P.headH * 0.5, top: 0.92, bottom: 1.0 });
    out.skull = p.build();

    const pc2 = parts(T);
    pc2.box(P.headW * 1.04, P.headH * 0.32, P.headD * 1.02, { y: P.headH * 0.86, top: 0.8, bottom: 1.0 });
    out.crown = pc2.build();

    // T 形目镜缝：横缝 + 中竖缝（骑士盔目缝读法），贴面件
    const pe = parts(T);
    pe.box(P.headW * 0.80, 0.024, 0.024,
      { y: P.headH * 0.56, z: P.headD * 0.52, chamfer: 0.004 });
    pe.box(0.028, P.headH * 0.34, 0.024,
      { y: P.headH * 0.38, z: P.headD * 0.52, chamfer: 0.004 });
    out.visor = pe.build();

    // 纵向冠鳍：薄鳍片沿中线 front-to-back 立在顶甲上，前高后低，noHit
    const pf2 = parts(T);
    pf2.box(0.022, P.headH * 0.42, P.headD * 1.04,
      { y: P.headH * 1.14, z: -P.headD * 0.02, depthTop: 1.0, depthBottom: 1.0, top: 1.0, bottom: 0.9, chamfer: 0.004 });
    out.crest = pf2.build();

    // 面甲呼吸格栅：下脸四条竖棱（贴面件，不撑头盒）
    const pg = parts(T);
    for (let k = 0; k < 4; k++) {
      pg.box(0.013, P.headH * 0.20, 0.018,
        { x: (k - 1.5) * P.headW * 0.17, y: P.headH * 0.13, z: P.headD * 0.515, chamfer: 0.002 });
    }
    out.grille = pg.build();
  }
  {
    // 主臂（wrap 上臂 / wrapDark 前臂 + 方块拳）与副臂（整套细一号 + 钳）
    const p = parts(T);
    p.box(P.armW, P.upperL, P.armW * 1.05, { y: -P.upperL / 2, top: 1.05, bottom: 0.8 });
    out.upper = p.build();

    const pf2 = parts(T);
    pf2.box(P.armW * 0.82, P.foreL, P.armW * 0.85, { y: -P.foreL / 2, top: 1.05, bottom: 0.72 });
    pf2.box(P.armW * 1.1, P.armW * 1.1, P.armW * 1.2, { y: -P.foreL - P.armW * 0.4, chamfer: 0.01 });
    out.fore = pf2.build();

    const p2 = parts(T);
    p2.box(P.arm2W, P.upper2L, P.arm2W * 1.05, { y: -P.upper2L / 2, top: 1.05, bottom: 0.8 });
    out.upper2 = p2.build();

    const pf3 = parts(T);
    pf3.box(P.arm2W * 0.8, P.fore2L, P.arm2W * 0.85, { y: -P.fore2L / 2, top: 1.05, bottom: 0.7 });
    for (const s of [-1, 1]) {
      pf3.box(P.arm2W * 0.32, P.arm2W * 1.5, P.arm2W * 0.4,
        { x: s * P.arm2W * 0.28, y: -P.fore2L - P.arm2W * 0.6, rx: s * 0.2, chamfer: 0.004 });
    }
    out.fore2 = pf3.build();
  }
  {
    // 马腿：大腿（wrap）/ 小腿 + 蹄块（wrapDark + accent 蹄）
    const p = parts(T);
    p.box(P.legW * 1.15, P.thighL, P.legW * 1.3, { y: -P.thighL / 2, top: 1.1, bottom: 0.75 });
    out.thigh = p.build();

    const ps = parts(T);
    ps.box(P.legW * 0.8, P.shinL, P.legW * 0.9, { y: -P.shinL / 2, top: 1.05, bottom: 0.62 });
    ps.box(P.legW * 1.05, 0.07, P.legW * 1.5, { y: -P.shinL - 0.02, z: 0.02, chamfer: 0.008 });
    out.shin = ps.build();
  }

  CENTGEO.set(P, out);
  return out;
}

export function buildCentaurbot(spec, mats, actor) {
  const P = spec.proportions;
  const G = centaurbotGeometry(P);
  const { meshes, add, count } = mkActorTools(spec, mats, actor);

  // R = 逐实例随机：本函数只经 spec.build 在工厂（createRobot）内被调，
  // 工厂已用 withSeed 把 Math.random 换成实例种子流（rng.js），故保持原样。
  const R = () => Math.random();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hips = new THREE.Group();               // J.HIPS：马身（含四条腿）
  hips.position.y = P.bodyY;
  body.add(hips);

  const jw = 0.92 + R() * 0.16;
  add(hips, G.barrel, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(hips, G.haunch, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(hips, G.vents, mats.accent, 'body');
  add(hips, G.skirt, mats.wrapDark, 'body').scale.set(jw, 1, 1);   // 两侧裙板

  // --- 四条马腿：前对 z+（HIP 槽）、后对 z-（LEG2 槽），L 偶 R 奇 -----------
  // 腿近垂直，外张很小（烘进 mount），走姿只动 hip.x / knee.x
  const legs = [];
  for (let r = 0; r < 2; r++) {
    const rz = r === 0 ? P.legFrontZ : P.legRearZ;
    for (const side of [-1, 1]) {
      const mount = new THREE.Group();
      mount.position.set(side * P.legX * jw, -P.bodyH * 0.30, rz);
      mount.rotation.z = side * P.legSplay;
      hips.add(mount);
      const hip = new THREE.Group();
      mount.add(hip);
      add(hip, G.thigh, mats.wrap, 'body');
      const knee = new THREE.Group();
      knee.position.y = -P.thighL;
      hip.add(knee);
      add(knee, G.shin, mats.wrapDark, 'body');
      legs.push({ hip, knee, side });
    }
  }

  // --- 人身：竖在马身前端（J.TORSO），上载双臂槽主臂 + ARM2 副臂 ------------
  const torso = new THREE.Group();
  torso.position.set(0, P.bodyH * 0.52, P.bodyL * 0.30);
  hips.add(torso);
  add(torso, G.torso, mats.wrap, 'body').scale.set(jw, 1, 1);
  add(torso, G.waistRing, mats.wrapDark, 'body').scale.set(jw, 1, 1);
  add(torso, G.core, mats.accent, 'body').scale.set(jw, 1, 1);
  add(torso, G.emblem, mats.accent, 'body').scale.set(jw, 1, 1);   // 黄铜徽记板

  const neck = new THREE.Group();
  neck.position.set(0, P.chestH + 0.02, 0);
  torso.add(neck);
  add(neck, G.skull, mats.deep, 'head');
  add(neck, G.crown, mats.wrap, 'head');
  add(neck, G.visor, mats.eye, 'head');                        // T 形目镜缝
  add(neck, G.grille, mats.deep, 'head');                      // 呼吸格栅（贴面）
  add(neck, G.crest, mats.accent, 'head').userData.noHit = true; // 冠鳍：细长件

  // 四条手臂：arms[0/1] = 主臂（SH/EL 槽，肩位），arms[2/3] = 副臂
  // （ARM2/EL2 槽，胸下低位，短一截带钳）——与 bake jmap / fillCentaurJoints 同序
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.chestW * 0.56 * jw, P.chestH * 0.84, 0.02);
    torso.add(shoulder);
    add(shoulder, G.upper, mats.wrap, 'body');
    // 肩甲片：覆在肩关节上的拱瓦，随主臂摆动（贴身件保留判定）
    add(shoulder, G.pauldron, mats.wrap, 'body')
      .position.set(side * P.armW * 0.30, P.armW * 0.55, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL;
    shoulder.add(elbow);
    add(elbow, G.fore, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.chestW * 0.50 * jw, P.chestH * 0.34, 0.04);
    torso.add(shoulder);
    add(shoulder, G.upper2, mats.wrap, 'body');
    const elbow = new THREE.Group();
    elbow.position.y = -P.upper2L;
    shoulder.add(elbow);
    add(elbow, G.fore2, mats.wrapDark, 'body');
    arms.push({ shoulder, elbow, side });
  }

  const blob = contactShadow((spec.radius ?? 0.8) * 1.5);
  blob.position.y = 0.02;
  group.add(blob);

  const asym = { scale: 0.90 + R() * 0.20, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, hips, torso, neck, legs, arms, tatters: [], meshes,
    triangles: count(), asym, lead: 1, blob,
    stepSpan: 2 * (P.thighL + P.shinL) * 0.8,
    gait: { stride: 0.9 + R() * 0.2, swing: 1 },
  };
}

/**
 * 四足对角走姿（trot，与 src/gait.js fillCentaurJoints 逐行对应）：
 * 左前+右后同相、右前+左后反相。马身随对角支撑拧滚（HIPS），人身反相位
 * 稳定（TORSO），四臂攻击性摆动（副臂错相位 0.9）。
 */
export function animateCentaurbot(rig, spec, s) {
  const g = spec.gait;
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * (rig.gait ? rig.gait.stride : 1) * (0.35 + 0.65 * drive);
  // 攻击/受击（与 src/gait.js fillCentaurJoints 逐行对应）：骑士抡槊——
  // windup 人身立起上探 + 四臂张开举过肩线 → strike 四臂一齐抡劈 + 人前压；
  // 趔趄折进 hips/torso，hit 落点抽动打在骑士盔头上。
  const wu = s.windup || 0, stk = s.strike || 0;
  const stg = s.stagger || 0;
  const sRoll = s.staggerRoll || 0, sPitch = s.staggerPitch || 0;
  const hk = s.hit || 0;

  // 对角对：legs[0]=左前 legs[1]=右前 legs[2]=左后 legs[3]=右后
  const offs = [0, Math.PI, Math.PI, 0];
  for (let i = 0; i < 4; i++) {
    const limb = rig.legs[i];
    const sw = Math.sin(p + offs[i]);
    const lift = Math.max(0, Math.cos(p + offs[i]));
    limb.hip.rotation.x = sw * amp;
    limb.hip.rotation.y = 0;
    limb.hip.rotation.z = 0;
    limb.knee.rotation.x = g.knBend + lift * g.flex * drive;
    limb.knee.rotation.z = 0;
  }

  // 四臂：平时主/副各成反相摆；攻击时被前摇/挥击整个接管（副臂幅度小一号）
  for (let ai = 0; ai < rig.arms.length; ai++) {
    const arm = rig.arms[ai];
    const side = arm.side;
    const sub = ai >= 2;
    const reach = sub ? g.arm2Reach : g.armReach;
    const bend = sub ? g.el2Bend : g.elBend;
    const splay = sub ? g.arm2Splay : g.armSplay;
    if (wu > 0) {
      const wArm = reach - (sub ? 0.55 : 0.90);
      arm.shoulder.rotation.x = reach + (wArm - reach) * wu;
      arm.shoulder.rotation.z = side * (splay + wu * 0.40);
      arm.elbow.rotation.x = -bend * (1 - wu) - 0.15;
    } else if (stk > 0) {
      const wArm = reach - (sub ? 0.55 : 0.90);
      const fArm = sub ? 0.35 : 0.50;
      arm.shoulder.rotation.x = fArm + (wArm - fArm) * stk;
      arm.shoulder.rotation.z = side * splay;
      arm.elbow.rotation.x = -0.12;
    } else {
      const off = side < 0 ? Math.PI : 0;
      const sw = Math.sin(p + off + (sub ? 0.9 : 0));
      arm.shoulder.rotation.x = reach + sw * (sub ? g.arm2Swing : g.armSwing) * drive;
      arm.shoulder.rotation.z = side * splay;
      arm.elbow.rotation.x = -bend - Math.max(0, sw) * 0.2 * drive;
    }
    arm.shoulder.rotation.y = 0;
    arm.elbow.rotation.z = 0;
  }

  // 马身拧滚 + 人身反相位稳定 + 头扫视。攻击：windup 人身后仰立起 /
  // strike 人前压进；人身上探走 bob（body.position.y）。
  let torsoX = g.lean + Math.sin(p * 2) * 0.04 * drive;
  if (wu > 0) torsoX += wu * 0.22;
  else if (stk > 0) torsoX -= (1 - stk) * 0.32;
  torsoX += sPitch * 1.2;
  rig.hips.rotation.x = Math.sin(p * 2) * 0.03 * drive + sPitch * 0.5;
  rig.hips.rotation.y = 0;
  rig.hips.rotation.z = Math.sin(p) * g.swayRoll * drive + sRoll * 0.5;
  rig.torso.rotation.x = torsoX;
  rig.torso.rotation.y = Math.sin(p) * g.swayYaw * drive;
  rig.torso.rotation.z = -Math.sin(p) * g.swayRoll * 0.5 * drive + sRoll * 1.2;
  rig.body.position.y = Math.abs(Math.sin(p)) * g.bob * drive
    + wu * 0.06 - (stk > 0 ? (1 - stk) * 0.04 : 0) - stg * 0.05;
  rig.body.rotation.set(0, 0, 0);

  rig.neck.rotation.x = g.headDroop + Math.sin(p * 2) * 0.05 * drive + hk * 0.45;
  rig.neck.rotation.y = Math.sin(p * 0.47) * g.headScan;
  rig.neck.rotation.z = 0;
}

export const CENTAURBOT = {
  id: 'centaurbot',
  name: 'Centaurbot',
  texSeed: 2,            // stencil 风格：伪数字方块

  speed: 2.8,
  scale: 1.08,
  height: 2.4,
  radius: 0.85,

  palette: {
    wrap: 0x939a90,      // 偏军绿的钢
    wrapDark: 0x9fa6ad,
    deep: 0x0d0f12,
    eye: 0x2ad4ff,       // 青色视带——唯一冷色机
    eyeGlow: 2.0,
    accent: 0x7d5f2e,
  },

  proportions: {
    bodyY: 1.05,                            // 马身中心高（foot ≈ 1.05-thighL-shinL ≈ 0）
    bodyW: 0.60, bodyH: 0.52, bodyL: 1.30,
    chestW: 0.46, chestH: 0.58, chestD: 0.30,
    headW: 0.21, headH: 0.23, headD: 0.23,
    armW: 0.095, upperL: 0.36, foreL: 0.38,
    arm2W: 0.068, upper2L: 0.26, fore2L: 0.28,
    legW: 0.10, thighL: 0.52, shinL: 0.53,
    legX: 0.26, legFrontZ: 0.42, legRearZ: -0.58,
    legSplay: 0.06,                         // 马腿近垂直，微外张烘进 mount
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    kind: 'centaur',     // src/gait.js 分派到 fillCentaurJoints
    rate: 0.85,
    stride: 0.50,
    knBend: 0.12,        // 马腿膝的小幅常弯
    flex: 0.85,          // 摆动抬折
    swayRoll: 0.06,
    swayYaw: 0.05,
    lean: -0.04,
    bob: 0.05,
    armReach: -0.35,     // 主臂前探
    armSwing: 0.35,
    armSplay: 0.18,
    elBend: 0.50,
    arm2Reach: -0.15,    // 副臂收在胸前，钳朝前
    arm2Swing: 0.22,
    arm2Splay: 0.16,
    el2Bend: 0.80,
    headDroop: -0.02,
    headScan: 0.30,
  },

  build: buildCentaurbot,
  animate: animateCentaurbot,
};

// ---------------------------------------------------------------------------
// 物种四：泰坦 titan —— 巨型人形（core buildHumanoid 一行不碰，物种层后挂）
// buildTitan：先调 buildHumanoid 拿 rig，再往 rig.neck / rig.torso 上加件——
// 头顶天线阵列 + 耳部散热片 + 凶相目缝 + 肩后排气管组 + 胸口反应炉格栅。
// 后挂件全部用 mats 现有槽（wrapDark/deep/eye），不新增材质槽。
// 厚重 proportions（宽胸/粗腿/小头）+ 慢重步态，机器人材质全套。
// ---------------------------------------------------------------------------

const TITANGEO = new Map();

function titanGeometry(P) {
  let out = TITANGEO.get(P);
  if (out) return out;
  const T = WRAP_TILES;
  out = {};

  {
    // 凶相目缝：两段内低外高的斜缝拼出倒八眉（eye 槽，贴面件）
    const p = parts(T);
    for (const s of [-1, 1]) {
      p.box(P.headW * 0.52, 0.034, 0.026,
        { x: s * P.headW * 0.25, y: P.headH * 0.50, z: P.headD * 0.53, rz: s * 0.28, chamfer: 0.004 });
    }
    out.visorSlit = p.build();
  }
  {
    // 头顶/后脑天线阵列：3 根高低错落的细杆（wrapDark），细长突出物 noHit
    const p = parts(T);
    const rods = [[-0.05, 0.30, -0.06], [0.01, 0.20, -0.10], [0.07, 0.38, -0.04]];
    for (const [x, h, z] of rods) {
      p.box(0.012, h, 0.012,
        { x, y: P.headH * 0.96 + h / 2 - 0.02, z, rx: -0.10, chamfer: 0.003 });
    }
    // 杆尖小珠（仍有厂牌识别感）
    for (const [x, h, z] of rods) {
      p.box(0.022, 0.022, 0.022,
        { x, y: P.headH * 0.96 + h - 0.02 + 0.011, z, chamfer: 0.004 });
    }
    out.antennaArray = p.build();
  }
  {
    // 两侧耳部散热片：头侧竖立的薄鳍板组（wrapDark），薄片突出物 noHit
    const p = parts(T);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        p.box(0.016, P.headH * (0.46 - k * 0.07), P.headD * 0.34,
          { x: s * (P.headW * 0.5 + 0.006 + k * 0.018), y: P.headH * 0.48, z: -P.headD * 0.05, rz: s * -0.12, chamfer: 0.002 });
      }
    }
    out.earFins = p.build();
  }
  {
    // 肩部后排气管组：3 根粗短圆管烟囱（wrapDark，cyl 原语——原方烟囱的回改
    // 样例，prims.js），探出胸甲后上缘，noHit。底部半径放大横跨胸甲背面的
    // 逐实例宽度抖动（j.chestW 0.90~1.10），任何抖动下都与背面相交、不悬浮
    const p = prims(T);
    for (const x of [-0.17, 0, 0.17]) {
      p.cyl(0.052, 0.068, 0.26, { x, y: P.chestH * 1.10, z: -P.bodyD * 0.55, rx: -0.12, radial: 10 });
    }
    out.exhaust = p.build();
  }
  {
    // 胸口反应炉：deep 格栅框 + eye 三条发光栅条。框深 0.09 横跨胸甲
    // 正面宽度抖动（同排气管的理由），始终微凸出于胸面
    const p = parts(T);
    p.box(P.chestW * 0.42, P.chestH * 0.30, 0.09,
      { y: P.chestH * 0.52, z: P.bodyD * 0.45, chamfer: 0.010 });
    out.reactorFrame = p.build();

    const pg = parts(T);
    for (let k = 0; k < 3; k++) {
      pg.box(P.chestW * 0.30, 0.028, 0.05,
        { y: P.chestH * (0.44 + k * 0.08), z: P.bodyD * 0.51, chamfer: 0.004 });
    }
    out.reactorGlow = pg.build();
  }

  TITANGEO.set(P, out);
  return out;
}

/**
 * core buildHumanoid 的物种层包装：拿完整 rig 后后挂头部/身体装饰件。
 * 头件挂 rig.neck（region 'head'，随断头断肢子树一起飞）；天线/散热片/
 * 排气管等细长或探出件标 noHit，不撑碰撞盒。躯干件坐标按 P 直接算——
 * core 的逐实例胸宽抖动由「件深横跨抖动区间」吸收（见 titanGeometry 注释）。
 */
export function buildTitan(spec, mats, actor) {
  const rig = buildHumanoid(spec, mats, actor);
  const P = spec.proportions;
  const G = titanGeometry(P);
  const add = (parent, g, mat, region, noHit) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    m.userData.region = region;
    if (noHit) m.userData.noHit = true;
    m.castShadow = true;
    parent.add(m);
    rig.meshes.push(m);
    rig.triangles += g.attributes.position.count / 3;
    return m;
  };
  add(rig.neck, G.visorSlit, mats.eye, 'head');
  add(rig.neck, G.antennaArray, mats.wrapDark, 'head', true);
  add(rig.neck, G.earFins, mats.wrapDark, 'head', true);
  add(rig.torso, G.exhaust, mats.wrapDark, 'body', true);
  add(rig.torso, G.reactorFrame, mats.deep, 'body');
  add(rig.torso, G.reactorGlow, mats.eye, 'body');
  return rig;
}

export const TITAN = {
  id: 'titan',
  name: 'Titan',
  texSeed: 3,            // stencil 风格：折角 chevron

  speed: 1.2,
  scale: 3.0,            // × 逐实例抖动后 4.9~6.3m
  height: 5.7,
  radius: 1.15,

  palette: {
    wrap: 0x878e96,      // 冷灰重甲
    wrapDark: 0x939ba4,
    deep: 0x0c0e10,
    eye: 0xff7a1a,       // 熔橙——炉膛色
    eyeGlow: 1.7,        // 大体型发光面积已够，强度压一档防过曝
    accent: 0x6e5628,
  },

  proportions: {
    hipY: 0.95, hipW: 0.52, bodyD: 0.44,
    legX: 0.20, legW: 0.26, thighL: 0.46, shinL: 0.49,   // hipY=thighL+shinL，铁律
    torsoY: 0.12, chestW: 0.85, chestH: 0.62,
    shoulderX: 0.52, shoulderY: 0.50, armW: 0.24, upperL: 0.55, foreL: 0.58,
    headY: 0.68, headW: 0.20, headH: 0.24, headD: 0.22,  // 小头：巨物读法
    tatterRest: 0,
    tatters: [],
  },

  gait: {
    rate: 0.55,          // 低频重踏——巨物的慢就是分量
    stride: 0.50,
    armSwing: 0.18,      // 巨臂钟摆，不夸张
    armReach: 0.05,
    armSplay: 0.30,
    elbowBend: -0.08,
    lean: -0.06,
    sway: 0.10,
    hipTwist: 0.05,
    bob: 0.10,           // 每一步砸地的沉浮
    headLoll: 0.05,
    headDroop: -0.05,
  },

  build: buildTitan,
  animate: MUMMY.animate,
};
