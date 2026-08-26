"""布偶三种（butler/doctordoll/bridedoll）部位碰撞盒专项探针：
a. 盒表：三种各部位盒全尺寸（bind 局部，×scale 前）——改前改后对比用
b. 确定性点名射击（raycast 纯查询，侧向/正向自设原点，避免别只怪遮挡）：
   - 头盒心 → part=head（三种；doctordoll 喙区前伸点也应判 head——喙是面具本体）
   - 躯干盒心 → part=torso
   - 臂盒心（侧向射击）→ part=arm（doctor/bride 修复核心：臂盒不再被躯干盒盖住）
   - 罩衣/裙摆下摆外侧点（袍/裙罩着的空气，腿盒之外）→ miss（不算躯干）
c. index.html?vol=1 碰撞体可视化截图（--shot 前缀区分改前/改后）
用法: ../../../test_venv/Scripts/python.exe _probe_dollhit.py [shots_prefix]
      （在 demo/ 下跑，需 8622 服务已从仓库根起好）
"""
import time, sys, math
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8622/_open_source/procedural-3D/examples"
SPECIES = ["butler", "doctordoll", "bridedoll"]
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "dollhit"

fails = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name, detail)
    if not cond:
        fails.append(name)

def wait_ready(page, hook, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = page.evaluate(f"window.{hook} || null")
        if st and st.get("ready"):
            return True
        time.sleep(1.5)
    return False

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True,
        args=["--enable-unsafe-swiftshader", "--disable-gpu"])

    for sid in SPECIES:
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(f"{BASE}/shooter.html?species={sid}&n=8")
        ok = wait_ready(page, "__shooter")
        check(f"{sid} ready", ok)
        if not ok:
            page.close()
            continue

        # --- a. 盒表 -----------------------------------------------------
        boxes = page.evaluate("""(() => {
          const parts = {};
          for (const p of ['head','torso','hips','arm','leg']) {
            const h = window.__shooter.boxHalf(0, p);
            if (h) parts[p] = h.map(v => +(v*2).toFixed(3));
          }
          return parts; })()""")
        print(f"  盒表[{sid}]（全尺寸 m，bind 局部）: {boxes}")

        # --- b. 点名射击（单次 evaluate 内读完即射，防走动时差） ----------
        res = page.evaluate("""(() => {
          const s = window.__shooter;
          const out = {};
          let i0 = -1, info = null;
          for (let i = 0; i < 8; i++) {
            const inf = s.instInfo(0, i);
            if (inf && inf.dead === 0) { i0 = i; info = inf; break; }
          }
          if (i0 < 0) return null;
          const hd = info.heading, sc = info.scale;
          const lat = [Math.cos(hd), 0, -Math.sin(hd)];   // 局部 +x
          const fwd = [Math.sin(hd), 0, Math.cos(hd)];    // 局部 +z（面朝）
          const shoot = (label, ox, oy, oz, tx, ty, tz) => {
            const r = s.raycast(ox, oy, oz, tx - ox, ty - oy, tz - oz);
            out[label] = r ? `${r.part}@b${r.batch}i${r.inst}` : 'miss';
          };
          const head = s.partCenter(0, i0, 'head');
          const torso = s.partCenter(0, i0, 'torso');
          const arm = s.partCenter(0, i0, 'arm');
          const hhT = s.boxHalf(0, 'torso'), hhH = s.boxHalf(0, 'head');
          // 头：正面 5m 瞄头盒心
          shoot('head', head[0] + fwd[0]*5, head[1], head[2] + fwd[2]*5,
                head[0], head[1], head[2]);
          // 喙区：头盒心前伸 0.8×头盒半深（doctordoll 修复后此处属头盒）
          shoot('beak', head[0] + fwd[0]*5, head[1], head[2] + fwd[2]*5,
                head[0] + fwd[0]*hhH[2]*0.8*sc, head[1], head[2] + fwd[2]*hhH[2]*0.8*sc);
          // 躯干：正面瞄躯干盒心
          shoot('torso', torso[0] + fwd[0]*5, torso[1], torso[2] + fwd[2]*5,
                torso[0], torso[1], torso[2]);
          // 臂：从臂所在侧（按臂盒心相对体心的局部 x 符号）5m 瞄臂盒心——
          // 臂盒外缘必先于躯干盒；另记一发正面射击作参考（正面对侧臂可能被
          // 躯干盒合法遮挡，不作门禁）
          const sgn = ((arm[0] - info.x) * lat[0] + (arm[2] - info.z) * lat[2]) >= 0 ? 1 : -1;
          shoot('arm_side', arm[0] + sgn*lat[0]*5, arm[1], arm[2] + sgn*lat[2]*5,
                arm[0], arm[1], arm[2]);
          shoot('arm_front', arm[0] + fwd[0]*5, arm[1], arm[2] + fwd[2]*5,
                arm[0], arm[1], arm[2]);
          // 罩衣下摆外侧点：体侧 0.9×躯干盒半宽、及膝高度（袍/裙空气，腿盒外）
          const hx = info.x, hz = info.z, hy = 0.35 * sc;
          const px = hx + lat[0]*hhT[0]*0.9*sc, pz = hz + lat[2]*hhT[0]*0.9*sc;
          shoot('robe_hem', px + lat[0]*5, hy, pz + lat[2]*5, px, hy, pz);
          return out; })()""")
        print(f"  射击[{sid}]: {res}")
        if res:
            check(f"{sid} 头盒心→head", res["head"].startswith("head"), res["head"])
            check(f"{sid} 躯干盒心→torso", res["torso"].startswith("torso"), res["torso"])
            check(f"{sid} 臂盒心(臂侧向)→arm", res["arm_side"].startswith("arm"),
                  f"{res['arm_side']}（正面参考 {res['arm_front']}）")
            check(f"{sid} 罩衣下摆外侧→不算躯干（miss 或中后面的腿盒均合法）",
                  not res["robe_hem"].startswith("torso"), res["robe_hem"])
            if sid == "doctordoll":
                check("doctordoll 喙区→head（喙是面具本体）",
                      res["beak"].startswith("head"), res["beak"])
        check(f"{sid} 页面无错误", not errs, repr(errs[:2]))
        page.close()

        # --- c. 碰撞体可视化截图 ------------------------------------------
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(f"{BASE}/single.html?species={sid}&vol=1&yaw=0.9&pitch=0.12&dist=4.2")
        wait_ready(page, "__pmtk")
        time.sleep(3)
        page.screenshot(path=f"_dev_shots/{PREFIX}_{sid}.png")
        page.close()

    browser.close()

print("RESULT:", "FAIL %s" % fails if fails else "ALL PASS")
