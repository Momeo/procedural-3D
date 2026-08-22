/**
 * guns.js — gunpals 内置五把「怪物枪」（机械 × 动/植/昆虫，枪口=怪物的嘴）。
 *
 * 每把枪 = 枪型 × 生物母题，builder(id, rng) → finalize 出 { group, update, actor }：
 *  - stagbite  锹甲冲锋枪（昆虫×SMG，射速 0.11s）：大颚包枪管收束成枪口，
 *    鞘翅合抱当护木；枪管只留短节套根（头转走不留孤管），特效出口挂颚尖 jawTip。
 *  - crocmaw   鳄吻步枪（爬行×步枪，0.22s）：长吻=枪管、嘴=枪口、背鳞排成
 *    皮卡汀尼导轨；眼睛在头顶眼柄（lookNode=眼柄组 + 头 15% 次级随动微抬）。
 *  - flytrap   食人花霰弹枪（植物×霰弹枪，0.8s）：喇叭花口=枪口（flower 材质
 *    DoubleSide 内壁可见 + 深喉咙），唇圈尖牙，花茎整节可弯当 lookNode。
 *  - squidlet  乌贼手枪（头足×手枪，0.2s）：触手冠=枪口（6 条独立节点触手）、
 *    喙藏中心=枪管出口、两侧巨眼。
 *  - viperscope 盘蛇狙击枪（爬行×DMR，0.9s）：lathe 锥形蛇身=枪身、盘圈=枪托、
 *    信子=拉机柄；两节转头（turnChain 颈节 55%/头节 45%，S 形回望）。
 *
 * 几何约定：枪口朝 +Z、上 +Y；静态件按材质合并（attach），可动件（颚/触手/
 * 鞘翅/信子/花唇/盘圈/尾尖）都是独立子节点进 channels；眼睛走 addEyes 约束解。
 */

import * as THREE from 'three';
import {
  TAU, bioMat, metalMat, dirEuler, attach, emitBrows, addEyes,
  addFlash, makeLaser, makeTracer, makeSmoke, shell, GunActor,
} from './actor.js';

function finalize(spec, cfg) {
  const actor = new GunActor(spec, cfg);
  return { id: spec.id, group: spec.root, actor, tris: spec.tris,
    update: (dt, cam) => actor.update(dt, cam) };
}

// =================================================================================
// 1. stagbite 锹甲冲锋枪（昆虫×SMG）：大颚前伸包枪管收束成枪口，鞘翅合抱当护木
//    通道：jaw 双颚（aim 蓄力微张 / fire 乱夹 / overheat 大张喘气）
//          elytra 鞘翅（idle 偶尔开缝 / fire 高速扑闪）
// =================================================================================
function buildStagbite(id, rng) {
  const mats = {
    body: bioMat(0x2e2620),        // 深色甲壳
    accent: bioMat(0x41332a),      // 鞘翅/大颚
    metal: metalMat(0xa06a35),     // 铜色机件
    teeth: bioMat(0x7a6538),       // 颚尖
  };
  const { root, kick, sway } = shell(id);
  const s = 1 + (rng() - 0.5) * 0.06;      // 体型微抖动（确定性）
  root.scale.setScalar(s);
  let tris = 0;

  // 静态：胸腔/机匣/导轨/弹匣/握把/尾托/扳机护圈/枪管根
  tris += attach(sway, mats, (a) => {
    a.P('body').ellipsoid(0.046, 0.050, 0.085, { y: 0.01, z: -0.03, rings: 5, segs: 8 });
    // 枪管只留一小截根部（短/细一档，收进颚根之间）：头转走时不留孤零零的长管，
    // 原地这段读作「节套/供弹口」；外露出弹全靠双颚（随头动）。特效出口挂头上
    // （颚尖嘴口，见 finalize 的 laser/tracer/flash/smoke），不挂这截固定管。
    a.P('metal').cyl(0.008, 0.009, 0.09, { rx: Math.PI / 2, y: 0.045, z: 0.115 });
    a.box('metal', 0.050, 0.050, 0.14, { y: 0.0, z: 0.05 });          // 机匣
    a.box('metal', 0.020, 0.012, 0.13, { y: 0.045, z: 0.04 });        // 顶部导轨
    a.box('metal', 0.034, 0.100, 0.05, { y: -0.095, z: 0.045, rx: 0.12 });  // 短粗弹匣
    a.box('metal', 0.030, 0.085, 0.042, { y: -0.075, z: -0.085, rx: 0.35 }); // 握把
    a.box('metal', 0.045, 0.050, 0.035, { y: 0.005, z: -0.145 });     // 尾托
    a.box('metal', 0.006, 0.020, 0.030, { y: -0.035, z: -0.030 });    // 扳机
    a.box('metal', 0.004, 0.006, 0.050, { y: -0.062, z: -0.028 });    // 护圈底
    a.box('metal', 0.004, 0.030, 0.006, { y: -0.048, z: -0.052 });    // 护圈前
  });

  // 鞘翅两片（独立节点：idle 开缝小动作 / fire 高速扑闪）
  const mkElytra = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.032, 0.02, -0.04);
    sway.add(g);
    tris += attach(g, mats, (a) => {
      a.P('accent').ellipsoid(0.036, 0.042, 0.090, { rings: 4, segs: 7 });
    });
    g.userData.baseZ = side * -0.25;
    g.rotation.z = g.userData.baseZ;
    return g;
  };
  const elyL = mkElytra(1), elyR = mkElytra(-1);

  // 头（lookNode）：锹甲颅 + 复眼大球 + 两只大颚（独立颚组）
  // 头/颚线抬高到胸腔剪影之上，持枪位从后上方也能读出颚包枪管
  const head = new THREE.Group();
  head.position.set(0, 0.055, 0.14);
  sway.add(head);
  const EYE_DEFS = [
    { x: 0.050, y: 0.016, z: 0.005, r: 0.028, fx: 0.3, fy: -0.06, fz: 1 },
    { x: -0.050, y: 0.016, z: 0.005, r: 0.028, fx: -0.3, fy: -0.06, fz: 1 },
  ];
  tris += attach(head, mats, (a) => {
    a.P('body').ellipsoid(0.042, 0.038, 0.046, { rings: 5, segs: 8 });
    emitBrows(a.P('body'), EYE_DEFS);   // 静态眉骨壳（合并进头网格，盖闭眼时的顶部眼白）
  });

  const mkJaw = (side) => {
    const jaw = new THREE.Group();
    jaw.position.set(side * 0.028, -0.010, 0.030);
    head.add(jaw);
    tris += attach(jaw, mats, (a) => {
      // 第一段：外展前伸；第二段：内收，颚尖收束到枪口
      a.P('accent').cyl(0.009, 0.014, 0.110,
        { ...dirEuler(side * 0.020, 0.005, 0.110), x: side * 0.010, y: 0.002, z: 0.055, radial: 6 });
      a.P('accent').cyl(0.004, 0.009, 0.097,
        { ...dirEuler(side * -0.037, 0.003, 0.090), x: side * 0.002, y: 0.006, z: 0.155, radial: 6 });
      a.P('teeth').cyl(0, 0.005, 0.024,
        { ...dirEuler(side * -0.02, 0, 0.03), x: side * -0.013, y: 0.008, z: 0.205, radial: 5 });
    });
    return jaw;
  };
  const jawL = mkJaw(1), jawR = mkJaw(-1);

  const eyes = addEyes(head, mats, EYE_DEFS, 'body');
  tris += eyes.tris;
  const flash = addFlash(head, 0, -0.005, 0.215);
  // 颚尖嘴口标记（探针断言特效出口随头动用）：两颚尖锥的中点
  const jawTip = new THREE.Object3D();
  jawTip.position.set(0, -0.002, 0.235);
  head.add(jawTip);

  return finalize({
    id, root, kick, sway, lookNode: head,
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, flash, jawTip,
    laser: makeLaser(head, 0, -0.005, 0.215),
    tracer: makeTracer(head, 0, -0.005, 0.215),
    smoke: makeSmoke(head, 0, 0.01, 0.20),
    hotMats: [mats.body, mats.accent, mats.metal],
    tris,
    channels: {
      // 双颚：aim 蓄力微张 / fire 高频乱夹 / overheat 大张喘气
      jaw: (t, amp, dt, ctx) => {
        let o = amp * 0.35;
        if (ctx.state === 'fire') o += (Math.abs(Math.sin(t * 55)) * 0.22 + Math.sin(t * 47) * 0.06) * amp;
        jawL.rotation.y = o; jawR.rotation.y = -o;
      },
      // 鞘翅：idle 偶尔张开一条缝 / fire 高速扑闪
      elytra: (t, amp, dt, ctx) => {
        let o = 0;
        if (ctx.state === 'fire') o = Math.abs(Math.sin(t * 58)) * 0.5 * amp;
        else if (ctx.state === 'overheat') o = 0.25 * amp;
        else o = Math.pow(Math.max(0, Math.sin(t * 0.9)), 24) * 0.4 * amp;   // 偶发开缝
        elyL.rotation.z = elyL.userData.baseZ - o;
        elyR.rotation.z = elyR.userData.baseZ + o;
      },
    },
    stateAmps: {
      idle: { elytra: 1 },
      aim: { jaw: 0.45 },
      fire: { jaw: 1, elytra: 1 },
      overheat: { jaw: 0.9, elytra: 0.5 },
    },
  }, { yawLimit: 2.1, pitchLimit: 0.6, rate: 0.11 });
  // 甲虫头颈短，回头 ~120° 合理；SMG 高射速 0.11s
}

// =================================================================================
// 2. crocmaw 鳄吻步枪（爬行×步枪）：长吻=枪管、嘴=枪口、背鳞排成皮卡汀尼导轨
//    通道：jaw 颚（aim 咧开露牙 / fire 猛烈开合）/ headshake（fire 头左右甩）
//          tail 尾尖（idle 轻摆）
// =================================================================================
function buildCrocmaw(id, rng) {
  const mats = {
    body: bioMat(0x4a6038),        // 绿鳞
    accent: bioMat(0x35452a),      // 深鳞（导轨读法）
    metal: metalMat(0xa8863c),     // 黄铜件
    teeth: bioMat(0xd8cfb0),       // 牙
  };
  const { root, kick, sway } = shell(id);
  root.scale.setScalar(1 + (rng() - 0.5) * 0.06);
  let tris = 0;

  // 静态：尾托/黄铜机匣/背鳞导轨/弹匣/握把/扳机护圈
  tris += attach(sway, mats, (a) => {
    a.P('body').cyl(0.028, 0.040, 0.16, { radial: 4, ry: Math.PI / 4, rx: Math.PI / 2, y: -0.01, z: -0.22 });
    a.box('metal', 0.052, 0.060, 0.15, { y: 0, z: -0.02 });           // 黄铜机匣
    for (let i = 0; i < 6; i++) {                                     // 背鳞 = 皮卡汀尼导轨
      a.box('accent', 0.030, 0.010, 0.016, { y: 0.038, z: -0.090 + i * 0.024 });
    }
    a.box('metal', 0.034, 0.085, 0.045, { y: -0.075, z: 0.010, rx: 0.2 });   // 弹匣
    a.box('metal', 0.030, 0.080, 0.040, { y: -0.070, z: -0.085, rx: 0.3 });  // 握把
    a.box('metal', 0.006, 0.020, 0.028, { y: -0.038, z: -0.045 });    // 扳机
    a.box('metal', 0.004, 0.032, 0.050, { y: -0.055, z: -0.030 });    // 护圈
  });

  // 尾尖（独立节点：idle 轻摆小动作）
  const tail = new THREE.Group();
  tail.position.set(0, -0.01, -0.29);
  sway.add(tail);
  tris += attach(tail, mats, (a) => {
    a.P('body').cyl(0.010, 0.026, 0.13, { radial: 4, ry: Math.PI / 4, rx: Math.PI / 2, z: -0.05 });
  });

  // 头（secondary 随动）：颅 + 上吻（方锥渐细管）+ 上排牙 + 吻内枪管
  // headShake 包装组承接 fire 头甩通道——secondary 每帧对 head 绝对赋值，
  // 通道若也写 head 会被覆盖/互踩，故通道写包装组、随动写 head，互不干扰
  const headShake = new THREE.Group();
  headShake.position.set(0, 0.015, 0.04);
  sway.add(headShake);
  const head = new THREE.Group();
  headShake.add(head);
  tris += attach(head, mats, (a) => {
    a.P('body').ellipsoid(0.048, 0.035, 0.055, { rings: 5, segs: 8 });
    a.P('body').cyl(0.016, 0.038, 0.24, { radial: 4, ry: Math.PI / 4, rx: Math.PI / 2, y: -0.002, z: 0.15 });
    a.P('metal').cyl(0.010, 0.010, 0.22, { rx: Math.PI / 2, y: -0.010, z: 0.15 });  // 吻内枪管
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        a.P('teeth').cyl(0, 0.0055, 0.020, {
          radial: 5, rx: Math.PI,
          x: sd * (0.024 - i * 0.004), y: -0.022 - i * 0.001, z: 0.09 + i * 0.05,
        });
      }
    }
    // 眼柄（鳄鱼眼位：头顶）
    a.P('body').cyl(0.010, 0.012, 0.030, { x: 0.028, y: 0.038, z: -0.01, radial: 6 })
               .cyl(0.010, 0.012, 0.030, { x: -0.028, y: 0.038, z: -0.01, radial: 6 });
    // 吻背鳞延续导轨读法
    for (let i = 0; i < 3; i++) {
      a.box('accent', 0.020 - i * 0.004, 0.008, 0.014, { y: 0.020 + i * 0.002, z: 0.06 + i * 0.06 });
    }
    // 静态眉骨壳（眼球在 eyeGroup (0,0.052,-0.01)，换算到头局部）
    emitBrows(a.P('body'), [
      { x: 0.028, y: 0.057, z: -0.01, r: 0.023 },
      { x: -0.028, y: 0.057, z: -0.01, r: 0.023 },
    ]);
  });

  // 下颌（独立颚组，常态微张 = 枪口即张开的嘴）
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.022, 0.0);
  head.add(jaw);
  tris += attach(jaw, mats, (a) => {
    a.P('body').cyl(0.013, 0.034, 0.23, { radial: 4, ry: Math.PI / 4, rx: Math.PI / 2, y: -0.006, z: 0.145 });
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        a.P('teeth').cyl(0, 0.005, 0.018, {
          radial: 5,
          x: sd * (0.020 - i * 0.003), y: 0.008 + i * 0.001, z: 0.09 + i * 0.05,
        });
      }
    }
  });

  // 眼柄顶端的眼睛组（lookNode：鳄鱼只转眼 + 微抬头，头不动枪口指向才稳）
  const eyeGroup = new THREE.Group();
  eyeGroup.position.set(0, 0.052, -0.01);
  head.add(eyeGroup);
  const eyes = addEyes(eyeGroup, mats, [
    { x: 0.028, y: 0.005, z: 0, r: 0.023, fx: 0.15, fy: -0.10, fz: 0.95 },
    { x: -0.028, y: 0.005, z: 0, r: 0.023, fx: -0.15, fy: -0.10, fz: 0.95 },
  ], 'body');
  tris += eyes.tris;
  const flash = addFlash(head, 0, -0.006, 0.285);

  return finalize({
    id, root, kick, sway, lookNode: eyeGroup, secondary: { node: head, factor: 0.15 },
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, flash,
    laser: makeLaser(head, 0, -0.006, 0.285),
    tracer: makeTracer(head, 0, -0.006, 0.285),
    smoke: makeSmoke(head, 0, 0.01, 0.27),
    hotMats: [mats.body, mats.accent, mats.metal],
    tris,
    channels: {
      // 颚：aim 咧开露牙 / fire 猛烈开合 / overheat 大张喘气
      jaw: (t, amp, dt, ctx) => {
        let open = 0.10 + amp * 0.28;
        if (ctx.state === 'fire') open += Math.abs(Math.sin(t * 27)) * 0.38 * amp;
        jaw.rotation.x = open;
      },
      // 头左右甩（fire）：写 headShake 包装组（head 归 secondary 绝对赋值）
      headshake: (t, amp) => {
        headShake.rotation.set(0, Math.sin(t * 21) * 0.09 * amp, 0);
      },
      // 尾尖：idle 轻摆 / fire 快摆
      tail: (t, amp, dt, ctx) => {
        tail.rotation.y = Math.sin(t * (ctx.state === 'fire' ? 9 : 1.3)) * 0.18 * amp;
      },
    },
    stateAmps: {
      idle: { tail: 1 },
      aim: { jaw: 0.6 },
      fire: { jaw: 1, headshake: 1, tail: 0.6 },
      overheat: { jaw: 1.2, tail: 0.2 },
    },
  }, { yawLimit: 2.4, pitchLimit: 0.55, rate: 0.22 });
  // 鳄鱼眼在头顶：回头主要靠转眼柄组，头只随动 15%（微抬）；步枪中射速 0.22s
}

// =================================================================================
// 3. flytrap 食人花霰弹枪（植物×霰弹枪）：喇叭花口=枪口，唇+尖牙圈，藤蔓缠握把
//    通道：lips 花唇（aim 张开 / fire 高频震颤 / overheat 张大）
//          headSway（idle 追光微转 / fire 点颚抖）/ stem（fire 花茎弯抖）
// =================================================================================
function buildFlytrap(id, rng) {
  const mats = {
    body: bioMat(0x3f6b2f),        // 茎绿
    leaf: bioMat(0x5a8c3f),        // 叶/藤蔓（浅绿）
    accent: bioMat(0xa03058),      // 唇与口腔（紫红）
    metal: metalMat(0x555a52),     // 枪钢件
    teeth: bioMat(0xe0d8b0),       // 尖牙
  };
  // 花头喇叭专用材质：DoubleSide——花颈弯回正对相机时从外侧看进花口，
  // 单面内壁会被背面剔除成「透明口腔」。单独开材质，不污染共享的 body 绿。
  mats.flower = bioMat(0x3f6b2f);
  mats.flower.side = THREE.DoubleSide;
  // 喉咙/口腔深处：更深的同系暗调，嘴的纵深感靠它
  mats.throat = bioMat(0x40101f);
  mats.throat.side = THREE.DoubleSide;
  const { root, kick, sway } = shell(id);
  root.scale.setScalar(1 + (rng() - 0.5) * 0.06);
  let tris = 0;

  // 静态：木质茎机匣/根团枪托/叶片护手/泵动金属套筒/握把/扳机/瞄珠/藤蔓
  tris += attach(sway, mats, (a) => {
    a.P('body').cyl(0.032, 0.036, 0.20, { rx: Math.PI / 2, y: 0, z: -0.06 });
    a.P('body').ellipsoid(0.050, 0.045, 0.055, { y: -0.01, z: -0.19, rings: 5, segs: 8 });
    a.P('leaf')
      .ellipsoid(0.055, 0.010, 0.045, { x: 0.05, y: 0.01, z: -0.05, rz: -0.5, rings: 4, segs: 6 })
      .ellipsoid(0.055, 0.010, 0.045, { x: -0.05, y: 0.01, z: -0.05, rz: 0.5, rings: 4, segs: 6 });
    a.P('metal').cyl(0.040, 0.040, 0.07, { rx: Math.PI / 2, y: 0, z: -0.03 });   // 泵动套筒
    a.box('metal', 0.028, 0.080, 0.040, { y: -0.070, z: -0.100, rx: 0.35 });    // 握把
    a.box('metal', 0.006, 0.020, 0.026, { y: -0.036, z: -0.050 });    // 扳机
    a.box('metal', 0.004, 0.006, 0.040, { y: -0.058, z: -0.042 });    // 护圈底
    a.P('metal').cyl(0.004, 0.004, 0.020, { y: 0.045, z: -0.10, radial: 6 });   // 瞄珠杆
    // 藤蔓缠握把：三段斜筒交叉
    for (let i = 0; i < 3; i++) {
      a.P('leaf').cyl(0.007, 0.007, 0.075, {
        rx: 0.35 + (i % 2 ? 0.9 : -0.9), rz: i % 2 ? 0.3 : -0.3,
        x: 0, y: -0.045 - i * 0.026, z: -0.093 - i * 0.008, radial: 6,
      });
    }
  });

  // 颈（lookNode：花茎可弯，回头=整节茎+花头弯向持枪者）
  const neck = new THREE.Group();
  neck.position.set(0, 0.01, 0.06);
  sway.add(neck);
  tris += attach(neck, mats, (a) => {
    a.P('body').cyl(0.024, 0.034, 0.135,
      { ...dirEuler(0, 0.09, 0.10), x: 0, y: 0.045, z: 0.050 });
  });

  // 花头：喇叭口枪口（flower 双面材，内壁可见）+ 内圈尖牙 + 喉咙底（深暗调）
  const head = new THREE.Group();
  head.position.set(0, 0.09, 0.10);
  neck.add(head);
  const EYE_DEFS = [
    { x: 0.036, y: 0.030, z: 0.018, r: 0.024, fx: 0.3, fy: -0.05, fz: 1 },
    { x: -0.036, y: 0.030, z: 0.018, r: 0.024, fx: -0.3, fy: -0.05, fz: 1 },
  ];
  tris += attach(head, mats, (a) => {
    a.P('flower').lathe(
      [[0.018, 0], [0.022, 0.04], [0.030, 0.08], [0.062, 0.125], [0.082, 0.15]],
      { segs: 10, rx: Math.PI / 2 });
    // 喉咙底（枪管出口暗示，深紫近黑，读口腔纵深）
    a.P('throat').cyl(0.016, 0.016, 0.004, { rx: Math.PI / 2, z: 0.02, radial: 8 });
    // 内圈尖牙：口缘内侧指向内后
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TAU + 0.26;
      a.P('teeth').cyl(0, 0.006, 0.032, {
        ...dirEuler(-Math.cos(a0), -Math.sin(a0), -0.45),
        x: Math.cos(a0) * 0.052, y: Math.sin(a0) * 0.052, z: 0.145, radial: 5,
      });
    }
    emitBrows(a.P('body'), EYE_DEFS);   // 静态眉骨壳
  });

  // 唇圈（独立节点：aim 张开 / fire 震颤 / overheat 张大）
  const lips = new THREE.Group();
  head.add(lips);
  tris += attach(lips, mats, (a) => {
    a.P('accent').lathe(
      [[0.078, 0.140], [0.090, 0.146], [0.090, 0.156], [0.080, 0.162],
       [0.070, 0.156], [0.070, 0.146], [0.078, 0.140]],
      { segs: 10, rx: Math.PI / 2 });
  });

  // 眼睛一对大球在花头基部（跟花头一起指向）
  const eyes = addEyes(head, mats, EYE_DEFS, 'body');
  tris += eyes.tris;
  const flash = addFlash(head, 0, 0, 0.165);

  return finalize({
    id, root, kick, sway, lookNode: neck,
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, flash,
    laser: makeLaser(head, 0, 0, 0.165),
    tracer: makeTracer(head, 0, 0, 0.165),
    smoke: makeSmoke(head, 0, 0.03, 0.15),
    hotMats: [mats.body, mats.leaf, mats.accent, mats.metal, mats.flower, mats.throat],
    tris,
    channels: {
      // 花唇：aim 张开 / fire 高频震颤 / overheat 张大
      lips: (t, amp, dt, ctx) => {
        let sc = 1;
        if (ctx.state === 'aim') sc = 1 + 0.28 * amp;
        else if (ctx.state === 'fire') sc = 1 + amp * (0.16 + 0.10 * Math.sin(t * 61));
        else if (ctx.state === 'overheat') sc = 1 + 0.32 * amp;
        lips.scale.set(sc, sc, 1);
        lips.rotation.z = ctx.state === 'fire' ? Math.sin(t * 53) * 0.10 * amp : 0;
      },
      // 花头：idle 追光式缓慢微转 / fire 点颚震颤 / overheat 耷拉
      headSway: (t, amp, dt, ctx) => {
        if (ctx.state === 'idle') {
          head.rotation.set(Math.sin(t * 0.37) * 0.05 * amp, Math.sin(t * 0.5) * 0.10 * amp, 0);
        } else if (ctx.state === 'fire') {
          head.rotation.set(0.10 * amp + Math.sin(t * 57) * 0.05 * amp, Math.sin(t * 49) * 0.06 * amp, 0);
        } else if (ctx.state === 'overheat') {
          head.rotation.set(0.25 * amp, 0, 0);
        } else {
          head.rotation.set(0, 0, 0);
        }
      },
      // 花茎弯抖（fire）：neck 是 lookNode——fire 时写全幅；非 fire 且回头
      // 状态机空闲（bstate 'aim'）时按衰减 amp 续写收零，gaze/turn 期间不写
      stem: (t, amp, dt, ctx) => {
        if (ctx.state === 'fire' || ctx.bstate === 'aim') {
          neck.rotation.set(0, 0, Math.sin(t * 43) * 0.05 * amp);
        }
      },
    },
    stateAmps: {
      idle: { headSway: 1 },
      aim: { lips: 1 },
      fire: { lips: 1, headSway: 1, stem: 1 },
      overheat: { lips: 1, headSway: 0.8 },
    },
  }, { yawLimit: 2.3, pitchLimit: 0.8, rate: 0.8 });
  // 植物无颈骨限制：花茎整节弯向相机，限位最宽；霰弹枪慢射速 0.8s 大后坐
}

// =================================================================================
// 4. squidlet 乌贼手枪（头足×手枪）：触手冠=枪口、喙藏中心=枪管出口、巨眼两侧
//    通道：tentacles 触手（idle 蠕动 / aim 收拢成锥 / fire 独立相位狂舞）
//          jaw 下喙（fire 张合 / overheat 大张）
// =================================================================================
function buildSquidlet(id, rng) {
  const mats = {
    body: bioMat(0x3f9eb0),        // 青
    accent: bioMat(0xd87828),      // 橙（鳍/触手）
    metal: metalMat(0x4a4f55),     // 枪钢
    beak: bioMat(0x6b4a2f),        // 喙（角质棕）
  };
  const { root, kick, sway } = shell(id);
  root.scale.setScalar(1 + (rng() - 0.5) * 0.06);
  let tris = 0;

  // 静态：外套膜/侧鳍/顶鳍准星/握把/扳机/尾板/枪管/缠握把的腕
  tris += attach(sway, mats, (a) => {
    a.P('body').ellipsoid(0.048, 0.055, 0.075, { y: 0.02, z: -0.04, rings: 5, segs: 8 });
    a.P('accent')
      .ellipsoid(0.030, 0.008, 0.040, { x: 0.045, y: 0.04, z: -0.06, rz: -0.4, rings: 4, segs: 6 })
      .ellipsoid(0.030, 0.008, 0.040, { x: -0.045, y: 0.04, z: -0.06, rz: 0.4, rings: 4, segs: 6 })
      .ellipsoid(0.008, 0.025, 0.035, { y: 0.085, z: 0.0, rings: 4, segs: 6 });   // 顶鳍=准星
    a.box('metal', 0.030, 0.085, 0.042, { y: -0.065, z: -0.050, rx: 0.25 });    // 握把
    a.box('metal', 0.006, 0.018, 0.026, { y: -0.035, z: -0.010 });    // 扳机
    a.box('metal', 0.004, 0.006, 0.036, { y: -0.052, z: -0.006 });    // 护圈底
    a.box('metal', 0.040, 0.045, 0.020, { y: 0.0, z: -0.115 });       // 尾板
    a.P('metal').cyl(0.010, 0.010, 0.10, { rx: Math.PI / 2, y: 0.015, z: 0.10 }); // 枪管
    // 腕足缠握把
    a.P('body').cyl(0.009, 0.011, 0.09, { rx: 1.1, ry: 0.5, x: 0.012, y: -0.060, z: -0.045, radial: 6 })
               .cyl(0.009, 0.011, 0.09, { rx: 1.1, ry: -0.5, x: -0.012, y: -0.060, z: -0.045, radial: 6 });
  });

  // 头（lookNode）：头球 + 上喙；触手冠 6 条独立节点；下喙独立颚组
  const head = new THREE.Group();
  head.position.set(0, 0.01, 0.05);
  sway.add(head);
  const EYE_DEFS = [
    { x: 0.048, y: 0.012, z: 0.010, r: 0.030, fx: 0.3, fy: -0.06, fz: 1 },
    { x: -0.048, y: 0.012, z: 0.010, r: 0.030, fx: -0.3, fy: -0.06, fz: 1 },
  ];
  tris += attach(head, mats, (a) => {
    a.P('body').ellipsoid(0.045, 0.042, 0.045, { rings: 5, segs: 8 });
    // 上喙（lathe 锥，藏在触手冠中心=枪管出口）
    a.P('beak').lathe([[0.012, 0], [0.001, 0.030]], { segs: 6, rx: Math.PI / 2, z: 0.045 });
    emitBrows(a.P('body'), EYE_DEFS);   // 静态眉骨壳
  });

  // 触手冠：6 条小腕各为独立节点（idle 蠕动 / aim 收拢成锥 / fire 独立相位狂舞）
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const TENT_FWD = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS);
  const tents = [];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU + 0.3;
    const d = new THREE.Vector3(Math.cos(a0) * 0.6, Math.sin(a0) * 0.6, 1).normalize();
    const g = new THREE.Group();
    g.position.set(Math.cos(a0) * 0.022, Math.sin(a0) * 0.022, 0.050);
    g.quaternion.setFromUnitVectors(Y_AXIS, d);
    head.add(g);
    tris += attach(g, mats, (a) => {
      a.P('accent').cyl(0.004, 0.008, 0.055, { y: 0.0275, radial: 6 });
    });
    tents.push({ g, baseQ: g.quaternion.clone(), phase: i * 1.13 });
  }

  // 下喙（颚组，开火张开）
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.006, 0.045);
  head.add(jaw);
  tris += attach(jaw, mats, (a) => {
    a.P('beak').lathe([[0.010, 0], [0.001, 0.024]], { segs: 6, rx: Math.PI / 2 });
  });

  const eyes = addEyes(head, mats, EYE_DEFS, 'body');
  tris += eyes.tris;
  const flash = addFlash(head, 0, 0, 0.105);

  const _e = new THREE.Euler(), _qo = new THREE.Quaternion(), _qa = new THREE.Quaternion();
  return finalize({
    id, root, kick, sway, lookNode: head,
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, flash,
    laser: makeLaser(head, 0, 0, 0.105),
    tracer: makeTracer(head, 0, 0, 0.105),
    smoke: makeSmoke(head, 0, 0.02, 0.10),
    hotMats: [mats.body, mats.accent, mats.metal],
    tris,
    channels: {
      // 触手冠：idle 缓慢蠕动 / aim 向前收拢成锥 / fire 每条独立相位疯狂乱舞
      tentacles: (t, amp, dt, ctx) => {
        for (const tn of tents) {
          if (ctx.state === 'aim') {
            _qa.copy(tn.baseQ).slerp(TENT_FWD, 0.7 * amp);
            _e.set(Math.sin(t * 31 + tn.phase) * 0.03 * amp, 0,
              Math.cos(t * 29 + tn.phase) * 0.03 * amp);
            _qo.setFromEuler(_e);
            tn.g.quaternion.copy(_qa).multiply(_qo);
          } else if (ctx.state === 'fire') {
            _e.set(Math.sin(t * 33 + tn.phase * 2.7) * 0.5 * amp,
              Math.sin(t * 27 + tn.phase) * 0.3 * amp,
              Math.cos(t * 39 + tn.phase * 1.7) * 0.5 * amp);
            _qo.setFromEuler(_e);
            tn.g.quaternion.copy(tn.baseQ).multiply(_qo);
          } else {   // idle/overheat：缓慢蠕动
            _e.set(Math.sin(t * 1.6 + tn.phase) * 0.14 * amp, 0,
              Math.cos(t * 1.3 + tn.phase * 1.4) * 0.14 * amp);
            _qo.setFromEuler(_e);
            tn.g.quaternion.copy(tn.baseQ).multiply(_qo);
          }
        }
      },
      // 下喙：fire 张合 / overheat 大张喘气
      jaw: (t, amp, dt, ctx) => {
        let open = amp * 0.4;
        if (ctx.state === 'fire') open += Math.abs(Math.sin(t * 31)) * 0.25 * amp;
        jaw.rotation.x = open;
      },
    },
    stateAmps: {
      idle: { tentacles: 1 },
      aim: { tentacles: 1 },
      fire: { tentacles: 1, jaw: 1 },
      overheat: { tentacles: 0.4, jaw: 0.9 },
    },
  }, { yawLimit: 2.4, pitchLimit: 0.6, rate: 0.2 });
  // 头足类头即胴前段：整球转过来盯人毫无压力；手枪射速 0.2s
}

// =================================================================================
// 5. viperscope 盘蛇狙击枪（爬行×DMR）：拉直蛇身=枪身、蛇头=枪口、信子=拉机柄
//    通道：tongue 信子（idle 偶发吐信 / aim 持续吐出 / overheat 耷拉）
//          coils 盘圈（fire 波浪抖动）/ headWhip（fire 蛇头鞭甩）/ jaw 下颌
// =================================================================================
function buildViperscope(id, rng) {
  const mats = {
    body: bioMat(0x5a6b35),        // 橄榄绿蛇身
    accent: bioMat(0xb03030),      // 信子红
    metal: metalMat(0x484c52),     // 枪钢
    teeth: bioMat(0xe0d8b8),       // 毒牙
  };
  const { root, kick, sway } = shell(id);
  root.scale.setScalar(1 + (rng() - 0.5) * 0.06);
  let tris = 0;

  const COIL = [[0.052, -0.010], [0.064, -0.004], [0.064, 0.004], [0.052, 0.010],
    [0.042, 0.004], [0.042, -0.004], [0.052, -0.010]];

  // 静态：锥形长身（lathe）/瞄准镜/握把扳机
  tris += attach(sway, mats, (a) => {
    a.P('body').lathe(
      [[0.020, -0.26], [0.028, -0.10], [0.028, 0.05], [0.022, 0.18], [0.016, 0.24]],
      { segs: 8, rx: Math.PI / 2, y: 0.01 });
    a.P('metal').cyl(0.015, 0.015, 0.13, { rx: Math.PI / 2, y: 0.055, z: 0.02 })   // 瞄准镜
                .cyl(0.019, 0.015, 0.03, { rx: Math.PI / 2, y: 0.055, z: 0.095 }); // 物镜钟
    a.box('metal', 0.008, 0.025, 0.020, { y: 0.035, z: 0.0 });        // 镜架
    a.box('metal', 0.030, 0.085, 0.042, { y: -0.060, z: -0.100, rx: 0.3 });  // 握把
    a.box('metal', 0.006, 0.020, 0.026, { y: -0.035, z: -0.055 });    // 扳机
    a.box('metal', 0.004, 0.006, 0.036, { y: -0.052, z: -0.048 });    // 护圈底
  });

  // 盘绕两圈（独立节点：fire 波浪式抖动）
  const coils = [];
  for (const cz of [-0.16, -0.06]) {
    const g = new THREE.Group();
    g.position.set(0, 0.01, cz);
    sway.add(g);
    tris += attach(g, mats, (a) => {
      a.P('body').lathe(COIL, { segs: 10, rx: Math.PI / 2 });
    });
    coils.push(g);
  }

  // 蛇信子（独立节点：idle 偶发吐信 / aim 持续吐出 / overheat 耷拉）
  const tongue = new THREE.Group();
  tongue.position.set(0.030, 0.025, -0.020);
  sway.add(tongue);
  tris += attach(tongue, mats, (a) => {
    a.P('accent').cyl(0.003, 0.003, 0.050, { rz: -1.2, x: 0.010, y: 0.005, z: 0, radial: 5 })
                 .cyl(0.002, 0.002, 0.020, { rz: -0.9, ry: 0.4, x: 0.032, y: 0.020, z: 0.005, radial: 5 })
                 .cyl(0.002, 0.002, 0.020, { rz: -0.9, ry: -0.4, x: 0.032, y: 0.020, z: -0.005, radial: 5 });
  });

  // 两节转头：颈节 neckSeg（身体前端一小段可弯颈，几何重排不显著加面）+
  // 头节 head。回头时总偏转按 55%/45% 拆到颈/头（GunActor.turnChain 机制），
  // gaze 呈 S 形回望——真实蛇回头不是整头刚性转 180°。
  const neckSeg = new THREE.Group();
  neckSeg.position.set(0, 0.012, 0.19);       // 颈节 pivot：身体前端
  sway.add(neckSeg);
  tris += attach(neckSeg, mats, (a) => {
    // 颈段：从身体前端到头根的短渐细管
    a.P('body').cyl(0.014, 0.017, 0.07, { rx: Math.PI / 2, z: 0.03, radial: 8 });
  });
  const head = new THREE.Group();
  head.position.set(0, 0, 0.05);              // 头节 pivot：颈段末端
  neckSeg.add(head);
  const EYE_DEFS = [
    { x: 0.030, y: 0.008, z: 0.005, r: 0.019, fx: 0.35, fy: -0.05, fz: 1 },
    { x: -0.030, y: 0.008, z: 0.005, r: 0.019, fx: -0.35, fy: -0.05, fz: 1 },
  ];
  tris += attach(head, mats, (a) => {
    a.P('body').ellipsoid(0.034, 0.022, 0.048, { rings: 5, segs: 8 });  // 三角蛇头
    // 上毒牙外露（向下略后勾）
    a.P('teeth').cyl(0, 0.004, 0.024, { radial: 5, rx: Math.PI - 0.3, x: 0.010, y: -0.012, z: 0.038 })
                .cyl(0, 0.004, 0.024, { radial: 5, rx: Math.PI - 0.3, x: -0.010, y: -0.012, z: 0.038 });
    emitBrows(a.P('body'), EYE_DEFS);   // 静态眉骨壳
  });

  // 下颌（颚组，常态微张）
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.012, 0.01);
  head.add(jaw);
  tris += attach(jaw, mats, (a) => {
    a.P('body').ellipsoid(0.026, 0.010, 0.040, { z: 0.015, rings: 4, segs: 7 });
  });

  const eyes = addEyes(head, mats, EYE_DEFS, 'body');
  tris += eyes.tris;
  const flash = addFlash(head, 0, -0.005, 0.060);

  return finalize({
    id, root, kick, sway, lookNode: neckSeg,
    turnChain: [                            // 颈节 55% / 头节 45%（和为 1，组合=总偏转）
      { node: neckSeg, share: 0.55 },
      { node: head, share: 0.45 },
    ],
    lids: eyes.lids, pupilMesh: eyes.pupilMesh, flash,
    laser: makeLaser(head, 0, -0.005, 0.060),
    tracer: makeTracer(head, 0, -0.005, 0.060),
    smoke: makeSmoke(head, 0, 0.01, 0.055),
    hotMats: [mats.body, mats.accent, mats.metal],
    tris,
    channels: {
      // 信子：idle 偶发吐出抖动 / aim 持续吐出+颤 / overheat 耷拉下来
      tongue: (t, amp, dt, ctx) => {
        if (ctx.state === 'aim') {
          tongue.scale.x = 1 + 0.35 * amp;
          tongue.rotation.set(0, 0, Math.sin(t * 34) * 0.08 * amp);
        } else if (ctx.state === 'overheat') {
          tongue.scale.x = 1 + 0.5 * amp;                  // 拖长
          tongue.rotation.set(0, 0, -0.55 * amp);          // 向下耷拉
        } else {   // idle/fire：偶发快速吐信（幂次脉冲）
          const f = Math.pow(Math.max(0, Math.sin(t * 0.8 + 2)), 20);
          tongue.scale.x = 1 + f * 0.4 * amp;
          tongue.rotation.set(0, 0, f * Math.sin(t * 40) * 0.10 * amp);
        }
      },
      // 盘圈：fire 波浪式抖动（两圈反相位）
      coils: (t, amp) => {
        coils.forEach((g, i) => {
          g.position.y = 0.01 + Math.sin(t * 23 - i * 1.6) * 0.012 * amp;
          g.rotation.z = Math.sin(t * 19 - i * 1.6) * 0.08 * amp;
        });
      },
      // 蛇头鞭甩（fire）：颈节小振幅+头节大振幅（相位错开更像鞭甩）。
      // neckSeg/head 是回头链节点：fire 时写全幅；回到非 fire 且回头状态机空闲
      // （bstate 'aim'）时按衰减 amp 续写，把残余姿态平滑收零——gaze/turn 期间
      // 不写，避免踩掉回头链的姿态。
      headWhip: (t, amp, dt, ctx) => {
        if (ctx.state === 'fire' || ctx.bstate === 'aim') {
          neckSeg.rotation.set(Math.sin(t * 31) * 0.025 * amp, Math.sin(t * 25) * 0.06 * amp, 0);
          head.rotation.set(Math.sin(t * 31 + 0.7) * 0.06 * amp, Math.sin(t * 25 + 0.7) * 0.16 * amp, 0);
        }
      },
      // 下颌：fire 猛合 / overheat 大张喘气
      jaw: (t, amp, dt, ctx) => {
        let open = 0.06 + amp * 0.35;
        if (ctx.state === 'fire') open += Math.abs(Math.sin(t * 29)) * 0.2 * amp;
        jaw.rotation.x = open;
      },
    },
    stateAmps: {
      idle: { tongue: 1 },
      aim: { tongue: 1 },
      fire: { tongue: 0.5, coils: 1, headWhip: 1, jaw: 1 },
      overheat: { jaw: 1, tongue: 1 },
    },
  }, { yawLimit: Math.PI, pitchLimit: 0.7, rate: 0.9 });
  // 狙击单发重射速 0.9s
}

// --- 方向目录 ----------------------------------------------------------------------
export const GUN_DEFS = [
  { id: 'stagbite', name: '锹甲冲锋枪', desc: '大颚包枪管收束成枪口，鞘翅合抱当护木（昆虫×SMG）', build: buildStagbite },
  { id: 'crocmaw', name: '鳄吻步枪', desc: '长吻即枪管、嘴即枪口，背鳞排成皮卡汀尼导轨（爬行×步枪）', build: buildCrocmaw },
  { id: 'flytrap', name: '食人花霰弹枪', desc: '喇叭花口散射、唇圈尖牙，藤蔓缠握把（植物×霰弹枪）', build: buildFlytrap },
  { id: 'squidlet', name: '乌贼手枪', desc: '触手冠即枪口、喙藏中心，巨眼盯梢（头足×手枪）', build: buildSquidlet },
  { id: 'viperscope', name: '盘蛇狙击枪', desc: '蛇身即枪身、蛇信子当拉机柄，整头转 180°（爬行×DMR）', build: buildViperscope },
];
