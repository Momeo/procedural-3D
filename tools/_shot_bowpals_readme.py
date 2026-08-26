# -*- coding: utf-8 -*-
# 给开源库 README 补拍 bow pals 截图：gallery（五弓并排）+ release（释放反应特写）
import sys, time, os
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8622/_open_source/procedural-3D/examples/bowpals.html'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'screenshots')

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True,
                          args=['--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1600, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE, wait_until='networkidle')
    pg.wait_for_function('window.__bowpals && window.__bowpals.ready', timeout=20000)
    time.sleep(2.5)  # 等活体动画进入 idle（回头看你）状态

    # 1) gallery：默认全景，五弓并排。隐藏左上角面板让画面干净。
    pg.evaluate("document.getElementById('panel').style.display='none';"
                "document.getElementById('hint').style.display='none'")
    time.sleep(0.3)
    pg.screenshot(path=OUT + r'\bowpals_gallery.png')

    # 2) release：不推镜头，触发 dracobow 释放反应，三个时刻各抓一张脸部特写再挑
    pg.evaluate("window.__bowpals.select(2)")
    time.sleep(0.4)
    pg.evaluate("window.__bowpals.release(2)")
    for tag, wait in (('t1', 0.08), ('t2', 0.10), ('t3', 0.14)):
        time.sleep(wait)
        pg.screenshot(path=OUT + rf'\bowpals_release_{tag}.png',
                      clip={'x': 640, 'y': 150, 'width': 340, 'height': 420})

    b.close()
    if errors:
        print('PAGE ERRORS:', errors)
        sys.exit(1)
    print('OK: bowpals_gallery.png, bowpals_release.png')
