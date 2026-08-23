"""质检探针（quality.html 的硬门禁）：
a. 起页等 __quality.ready → 断言全物种零 BLOCK、零 FAIL（baseline IoU 全 ≥0.85）
b. __quality.newBaseline 非空 → 合并写回 demo/_quality_baseline.json；
   覆盖已有物种条目时打印 WARNING（剪影变了需人确认；首轮全量新建属正常）
b2. 修型确认通道：`--accept id1,id2` —— 对 IoU<0.85 被判 FAIL 的物种，把当前
   剪影强制收录为新 baseline（打 WARNING；这就是修型轮的人工确认动作。
   不带 --accept 时 FAIL 维持，回归守卫不松）
c. 静态检查：species/*.js 无「裸 Math.random」——排除注释行后，行首缩进为 0
   （模块顶层）的命中算 FAIL（withSeed 包不住模块加载期随机）；
   函数体内命中属既有祝福模式（withSeed 流内），列出供人工确认，不判 FAIL；
   确定性硬门槛是跨加载契约（_probe_seed.py 快照 + 本页剪影 IoU baseline）——
   不能查「同页两次构建」：core 模块级几何缓存（VENT Map 等）首建吃种子流、
   次建命中缓存，同页双建必然发散，属误报。
d. 每物种四视图拼图存 _shots/quality_<id>.png + 总览 _shots/quality_all.png
e. 打印各物种指标摘要表 + RESULT: ALL PASS / FAIL
用法: test_venv 的 python _probe_quality.py [--accept id1,id2]
      （在 tools/ 下跑，需 8622 服务已从仓库根起好：python -m http.server 8622）
"""
import time, json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8622/_open_source/procedural-3D/tools"
BASELINE = Path(__file__).parent / "_quality_baseline.json"
SPECIES_DIR = Path(__file__).parent.parent / "src" / "species"

fails = []

# 修型确认通道：--accept id1,id2（IoU<0.85 FAIL 种的当前剪影强制收录为 baseline）
ACCEPT = []
if "--accept" in sys.argv:
    ACCEPT = sys.argv[sys.argv.index("--accept") + 1].split(",")

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name, detail)
    if not cond:
        fails.append(name)

# ===================== c. 静态检查：裸 Math.random ==========================
print("--- 静态检查 species/*.js 裸 Math.random ---")
for f in sorted(SPECIES_DIR.glob("*.js")):
    in_block = False
    top_hits, inner_hits = [], 0
    for ln, raw in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        line = raw
        # 粗剔除块注释（本目录块注释不嵌套、行内 `/* */` 不成对出现跨行）
        out = ""
        i = 0
        while i < len(line):
            if in_block:
                j = line.find("*/", i)
                if j < 0: i = len(line)
                else: in_block = False; i = j + 2
            elif line.startswith("/*", i):
                j = line.find("*/", i + 2)
                if j < 0: in_block = True; i = len(line)
                else: i = j + 2
            elif line.startswith("//", i):
                break
            else:
                out += line[i]; i += 1
        if "Math.random" not in out:
            continue
        if raw == raw.lstrip():  # 行首无缩进 = 模块顶层（withSeed 包不住的裸随机）
            top_hits.append(ln)
        else:
            inner_hits += 1
    check(f"{f.name} 模块顶层无 Math.random", not top_hits, f"行 {top_hits}" if top_hits else "")
    if inner_hits:
        print(f"  info {f.name}: {inner_hits} 处函数体内 Math.random（withSeed 流内祝福模式）")

# ===================== a/b/d. 页面质检 ======================================
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True,
        args=["--enable-unsafe-swiftshader", "--disable-gpu"])
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{BASE}/quality.html?noname=1")   # noname：出的图不带物种名（盲评防剧透）
    t0 = time.time()
    ready = False
    while time.time() - t0 < 300:
        st = page.evaluate("window.__quality || null")
        if st and st.get("ready"):
            ready = True
            break
        time.sleep(2)
    check("quality ready", ready)
    check("页面无错误", not errs, repr(errs[:2]))
    if not ready:
        browser.close()
        print("RESULT:", "FAIL %s" % fails)
        sys.exit(1)

    q = page.evaluate("window.__quality")
    results, new_bl = q["results"], q["newBaseline"]

    print("--- spec 校验与剪影指标摘要 ---")
    hdr = f"{'物种':<12} {'tri':>5} {'jnt':>4} {'组':>3} {'头/躯干':>7} | 正(fill/asp/turn/iou) 侧 45° 顶"
    print(hdr)
    n_block = n_warn = 0
    for sid, r in results.items():
        n_block += len(r["blocks"]) + len(r["fails"])
        n_warn += len(r["warns"])
        ratio = f"{r['headVol'] / r['torsoVol']:.2f}" if r["torsoVol"] else "-"
        cell = []
        for vk in ["front", "side", "diag45", "top"]:
            v = r["views"][vk]
            iou_s = f"{v['iou']:.2f}" if v["iou"] is not None else "  new"
            cell.append(f"{v['fill']:.2f}/{v['aspect']:.2f}/{v['turns']}/{iou_s}")
        print(f"{sid:<12} {r['tri']:>5} {r['joints']:>4} {r['parts']:>3} {ratio:>7} | " + "  ".join(cell))
        for b in r["blocks"]: print("  " + b)
        for f_ in r["fails"]: print("  " + f_)
        for w in r["warns"]: print("  " + w)

    check("全物种零 BLOCK", all(not r["blocks"] for r in results.values()))
    unaccepted_fails = [sid for sid, r in results.items()
                        if r["fails"] and sid not in ACCEPT]
    check("全物种零 FAIL（IoU 回归全 ≥0.85）", not unaccepted_fails,
          "未确认修型: " + ",".join(unaccepted_fails) if unaccepted_fails else "")
    print(f"warn 合计 {n_warn} 条（不阻塞，人工判断）")

    # --- b/b2. baseline 落盘 ---------------------------------------------------
    # 修型确认：--accept 的 FAIL 种当前剪影强制收录（WARNING 明示这是人工确认动作）
    accept_entries = {sid: q.get("failed", {}).get(sid) for sid in ACCEPT}
    for sid, entry in accept_entries.items():
        if entry:
            new_bl[sid] = entry
            print(f"WARNING: --accept 修型确认 baseline[{sid}]（剪影大改已人工确认）")
        elif sid in results:
            print(f"WARNING: --accept {sid} 无 FAIL 记录（无需确认，忽略）")
        else:
            print(f"WARNING: --accept {sid} 不在注册表（忽略）")
    if new_bl:
        old = {}
        if BASELINE.exists():
            old = json.loads(BASELINE.read_text(encoding="utf-8")).get("species", {})
        merged = dict(old)
        for sid, entry in new_bl.items():
            if sid in old:
                print(f"WARNING: baseline[{sid}] 被更新（剪影微漂移，需人确认是否接受新剪影）")
            else:
                print(f"baseline 新建: {sid}")
            merged[sid] = entry
        BASELINE.write_text(
            json.dumps({"version": 1, "species": merged}, ensure_ascii=False, indent=1),
            encoding="utf-8")
        print(f"baseline 已写回 {BASELINE.name}（物种 {len(merged)} 个）")
    else:
        print("baseline 无变更（零新建零更新）")

    # --- d. 截图 --------------------------------------------------------------
    Path("_shots").mkdir(exist_ok=True)
    for sid in results:
        el = page.query_selector(f"#shot-{sid}")
        if el:
            el.screenshot(path=f"_shots/quality_{sid}.png")
    page.screenshot(path="_shots/quality_all.png", full_page=True)
    print(f"截图: _shots/quality_*.png ×{len(results)} + quality_all.png")
    browser.close()

print("RESULT:", "FAIL %s" % fails if fails else "ALL PASS")
