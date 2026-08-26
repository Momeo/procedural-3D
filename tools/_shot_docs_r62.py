"""开源 staging docs/screenshots 刷新（一次性）：doll_lineup.png（9 玩偶全家福）
与 doll_horde.png（mix_doll 玩偶海）。从 examples 页实拍。
在 _open_source/procedural-3D/ 下跑：python tools/_shot_docs_r62.py
需 8622 服务已从仓库根起好。
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8622/_open_source/procedural-3D/examples"
OUT = Path(__file__).parent.parent / "docs" / "screenshots"

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
    # 玩偶全家福（九种并排）
    page = browser.new_page(viewport={"width": 1900, "height": 800})
    page.goto(f"{BASE}/lineup.html?species=dollette,dollad,kitdoll,pupdoll,twinsie,butler,bigdoll,doctordoll,bridedoll&dist=14&pitch=0.10")
    if wait_ready(page, "__pmtk"):
        time.sleep(1.5)
        page.screenshot(path=str(OUT / "doll_lineup.png"))
        print("doll_lineup.png ok")
    page.close()
    # 玩偶海（mix_doll 300 只）
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(f"{BASE}/horde.html?species=mix_doll&n=300")
    if wait_ready(page, "__horde"):
        page.evaluate("window.__horde.setCam(0.5, 0.10, 14)")
        time.sleep(1.2)
        page.screenshot(path=str(OUT / "doll_horde.png"))
        print("doll_horde.png ok")
    page.close()
    browser.close()
