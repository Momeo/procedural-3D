/**
 * gunpals.js — 「怪物枪」demo 页主模块：画廊模式 + 第一人称持枪视角模式。
 *
 *  - 画廊：5 把枪一排悬浮在展示柱上（枪口/嘴朝 +Z 正对默认机位），柱上名牌，
 *    鼠标拖动旋转 / 滚轮缩放（沿用 lineup.html 简易轨道范式）。点击枪身或面板行
 *    = 选中；I/A/F/O 键或面板按钮对选中枪演示 idle/aim/fire 三态 + 强制过热。
 *  - 持枪视角：按 1-5（或面板行内「持枪」按钮）切到该枪第一人称持枪位——枪挂
 *    相机右下方（约 0.48m、微俯侧转，模拟 VR 低头看枪），手随呼吸浮动 ±2mm；
 *    **按住左键=连发（fire）、按住右键=瞄准（aim）、都不按=idle**（mr-gun 的
 *    VR 用枪语义）；持续连发 ~1.5s/12 发触发过热喘气。再按同数字或 0/Esc 回画廊。
 *  - window.__pmtk 钩子：{ ready, calls, triangles, guns, tris, blinkCount,
 *    lookbackCount, fireCount, overheatCount, state, hold(i), gallery(), select(i),
 *    setState(s), fire(i) }（探针断言用）。
 */

import * as THREE from 'three';
// gun pals 已收进本库 src/gunpals/（本页即其 dogfood 消费方）
import { GUNS as GUN_DEFS, buildGun, prims } from '../src/gunpals/gunpals.js';

addEventListener('error', e => { document.getElementById('err').textContent = 'ERR: ' + e.message; });
addEventListener('unhandledrejection', e => { document.getElementById('err').textContent = 'ERR: ' + (e.reason && e.reason.message || e.reason); });

const q = new URLSearchParams(location.search);

// --- 渲染器/场景/灯光（照搬 lineup 范式） ----------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101210);
{
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, '#9fb8d0'); grad.addColorStop(0.5, '#5c6152'); grad.addColorStop(1, '#1c1a14');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = tex;
}
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x2e3226, 1.1));
const sun = new THREE.DirectionalLight(0xffe8c0, 2.2); sun.position.set(3, 6, 4); scene.add(sun);
const fill = new THREE.DirectionalLight(0x88a0c0, 0.6); fill.position.set(-4, 3, -3); scene.add(fill);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 200);
scene.add(camera);   // 持枪模式下枪挂到相机下，相机必须在场景里
window.__pmtkScene = scene;   // 探针/调试用场景根

// --- 建枪 -------------------------------------------------------------------------
const SPACING = 0.62, GUN_Y = 1.12;
const slotX = (i) => (i - (GUN_DEFS.length - 1) / 2) * SPACING;
const guns = [];
window.__pmtk = {
  ready: false, calls: 0, triangles: 0,
  guns: GUN_DEFS.map(d => d.id), tris: {},
  blinkCount: 0, lookbackCount: 0, fireCount: 0, overheatCount: 0,
  state: 'idle', selected: -1,
};
GUN_DEFS.forEach((def, i) => {
  const gun = buildGun(def.id);   // 默认 seed=hashStr(id)，跨端确定性一致
  gun.group.position.set(slotX(i), GUN_Y, 0);
  scene.add(gun.group);
  guns.push(gun);
  window.__pmtk.tris[def.id] = gun.tris;
});

// --- 展示柱 + 名牌 ------------------------------------------------------------------
{
  const p = prims(2.6);
  for (let i = 0; i < GUN_DEFS.length; i++) {
    p.cyl(0.030, 0.042, 0.95, { x: slotX(i), y: 0.475, z: 0 });
    p.cyl(0.085, 0.105, 0.05, { x: slotX(i), y: 0.025, z: 0 });
  }
  const geo = p.build();
  scene.add(new THREE.Mesh(geo,
    new THREE.MeshStandardMaterial({ color: 0x3a3d36, roughness: 0.8, metalness: 0.3 })));
}
function makeLabel(name, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#141812e0';
  g.beginPath(); g.roundRect(6, 6, 500, 148, 18); g.fill();
  g.strokeStyle = '#5a5c48'; g.lineWidth = 3; g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#e8e4c8'; g.font = 'bold 62px system-ui, sans-serif';
  g.fillText(name, 256, 78);
  g.fillStyle = '#9aa078'; g.font = '40px monospace';
  g.fillText(sub, 256, 132);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(0.36, 0.1125, 1);
  return sp;
}
GUN_DEFS.forEach((def, i) => {
  // 名牌钉在展示柱上（博物馆铭牌位），避开左上 panel 遮挡
  const sp = makeLabel(def.name, def.id);
  sp.position.set(slotX(i), 0.68, 0.13);
  scene.add(sp);
});

// --- 地面 ----------------------------------------------------------------------------
const rowW = GUN_DEFS.length * SPACING;
const ground = new THREE.Mesh(
  new THREE.CylinderGeometry(rowW + 4, rowW + 4, 0.1, 48),
  new THREE.MeshStandardMaterial({ color: 0x555c48, roughness: 1 }));
ground.position.y = -0.05;
scene.add(ground);
scene.add(new THREE.GridHelper(rowW + 8, Math.round(rowW) + 8, 0x3c4434, 0x232a1e));

// --- 简易轨道（画廊模式用，照搬 lineup 范式） ----------------------------------------
const orbit = {
  yaw: +(q.get('yaw') ?? 0),
  pitch: +(q.get('pitch') ?? 0.10),
  dist: +(q.get('dist') ?? 2.7),
  tx: 0, ty: 1.05,
};
function applyOrbit() {
  const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
  camera.position.set(
    orbit.tx + orbit.dist * cp * Math.sin(orbit.yaw),
    orbit.ty + orbit.dist * sp,
    orbit.dist * cp * Math.cos(orbit.yaw));
  camera.lookAt(orbit.tx, orbit.ty, 0);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// --- 选中 + 四态演示 ------------------------------------------------------------------
let selected = -1;
/** 当前状态演示的目标枪（持枪模式=持有的枪，画廊=选中的枪）。 */
function activeGun() {
  return holdIdx >= 0 ? guns[holdIdx] : (selected >= 0 ? guns[selected] : null);
}
function refreshPanel() {
  document.querySelectorAll('#panel .grow').forEach(el =>
    el.classList.toggle('on', +el.dataset.i === (holdIdx >= 0 ? holdIdx : selected)));
  document.getElementById('selinfo').textContent =
    (holdIdx >= 0 ? `Holding: ${GUN_DEFS[holdIdx].name} (LMB fire / RMB aim)`
      : selected >= 0 ? `Selected: ${GUN_DEFS[selected].name}` : 'Nothing selected (click a gun or a panel row)');
}
function select(i) {
  selected = i;
  refreshPanel();
}
/** 对目标枪演示切状态（idle/aim/fire/overheat；overheat 走 fire 等积热太慢，直接强制）。 */
function setState(s) {
  const g = activeGun();
  if (!g) return;
  if (s === 'overheat') { g.actor.requestState('idle'); g.actor.startOverheat(); }
  else g.actor.requestState(s);
  document.querySelectorAll('#statebar button').forEach(b =>
    b.classList.toggle('on', b.dataset.s === s));
}
window.__pmtk.select = select;
window.__pmtk.setState = setState;

document.querySelectorAll('#panel .grow').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('go')) hold(+el.dataset.i);   // 行内「持枪」按钮
    else select(+el.dataset.i);
  });
});
document.querySelectorAll('#statebar button').forEach(b =>
  b.addEventListener('click', () => setState(b.dataset.s)));

// --- 持枪视角模式 ---------------------------------------------------------------------
let holdIdx = -1;
const HOLD_POS = new THREE.Vector3(0.14, -0.14, -0.46);   // 相机右下方 ~0.48m
let holdT = 0;
let lmb = false, rmb = false;                              // 按住输入（VR 扳机/瞄准语义）

function hold(i) {
  if (i === holdIdx) { gallery(); return; }
  gallery();
  holdIdx = i;
  selected = i;
  const g = guns[i];
  g.actor.requestState('idle');
  camera.add(g.group);
  g.group.position.copy(HOLD_POS);
  g.group.quaternion.setFromEuler(new THREE.Euler(0.04, Math.PI + 0.18, 0, 'YXZ')); // 朝前微俯、侧转露轮廓
  camera.position.set(0, 1.45, 1.55);
  camera.rotation.set(-0.16, 0, 0);   // 微低头，模拟 VR 看枪
  refreshPanel();
}
function gallery() {
  if (holdIdx < 0) return;
  const g = guns[holdIdx];
  g.actor.requestState('idle');
  lmb = rmb = false;
  scene.add(g.group);
  g.group.position.set(slotX(holdIdx), GUN_Y, 0);
  g.group.rotation.set(0, 0, 0);
  holdIdx = -1;
  refreshPanel();
  applyOrbit();
}
window.__pmtk.hold = hold;
window.__pmtk.gallery = gallery;
window.__pmtk.fire = (i) => guns[i] && guns[i].actor.fire();
/** 探针用机位：setCam(yaw, pitch, dist, tx, ty)（仅画廊模式有意义）。 */
window.__pmtk.setCam = (yaw, pitch, dist, tx, ty) => {
  orbit.yaw = yaw; orbit.pitch = pitch; orbit.dist = dist;
  if (tx !== undefined) orbit.tx = tx;
  if (ty !== undefined) orbit.ty = ty;
  applyOrbit();
};
const _gsEuler = new THREE.Euler();
/** 探针用单枪状态：{ state, bstate, yaw, pitch, yawLimit, chain?:[各节 yaw,pitch] }。 */
window.__pmtk.gunState = (i) => {
  const g = guns[i];
  if (!g) return null;
  const a = g.actor;
  _gsEuler.setFromQuaternion(a.gun.lookNode.quaternion, 'YXZ');
  const out = { state: a.state, bstate: a.bstate, yaw: _gsEuler.y, pitch: _gsEuler.x,
    yawLimit: a.cfg.yawLimit };
  if (a.chain) {
    out.chain = a.chain.map(l => {
      _gsEuler.setFromQuaternion(l.node.quaternion, 'YXZ');
      return [_gsEuler.y, _gsEuler.x];
    });
  }
  return out;
};
/** 探针：强制第 i 把枪眼皮停在全闭（on=false 解除）。 */
window.__pmtk.debugBlink = (i, on = true) => {
  const a = guns[i] && guns[i].actor;
  if (a) a.debugBlink(on);
};
/** 探针：第 i 把枪当前眼皮角度（rad）。 */
window.__pmtk.lidAngle = (i) => guns[i] ? guns[i].actor.lidAngle : null;
const _wv = new THREE.Vector3();
/** 探针：特效出口（曳光/激光/闪光挂点）世界坐标。 */
window.__pmtk.muzzleWorld = (i) => {
  if (!guns[i]) return null;
  return guns[i].actor.gun.tracer.getWorldPosition(_wv).toArray();
};
/** 探针：颚尖嘴口标记世界坐标（目前 stagbite 有 jawTip）。 */
window.__pmtk.jawTipWorld = (i) => {
  const g = guns[i] && guns[i].actor.gun;
  return g && g.jawTip ? g.jawTip.getWorldPosition(_wv).toArray() : null;
};
/** 探针：特效出口↔颚尖距离（同一次求值内取两点——分两次 evaluate 会隔着一帧，
 *  头部快速回转时帧间位移会污染测量）。 */
window.__pmtk.muzzleJawDist = (i) => {
  const g = guns[i] && guns[i].actor.gun;
  if (!g || !g.jawTip) return null;
  const a = g.tracer.getWorldPosition(new THREE.Vector3());
  const b = g.jawTip.getWorldPosition(new THREE.Vector3());
  return a.distanceTo(b);
};

addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '5') hold(+e.key - 1);
  else if (e.key === '0' || e.key === 'Escape') gallery();
  else if (e.key === 'i' || e.key === 'I') setState('idle');
  else if (e.key === 'a' || e.key === 'A') setState('aim');
  else if (e.key === 'f' || e.key === 'F') setState('fire');
  else if (e.key === 'o' || e.key === 'O') setState('overheat');
});

// --- 输入：拖动旋转（画廊）/ 点击选枪 / 持枪按住开火瞄准 -------------------------------
let drag = null, downXY = null;
const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());   // 右键=瞄准
renderer.domElement.addEventListener('pointerdown', e => {
  downXY = { x: e.clientX, y: e.clientY };
  if (holdIdx >= 0) {
    if (e.button === 0) lmb = true;
    else if (e.button === 2) rmb = true;
  } else if (e.button === 0) {
    drag = { x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
  }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag.x) * 0.006;
  orbit.pitch = Math.max(-1.2, Math.min(1.4, orbit.pitch + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY };
  applyOrbit();
});
addEventListener('pointerup', e => {
  if (e.button === 0) lmb = false;
  if (e.button === 2) rmb = false;
  const wasDrag = drag !== null;
  drag = null;
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y);
  downXY = null;
  if (!wasDrag || moved > 6) return;             // 持枪点击/拖动不算选中
  // 画廊：点击（非拖动）枪身 = 选中
  raycaster.setFromCamera(new THREE.Vector2(
    (e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(guns.map(g => g.group), true);
  if (hits.length) {
    let n = hits[0].object;
    while (n && !GUN_DEFS.some(d => d.id === n.name)) n = n.parent;
    if (n) select(GUN_DEFS.findIndex(d => d.id === n.name));
  }
});
renderer.domElement.addEventListener('wheel', e => {
  if (holdIdx >= 0) return;
  orbit.dist = Math.max(1, Math.min(20, orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)));
  applyOrbit();
}, { passive: true });
applyOrbit();

// --- 主循环 ----------------------------------------------------------------------------
const clock = new THREE.Clock();
let frames = 0, tFps = 0, reported = false;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  holdT += dt;
  if (holdIdx >= 0) {
    const g = guns[holdIdx];
    // VR 用枪语义：按住左键=连发、按住右键=瞄准、都不按=idle
    g.actor.requestState(lmb ? 'fire' : rmb ? 'aim' : 'idle');
    // 持枪位下手随呼吸轻微浮动（±2mm）
    g.group.position.set(
      HOLD_POS.x + Math.sin(holdT * 1.1 + 2) * 0.0015,
      HOLD_POS.y + Math.sin(holdT * 1.7) * 0.002,
      HOLD_POS.z);
  }
  for (const g of guns) g.update(dt, camera);
  // 行为计数器聚合（包里每把枪 actor 自带 counts，页面级钩子按帧求和）
  for (const k of ['blinkCount', 'lookbackCount', 'fireCount', 'overheatCount']) {
    window.__pmtk[k] = guns.reduce((sum, g) => sum + g.actor.counts[k], 0);
  }
  const ag = activeGun();
  window.__pmtk.state = ag ? ag.actor.state : 'idle';
  window.__pmtk.selected = holdIdx >= 0 ? holdIdx : selected;
  renderer.render(scene, camera);
  const info = renderer.info.render;
  if (!reported) {
    reported = true;
    Object.assign(window.__pmtk, { calls: info.calls, triangles: info.triangles });
  }
  frames++; tFps += dt;
  if (tFps >= 1) {
    const fps = Math.round(frames / tFps);
    document.getElementById('fps').textContent =
      `${fps} fps · draw calls ${info.calls} · tri ${info.triangles}`;
    Object.assign(window.__pmtk, { fps, calls: info.calls, triangles: info.triangles, ready: true });
    frames = 0; tFps = 0;
  }
});
