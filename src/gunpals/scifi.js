// scifi.js — GunPalToolkit 弓家族程序化纹理与材质工具（canvas 生成，零外部资产）
//
// 收编自 mr-bow js/scifi.js（2026-08-26 视觉重做轮）：
//  - 确定性：花纹生成改走 mulberry32 播种流（种子 = pattern|palette 键哈希），
//    联机各端同 spec 纹理逐比特一致（旧版裸 Math.random 各端花纹不同）。
//  - 对比度强化：MR 暗背景下母题必须读得出——发光勾边/刻线全线加粗加密，
//    反照率明暗差拉大（旧版贴图对比度太低，龙鳞/卷草/脉络全看不见）。
//
// 花纹范式（patternTextures 按 key 缓存，同 key 共享一张 canvas 图像）：
//   circuit  科幻电路（装甲板/蜂窝/走线/警示带）
//   rivet    蒸汽铆接（拉丝黄铜/铆钉排/齿轮印/管件线）
//   vein     生体脉络（有机分叉血管/斑块）
//   crystal  冰晶切面（三角碎晶马赛克/霜蕨/晶缝）
//   carbon   战术碳纹（斜纹编织/模版喷字块）
//   filigree 圣金卷草（藤蔓卷须/小叶/金点）
//   scales   龙鳞（叠瓦鳞甲排/鳞缝魔光）
// 每个弓 spec（bows.js）给 palette { base, line, hi, glow } 换皮。
//
// 高金属度 PBR 必须有环境反射否则发黑——makeEnvTexture() 挂 scene.environment。
import * as THREE from 'three';
import { mulberry32, hashStr } from './actor.js';

const _texCache = new Map(); // key = pattern|base|line|hi|glow
let R = Math.random; // 花纹生成的随机流：patternTextures 内按 key 播种（确定性）

function finish(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function patternTextures(pattern, pal) {
  const key = [pattern, pal.base, pal.line, pal.hi, pal.glow].join('|');
  if (_texCache.has(key)) return _texCache.get(key);
  R = mulberry32(hashStr(key)); // 确定性播种（禁裸 Math.random：联机各端同纹）
  const w = 256, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  const e = c2.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  PATTERNS[pattern](g, e, w, h, pal);
  const emissive = new THREE.CanvasTexture(c2);
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  const out = { map: finish(c), emissive };
  _texCache.set(key, out);
  return out;
}

// ---------- 花纹范式（g = 反照率，e = 自发光） ----------
const PATTERNS = {
  // 科幻电路：装甲板 + 蜂窝 + 走线 + 警示带 + 面板缝
  circuit(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 128) { // 装甲板（明度交替 + 切角）
      g.fillStyle = (y / 128) % 2 ? 'rgba(235,242,252,0.5)' : 'rgba(30,40,58,0.5)';
      g.beginPath();
      g.moveTo(0, y + 10); g.lineTo(24, y); g.lineTo(w, y); g.lineTo(w, y + 118);
      g.lineTo(w - 24, y + 128); g.lineTo(0, y + 128);
      g.closePath(); g.fill();
    }
    const hexPath = (ctx, cx, cy, r) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i + Math.PI / 6;
        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    };
    for (const bandY of [170, 690]) { // 蜂窝带
      const r = 40;
      for (let row = -1; row < 4; row++) {
        for (let col = -1; col < 5; col++) {
          const cx = col * r * 1.75 + (row % 2 ? r * 0.87 : 0);
          const cy = bandY + row * r * 1.5;
          hexPath(g, cx, cy, r);
          if ((row + col) % 3 === 0) { g.fillStyle = 'rgba(52,72,104,0.7)'; g.fill(); }
          g.strokeStyle = 'rgba(20,28,44,1)'; g.lineWidth = 5; g.stroke();
          if ((row * 3 + col) % 4 === 0) {
            hexPath(e, cx, cy, r);
            e.strokeStyle = pal.glow; e.lineWidth = 5; e.stroke();
          }
        }
      }
    }
    const trace = (ctx, x0, y0, segs, lw) => {
      let x = x0, y = y0;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (const [dx, dy] of segs) { x += dx; y += dy; ctx.lineTo(x, y); }
      ctx.lineWidth = lw; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    };
    g.strokeStyle = pal.line; g.fillStyle = pal.line;
    e.strokeStyle = pal.glow; e.fillStyle = pal.glow;
    for (let i = 0; i < 26; i++) {
      const segs = [[40 + R() * 80, 0], [0, (R() - 0.5) * 80], [30 + R() * 60, 0]];
      trace(g, R() * w, R() * h, segs, 6);
      if (i % 2) trace(e, R() * w, R() * h, segs, 6);
    }
    g.save(); // 警示带
    g.beginPath(); g.rect(0, 452, w, 76); g.clip();
    g.fillStyle = 'rgba(24,32,46,0.95)';
    g.fillRect(0, 452, w, 76);
    g.fillStyle = pal.hi;
    for (let x = -30; x < w + 30; x += 44) {
      g.beginPath();
      g.moveTo(x, 528); g.lineTo(x + 22, 452); g.lineTo(x + 44, 528);
      g.lineTo(x + 30, 528); g.lineTo(x + 22, 490); g.lineTo(x + 14, 528);
      g.closePath(); g.fill();
    }
    g.restore();
    panelSeams(g, w, h, pal);
    noise(g, w, h);
    e.fillStyle = pal.glow; // 能量导条（加粗：MR 暗背景读缝光）
    for (let y = 60; y < h; y += 128) e.fillRect(8, y, w - 16, 8);
  },

  // 蒸汽铆接：拉丝黄铜 + 铆钉排 + 齿轮印 + 管件
  rivet(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) { // 拉丝竖纹
      const x = R() * w;
      g.fillStyle = `rgba(${R() > 0.5 ? '255,240,210' : '50,32,14'},${0.08 + R() * 0.09})`;
      g.fillRect(x, 0, 1, h);
    }
    for (let y = 0; y < h; y += 96) { // 横向板带
      g.fillStyle = (y / 96) % 2 ? 'rgba(255,230,190,0.28)' : 'rgba(58,36,14,0.34)';
      g.fillRect(0, y, w, 96);
      g.strokeStyle = pal.line; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = 14; x < w; x += 26) { // 板缝铆钉排
        g.fillStyle = pal.line;
        g.beginPath(); g.arc(x, y + 10, 5, 0, 7); g.fill();
        g.fillStyle = pal.hi;
        g.beginPath(); g.arc(x - 1, y + 9, 2.2, 0, 7); g.fill();
      }
    }
    for (let i = 0; i < 8; i++) { // 齿轮印
      const cx = R() * w, cy = R() * h, r = 16 + R() * 14;
      g.strokeStyle = pal.line; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      for (let t = 0; t < 8; t++) {
        const a = t / 8 * Math.PI * 2;
        g.save(); g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.rotate(a);
        g.fillStyle = pal.line; g.fillRect(-3, -4, 8, 8); g.restore();
      }
      g.beginPath(); g.arc(cx, cy, r * 0.35, 0, 7); g.stroke();
      e.strokeStyle = pal.glow; e.lineWidth = 3.5; // 齿轮芯发光（加粗）
      e.beginPath(); e.arc(cx, cy, r * 0.35, 0, 7); e.stroke();
    }
    for (let i = 0; i < 6; i++) { // 管件纵线
      const x = R() * w;
      g.strokeStyle = 'rgba(48,30,10,0.85)'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.strokeStyle = pal.hi; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 2, 0); g.lineTo(x - 2, h); g.stroke();
    }
    for (let i = 0; i < 60; i++) { // 锅炉光点
      e.fillStyle = pal.glow;
      e.beginPath(); e.arc(R() * w, R() * h, 3.5, 0, 7); e.fill();
    }
    noise(g, w, h);
  },

  // 生体脉络：有机分叉血管 + 斑块
  vein(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { // 皮下斑块
      g.fillStyle = `rgba(120,60,60,${0.08 + R() * 0.12})`;
      g.beginPath();
      g.ellipse(R() * w, R() * h, 14 + R() * 30, 8 + R() * 16, R() * 3, 0, 7);
      g.fill();
    }
    const branch = (ctx, x, y, ang, len, lw, depth, glow) => {
      if (depth <= 0 || lw < 0.8) return;
      let cx = x, cy = y, a = ang;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        a += (R() - 0.5) * 0.9;
        cx += Math.cos(a) * (len / steps);
        cy += Math.sin(a) * (len / steps);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      if (glow) { ctx.beginPath(); ctx.arc(cx, cy, lw, 0, 7); ctx.fill(); }
      branch(ctx, cx, cy, a + 0.7, len * 0.6, lw * 0.6, depth - 1, glow);
      branch(ctx, cx, cy, a - 0.7, len * 0.6, lw * 0.6, depth - 1, glow);
    };
    g.strokeStyle = pal.line;
    g.fillStyle = pal.line;
    for (let i = 0; i < 8; i++) { // 主血管（反照率深色刻线，加粗）
      branch(g, R() * w, R() * h, R() * Math.PI * 2,
        180 + R() * 120, 9, 3, false);
    }
    e.strokeStyle = pal.glow;
    e.fillStyle = pal.glow;
    for (let i = 0; i < 7; i++) { // 发光脉络（加粗加密：暗背景下主读法）
      branch(e, R() * w, R() * h, R() * Math.PI * 2,
        150 + R() * 110, 5, 3, true);
    }
    for (let i = 0; i < 300; i++) { // 毛孔噪点
      g.fillStyle = `rgba(90,40,40,${0.05 + R() * 0.06})`;
      g.fillRect(R() * w, R() * h, 2, 2);
    }
  },

  // 冰晶切面：三角碎晶马赛克 + 霜蕨 + 晶缝发光
  crystal(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    const pts = [];
    for (let i = 0; i < 60; i++) pts.push([R() * w, R() * h]);
    for (let i = 0; i < pts.length; i++) { // 碎晶三角扇
      const [x, y] = pts[i];
      const [x2, y2] = pts[(i + 7) % pts.length];
      const [x3, y3] = pts[(i + 13) % pts.length];
      const l = 0.5 + R() * 0.5;
      g.fillStyle = `rgba(${200 + Math.floor(55 * R())},${225 + Math.floor(30 * R())},255,${0.35 + l * 0.4})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.lineTo(x3, y3);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,70,120,0.8)'; g.lineWidth = 2; g.stroke();
    }
    const fern = (ctx, x, y, ang, len, depth, color, lw) => {
      if (depth <= 0) return;
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x, y);
      const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
      ctx.lineTo(nx, ny); ctx.stroke();
      for (let k = 1; k <= 3; k++) {
        const t = k / 4, bx = x + (nx - x) * t, by = y + (ny - y) * t;
        fern(ctx, bx, by, ang + 0.8, len * 0.4, depth - 1, color, lw * 0.7);
        fern(ctx, bx, by, ang - 0.8, len * 0.4, depth - 1, color, lw * 0.7);
      }
    };
    for (let i = 0; i < 10; i++) { // 霜蕨（反照率白，加粗）
      fern(g, R() * w, R() * h, R() * Math.PI * 2,
        70 + R() * 50, 2, 'rgba(245,252,255,0.95)', 3);
    }
    for (let i = 0; i < 18; i++) { // 晶缝发光（加粗）
      const x = R() * w, y = R() * h, a = R() * Math.PI;
      e.strokeStyle = pal.glow; e.lineWidth = 3.5;
      e.beginPath(); e.moveTo(x, y);
      e.lineTo(x + Math.cos(a) * (50 + R() * 70), y + Math.sin(a) * (50 + R() * 70));
      e.stroke();
    }
    noise(g, w, h, 0.04);
  },

  // 战术碳纹：斜纹编织 + 模版块 + 编号喷字
  carbon(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 3; // 斜纹编织（双向）
    for (let d = -h; d < w + h; d += 12) {
      g.strokeStyle = 'rgba(40,36,26,0.5)';
      g.beginPath(); g.moveTo(d, 0); g.lineTo(d + h, h); g.stroke();
      g.strokeStyle = 'rgba(235,228,200,0.32)';
      g.beginPath(); g.moveTo(d + 6, 0); g.lineTo(d + h + 6, h); g.stroke();
      g.strokeStyle = 'rgba(40,36,26,0.35)';
      g.beginPath(); g.moveTo(d, h); g.lineTo(d + h, 0); g.stroke();
    }
    for (let y = 0; y < h; y += 170) { // 战术织带
      g.fillStyle = 'rgba(48,44,32,0.7)';
      g.fillRect(0, y, w, 34);
      g.fillStyle = pal.hi;
      for (let x = 8; x < w; x += 22) g.fillRect(x, y + 12, 12, 10);
    }
    for (let i = 0; i < 5; i++) { // 模版喷字块
      const x = R() * (w - 80), y = R() * h;
      g.fillStyle = 'rgba(32,30,22,0.9)';
      g.font = 'bold 26px monospace';
      g.fillText(['A-07', 'SPEC', 'MK-II', '03', 'TAC'][i % 5], x, y);
    }
    e.fillStyle = pal.glow; // 仅标记点微光（克制）
    for (let i = 0; i < 16; i++) e.fillRect(R() * w, R() * h, 6, 3);
    noise(g, w, h, 0.05);
  },

  // 圣金卷草纹：优雅藤蔓卷须 + 小叶 + 金点（反照率刻线 + 同位发光勾边）
  filigree(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    // 底纹：细斜向拉丝
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(170,140,80,${0.05 + R() * 0.06})`;
      g.fillRect(R() * w, 0, 1, h);
    }
    const vine = (ctx, x, y, ang, len, lw, color, leaf) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      let cx = x, cy = y, a = ang;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      const steps = 10;
      for (let s = 0; s < steps; s++) {
        a += Math.sin(s * 1.2) * 0.35 + (R() - 0.5) * 0.2; // 波浪卷须
        cx += Math.cos(a) * (len / steps);
        cy += Math.sin(a) * (len / steps);
        ctx.lineTo(cx, cy);
        if (leaf && s % 3 === 1) { // 卷须节点小叶
          ctx.save();
          ctx.translate(cx, cy); ctx.rotate(a + 1.1);
          ctx.beginPath(); ctx.ellipse(lw * 2.2, 0, lw * 2.2, lw * 0.9, 0, 0, 7);
          ctx.fillStyle = color; ctx.fill();
          ctx.restore();
        }
      }
      ctx.stroke();
      // 末端卷圈（filigree 标志性螺旋）
      ctx.beginPath();
      ctx.arc(cx, cy, lw * 2.2, a, a + Math.PI * 1.6);
      ctx.stroke();
    };
    for (let i = 0; i < 10; i++) { // 主藤蔓（反照率深金刻线，加粗）
      vine(g, R() * w, R() * h, Math.PI / 2 + (R() - 0.5),
        170 + R() * 150, 4 + R() * 2, pal.line, true);
    }
    for (let i = 0; i < 8; i++) { // 发光金藤（加粗：暗背景主读法）
      vine(e, R() * w, R() * h, Math.PI / 2 + (R() - 0.5),
        130 + R() * 110, 3, pal.glow, false);
    }
    for (let i = 0; i < 50; i++) { // 金点饰
      g.fillStyle = pal.line;
      g.beginPath(); g.arc(R() * w, R() * h, 2.4, 0, 7); g.fill();
      if (i % 3 === 0) {
        e.fillStyle = pal.glow;
        e.beginPath(); e.arc(R() * w, R() * h, 2.2, 0, 7); e.fill();
      }
    }
    noise(g, w, h, 0.04);
  },

  // 龙鳞：叠瓦鳞甲排（反照率深浅强对比）+ 鳞缝魔光（紫，加粗）
  scales(g, e, w, h, pal) {
    g.fillStyle = pal.base;
    g.fillRect(0, 0, w, h);
    const r = 22;
    for (let row = 0; row < h / (r * 0.8) + 1; row++) {
      const y = row * r * 0.8;
      const off = row % 2 ? r : 0;
      for (let x = -1; x < w / (r * 2) + 1; x++) {
        const cx = x * r * 2 + off;
        // 鳞甲：下半圆叠瓦（明度交替拉大，暗底上读出鳞排）
        g.beginPath();
        g.arc(cx, y, r, 0, Math.PI);
        g.closePath();
        g.fillStyle = `rgba(${row % 2 ? '108,116,146' : '66,72,96'},0.95)`;
        g.fill();
        g.strokeStyle = pal.line;
        g.lineWidth = 3.5;
        g.stroke();
        // 鳞心高光
        g.beginPath();
        g.arc(cx, y + r * 0.35, r * 0.4, Math.PI * 1.15, Math.PI * 1.85);
        g.strokeStyle = 'rgba(200,210,240,0.6)';
        g.lineWidth = 2;
        g.stroke();
        if ((row + x) % 3 === 0) { // 鳞缝魔光（隔鳞发光，加粗）
          e.beginPath();
          e.arc(cx, y, r, 0, Math.PI);
          e.strokeStyle = pal.glow;
          e.lineWidth = 3.5;
          e.stroke();
        }
      }
    }
    noise(g, w, h, 0.05);
  },
};

function panelSeams(g, w, h, pal) {
  g.strokeStyle = 'rgba(40,50,66,1)';
  g.lineWidth = 5;
  for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.strokeStyle = pal.hi;
  g.lineWidth = 2;
  for (let y = 5; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
}

function noise(g, w, h, alpha = 0.07) {
  for (let i = 0; i < 1400; i++) {
    const v = R() > 0.5 ? 255 : 60;
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(R() * w, R() * h, 1.5, 1.5);
  }
}

// 克隆纹理并设重复度（共享 canvas 图像）
export function texWithRepeat(t, rx, ry) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

// 程序化环境贴图（等距柱状）：藏青天空 + 亮青地平线带 + 深色地面。
// 高金属度 PBR 没有 envMap 会发黑（无环境可反射），挂 scene.environment 后
// 金属件才有「发光金属」质感。主程序创建 scene 后挂一次即可。
// 2026-08-26 重做轮：地平线亮带加亮加宽、光柱加密——metalness 0.4~0.65 区间
// 也必须有足量环境反射才不会在 MR 暗背景里糊成一片。
let _env = null;
export function makeEnvTexture() {
  if (_env) return _env;
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#26334e');   // 天顶藏青（提亮）
  grad.addColorStop(0.4, '#3c5478');
  grad.addColorStop(0.5, '#a8d8f0'); // 地平线亮带（金属反射主光源，加亮）
  grad.addColorStop(0.6, '#3c5478');
  grad.addColorStop(1, '#161b26');   // 地面
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(190,245,255,0.95)'; // 地平线能量细线（加粗）
  g.fillRect(0, h * 0.492, w, 4);
  for (let x = 16; x < w; x += 56) { // 远处竖向光柱（高光反射点，加密加亮）
    g.fillStyle = 'rgba(140,225,255,0.4)';
    g.fillRect(x, h * 0.16, 7, h * 0.32);
  }
  for (let i = 0; i < 10; i++) { // 天顶暖光斑（金属顶部反射层次）
    g.fillStyle = 'rgba(255,230,190,0.14)';
    g.beginPath();
    g.arc(30 + i * 48, h * 0.12, 14, 0, 7);
    g.fill();
  }
  _env = new THREE.CanvasTexture(c);
  _env.colorSpace = THREE.SRGBColorSpace;
  _env.mapping = THREE.EquirectangularReflectionMapping;
  return _env;
}
