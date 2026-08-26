/**
 * bowpals.js — 「活体弓」demo 页主模块（bow pals 画廊，gunpals.html 的弓族姊妹页）。
 *
 *  - 画廊：5 把活体弓一排立在展示柱上（出射方向 +Z 正对默认机位），旁靠同母题箭；
 *    鼠标拖动旋转 / 滚轮缩放（简易轨道，同 lineup 范式）。点击弓身或面板行 = 选中。
 *  - 活体：actor 常驻 idle（呼吸/眨眼/偶尔回头看相机）；I/A 键或按钮对选中弓切
 *    idle/aim（aim = 注视出射方向 + 半眯）；R = release() 放箭反应（后坐 + 臂片
 *    抖动 + 眼睛瞪大 + 母题色闪光）；B = debugBlink 强制全闭/睁开（眨眼验收）。
 *  - window.__bowpals 钩子：{ ready, bows, selected, select(i), setState(s),
 *    release(i), blink(on), counts() }（探针断言用）。
 */
import * as THREE from 'three';
import { SPECS, makeBowBody, makeArrowMesh } from '../src/gunpals/bowpals.js';
import { makeEnvTexture } from '../src/gunpals/scifi.js';

addEventListener('error', e => { document.getElementById('err').textContent = 'ERR: ' + e.message; });
addEventListener('unhandledrejection', e => { document.getElementById('err').textContent = 'ERR: ' + (e.reason && e.reason.message || e.reason); });

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101210);
scene.environment = makeEnvTexture(); // 高金属度 PBR 需要环境反射（弓家族约定）
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x2e3226, 1.0));
const sun = new THREE.DirectionalLight(0xffe8c0, 2.0); sun.position.set(3, 6, 4); scene.add(sun);
const fill = new THREE.DirectionalLight(0x88a0c0, 0.5); fill.position.set(-4, 3, -3); scene.add(fill);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 200);
scene.add(camera);

// --- 建弓（5 母题 + 各自一支箭） --------------------------------------------------
const SPACING = 0.72, BOW_Y = 1.05;
const slotX = (i) => (i - (SPECS.length - 1) / 2) * SPACING;
const bows = [];
window.__bowpals = {
  ready: false, selected: -1, state: 'idle',
  bows: SPECS.map(s => s.id),
  select(i) { select(i); },
  setState(s) { setState(s); },
  release(i) { const b = bows[i ?? window.__bowpals.selected]; if (b) b.actor.release(); },
  blink(on) { for (const b of bows) b.actor.debugBlink(on); },
  counts() {
    const c = { blink: 0, lookback: 0 };
    for (const b of bows) { c.blink += b.actor.counts.blinkCount; c.lookback += b.actor.counts.lookbackCount; }
    return c;
  },
};
SPECS.forEach((spec, i) => {
  const group = makeBowBody(spec);
  group.position.set(slotX(i), BOW_Y, 0);
  scene.add(group);
  const arrow = makeArrowMesh(spec);
  arrow.scale.y = 0.62;
  arrow.position.set(slotX(i) + 0.2, BOW_Y - 0.62, 0.06);
  scene.add(arrow);
  bows.push({ spec, group, actor: group.userData.actor });
});

// --- 展示柱 -------------------------------------------------------------------------
{
  const geo = new THREE.CylinderGeometry(0.035, 0.05, BOW_Y - 0.56, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d36, roughness: 0.8, metalness: 0.3 });
  for (let i = 0; i < SPECS.length; i++) {
    const p = new THREE.Mesh(geo, mat);
    p.position.set(slotX(i), (BOW_Y - 0.56) / 2, -0.05);
    scene.add(p);
  }
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.95 }));
  scene.add(ground);
}

// --- 简易轨道（lineup 范式：拖动转 / 滚轮缩放） --------------------------------------
const orbit = { yaw: 0, pitch: 0.12, dist: 3.2, tx: 0, ty: 0.9 };
function applyOrbit() {
  camera.position.set(
    orbit.tx + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist,
    orbit.ty + Math.sin(orbit.pitch) * orbit.dist,
    Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
  camera.lookAt(orbit.tx, orbit.ty, 0);
}
let drag = null;
addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  orbit.yaw -= dx * 0.005;
  orbit.pitch = Math.max(-0.4, Math.min(1.2, orbit.pitch + dy * 0.004));
});
addEventListener('pointerup', () => { drag = null; });
addEventListener('wheel', (e) => {
  orbit.dist = Math.max(0.4, Math.min(10, orbit.dist * (1 + e.deltaY * 0.001)));
});

// --- 选中/状态 ------------------------------------------------------------------------
const rows = [...document.querySelectorAll('.grow')];
const stateBtns = [...document.querySelectorAll('#statebar button')];
function select(i) {
  window.__bowpals.selected = i;
  rows.forEach((r, j) => r.classList.toggle('on', j === i));
}
function setState(s) {
  window.__bowpals.state = s;
  const i = window.__bowpals.selected;
  const targets = i >= 0 ? [bows[i]] : bows;
  for (const b of targets) b.actor.requestState(s);
  stateBtns.forEach((btn) => btn.classList.toggle('on', btn.dataset.s === s));
}
rows.forEach((r, i) => r.addEventListener('click', () => select(i)));
stateBtns.forEach((btn) => btn.addEventListener('click', () => {
  const s = btn.dataset.s;
  if (s === 'release') { window.__bowpals.release(); return; }
  if (s === 'blink') { btn.classList.toggle('on'); window.__bowpals.blink(btn.classList.contains('on')); return; }
  setState(s);
}));
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '5') select(+k - 1);
  else if (k === 'i') setState('idle');
  else if (k === 'a') setState('aim');
  else if (k === 'r') window.__bowpals.release();
  else if (k === 'b') window.__bowpals.blink(true);
  else if (k === '0' || k === 'escape') select(-1);
});

// --- 主循环（活体驱动：update(dt, camera)） --------------------------------------------
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const b of bows) b.actor.update(dt, camera);
  applyOrbit();
  renderer.render(scene, camera);
});
window.__bowpals.ready = true;
