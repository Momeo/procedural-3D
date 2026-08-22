/**
 * prims.js — 曲面几何原语：cyl（分段圆锥台/锥刺）/ ellipsoid（分段椭球/半球）/
 * lathe（旋转成型）。box 堆不出来的有机与机件剪影语言从这里出。
 *
 * 为什么是新文件而不是改 core/anatomy.js：core/ 是冻结引擎层，一行不可改
 * （仓库铁律），而 parts() 的内部（emit/UV 投影）没有 export。这里是与 parts()
 * **同契约的第二个 builder**，emit/投影/build 按 core 原范式重写：
 *
 *   - 平直着色：法线由变换后顶点逐三角形重算（不是逐顶点平滑）。分段圆柱/球体
 *     读作「切面宝石」而非平滑曲面——与 box 的 chamfer 倒角是同一套低多边形
 *     切面美学，混用不违和。分段数刻意压低也是为了保住切面读法。
 *   - UV 投影：变换后位置 × 逐面主导法线轴投影 × tilesPerUnit + (u,v) 偏移，
 *     贴图跨构件连续（box 同款，混排在一个 build() 里纹理密度一致）。
 *   - 选项范式对齐 box：{ x,y,z（平移，最后应用）, rx,ry,rz（XYZ 序，先转后移）,
 *     u,v（UV tile 偏移） }。
 *   - build() 产无索引 BufferGeometry + computeBoundingSphere，与 parts() 一致，
 *     可直接混进同一批 mesh（bake.js 按材质合并时不分来源）。
 *
 * 段数预算（单怪总三角 ~1–2.5k 的现有物种水平不变）：
 *   三档预算 6 / 8 / 12 段——6 给细长件（刺/刚毛/天线杆），8 是默认（肢体/管/
 *   体节），12 只给大直径主剪影件（穹顶/腹囊）。默认段数即按此定：
 *   cyl.radial=8、ellipsoid rings×segs=6×8、lathe segs=8。
 *   参考三角数：cyl(8) 侧 16 + 双盖 16 ≈ 32；锥（rTop=0）≈ 16；
 *   ellipsoid(6×8) ≈ 96（半球减半+盖）；lathe 每环行 2×segs。
 */

import * as THREE from 'three';

const TAU = Math.PI * 2;

/**
 * 累积式 builder（契约同 anatomy.js 的 parts()）。
 * @param tilesPerUnit UV 平铺密度，物种侧一律传 WRAP_TILES 与盒族对齐。
 */
export function prims(tilesPerUnit = 2.6) {
  const pos = [];
  const nor = [];
  const uv = [];

  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();

  // emit：逐面法线 + 主导法线轴 UV 投影——照抄 anatomy.js parts() 的实现
  // （core 没有 export，按原范式重写，一处都别「改进」，跨构件连续性靠它）
  function emit(tri3, uvOffU, uvOffV) {
    const [a, b, c] = tri3;

    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;           // 极点/尖端的退化 sliver 直接丢
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

  /** 点变换管线：局部 → 旋转（XYZ 欧拉）→ 平移（契约同 box 的 P）。 */
  function transformer(o) {
    const hasRot = o.rx || o.ry || o.rz;
    if (hasRot) {
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ');
      _m.makeRotationFromEuler(_e);
    }
    const tx = o.x || 0, ty = o.y || 0, tz = o.z || 0;
    return (px, py, pz) => {
      _v.set(px, py, pz);
      if (hasRot) _v.applyMatrix4(_m);
      return [_v.x + tx, _v.y + ty, _v.z + tz];
    };
  }

  const api = {
    /**
     * 分段圆锥台（局部 +Y 为轴，y∈[-h/2, +h/2]）。
     * @param rTop 顶半径（0 = 锥/刺：角、牙、spike）
     * @param rBot 底半径
     * @param h    高
     * @param o    通用选项 + radial（段数，默认 8；细长件 6、大主剪影 12）、
     *             capTop/capBot（端盖，默认 true；r=0 端自动无盖）
     * 用途：枪管、活塞、天线杆、有机肢体、角牙。
     */
    cyl(rTop, rBot, h, o = {}) {
      const radial = o.radial ?? 8;
      const P = transformer(o);
      const u0 = o.u || 0, v0 = o.v || 0;
      const yB = -h / 2, yT = h / 2;
      const ring = (r, y, s) => {
        const a = (s / radial) * TAU;
        return P(Math.cos(a) * r, y, Math.sin(a) * r);
      };
      // 侧带（外绕向 CCW；r=0 端的退化三角由 emit 丢弃）
      for (let s = 0; s < radial; s++) {
        const b0 = ring(rBot, yB, s), b1 = ring(rBot, yB, s + 1);
        const t0 = ring(rTop, yT, s), t1 = ring(rTop, yT, s + 1);
        emit([b0, t0, b1], u0, v0);
        emit([b1, t0, t1], u0, v0);
      }
      if (o.capTop !== false && rTop > 1e-9) {
        const c = P(0, yT, 0);
        for (let s = 0; s < radial; s++) emit([c, ring(rTop, yT, s + 1), ring(rTop, yT, s)], u0, v0);
      }
      if (o.capBot !== false && rBot > 1e-9) {
        const c = P(0, yB, 0);
        for (let s = 0; s < radial; s++) emit([c, ring(rBot, yB, s), ring(rBot, yB, s + 1)], u0, v0);
      }
      return api;
    },

    /**
     * 分段椭球（局部球心在原点）。
     * @param rx,ry,rz 三轴半径
     * @param o 通用选项 + rings（纬向段数，默认 6）、segs（经向段数，默认 8）、
     *          half（'top'|'bottom' 半球，开口端默认补平盖，cap:false 关盖）。
     * 极点/赤道的退化三角由 emit 丢弃，不需要特判。
     * 用途：穹顶、腹囊、头颅、甲壳。
     */
    ellipsoid(rx, ry, rz, o = {}) {
      const rings = o.rings ?? 6, segs = o.segs ?? 8;
      const half = o.half;
      const phi0 = half === 'bottom' ? Math.PI / 2 : 0;
      const phi1 = half === 'top' ? Math.PI / 2 : Math.PI;
      const P = transformer(o);
      const u0 = o.u || 0, v0 = o.v || 0;
      const pt = (i, s) => {
        const phi = phi0 + (phi1 - phi0) * (i / rings);
        const a = (s / segs) * TAU;
        const sp = Math.sin(phi);
        return P(rx * sp * Math.cos(a), ry * Math.cos(phi), rz * sp * Math.sin(a));
      };
      for (let i = 0; i < rings; i++) {
        for (let s = 0; s < segs; s++) {
          emit([pt(i, s), pt(i, s + 1), pt(i + 1, s + 1)], u0, v0);
          emit([pt(i, s), pt(i + 1, s + 1), pt(i + 1, s)], u0, v0);
        }
      }
      if (half && o.cap !== false) {
        const rim = half === 'top' ? rings : 0;   // 开口恒在赤道（phi=π/2）
        const c = P(0, 0, 0);
        for (let s = 0; s < segs; s++) {
          if (half === 'top') emit([c, pt(rim, s), pt(rim, s + 1)], u0, v0);        // 盖朝下
          else emit([c, pt(rim, s + 1), pt(rim, s)], u0, v0);                        // 盖朝上
        }
      }
      return api;
    },

    /**
     * 旋转成型：profile = [[r, y], …] **自下而上**，绕局部 +Y 轴旋出。
     * r=0 的行收尾成尖/封口（退化三角由 emit 丢弃）；首/末行 r>0 则该端敞开
     * （不自动加盖——要封口就把端行半径写 0，要盖用 cyl 的范式自行补）。
     * @param o 通用选项 + segs（周向段数，默认 8）
     * 用途：蛆虫体节、昆虫腹、花瓶躯干。
     */
    lathe(profile, o = {}) {
      const segs = o.segs ?? 8;
      const P = transformer(o);
      const u0 = o.u || 0, v0 = o.v || 0;
      const pt = (i, s) => {
        const r = profile[i][0], y = profile[i][1];
        const a = (s / segs) * TAU;
        return P(Math.cos(a) * r, y, Math.sin(a) * r);
      };
      for (let i = 0; i < profile.length - 1; i++) {
        for (let s = 0; s < segs; s++) {
          emit([pt(i, s), pt(i + 1, s), pt(i, s + 1)], u0, v0);
          emit([pt(i, s + 1), pt(i + 1, s), pt(i + 1, s + 1)], u0, v0);
        }
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
