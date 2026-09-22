#!/usr/bin/env python3
"""真接管控制器 v3：adb 触摸 + 截图像素检测。零 JS 注入、零 test 钩子。
球 = 纯白紧凑簇(60..400 采样px)；overlay(title/gameover/levelclear) = 中央带大字簇(n>800)。
落点：最近 2 帧速度 + 直线外推(上升球含顶墙反射) + 水平墙折叠。
挡板：真 swipe 瞬移（引擎 pointerActive 时挡板中心=触点 x）。
"""
import subprocess, sys, time, os
from PIL import Image

ADB = os.path.expanduser("~/.local/sdk/platform-tools/adb")
LOG = "/mnt/e/codex/breakout/.orchestr/breakout/emulator-handplay.log"
RUN_SECS = int(sys.argv[1]) if len(sys.argv) > 1 else 900
PADDLE_Y = 1338
WALL_L, WALL_R = 248, 2312
TAP_X, TAP_Y = 1280, 720
CYCLE = 0.30  # 目标循环周期

def adb(*a):
    subprocess.run([ADB, *a], capture_output=True, timeout=30)

def shot():
    subprocess.run(f"{ADB} exec-out screencap -p > /tmp/hp.png", shell=True, timeout=30)
    try:
        im = Image.open("/tmp/hp.png").convert("RGB")
    except Exception:
        return None
    return im if im.size[0] > 1000 else None

def log(m):
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%T')} {m}\n")
    print(m, flush=True)

def find_blobs(im):
    W, H = im.size
    px = im.load()
    c = {}
    for y in range(140, 1325, 2):
        for x in range(205, 2355, 2):
            r, g, b = px[x, y]
            if r > 240 and g > 240 and b > 240:
                c[(y // 16, x // 16)] = c.get((y // 16, x // 16), 0) + 1
    merged = {}
    for k, v in c.items():
        best = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if (k[0] + dy, k[1] + dx) in merged:
                    best = (k[0] + dy, k[1] + dx); break
            if best: break
        if best:
            e = merged[best]; e[0] += v * k[1] * 16; e[1] += v * k[0] * 16; e[2] += v
        else:
            merged[k] = [v * k[1] * 16, v * k[0] * 16, v]
    return [(sx / n, sy / n, n) for [sx, sy, n] in merged.values()]

def fold(tx):
    L, R = WALL_L, WALL_R
    span = 2 * (R - L)
    while tx < L or tx > R:
        if tx < L: tx = 2 * L - tx
        elif tx > R: tx = 2 * R - tx
    return tx

def main():
    t_end = time.time() + RUN_SECS
    log(f"=== handplay v3 begin {RUN_SECS}s ===")
    prev = None       # (x, y, t)
    prev2 = None
    est_pad = 1280
    i = 0
    taps = 0
    while time.time() < t_end:
        t0 = time.time()
        im = shot()
        if im is None:
            time.sleep(0.4); continue
        blobs = find_blobs(im)
        center_big = [b for b in blobs if b[2] > 800 and 600 < b[0] < 1960 and 380 < b[1] < 900]
        balls = [b for b in blobs if 60 <= b[2] <= 400 and b[1] < 1320 and
                 not (b[2] > 800 and 600 < b[0] < 1960 and 380 < b[1] < 900)]
        if not balls:
            if center_big or not blobs:
                adb("shell", "input", "tap", str(TAP_X), str(TAP_Y))
                taps += 1
                log(f"iter {i}: no ball -> tap#{taps} (start/next/restart) overlay={len(center_big)}")
                prev = prev2 = None
                i += 1
                time.sleep(0.7); continue
            i += 1
            continue
        balls.sort(key=lambda b: -b[1])
        bx, by, n = balls[0]
        now = time.time()
        # 速度：最近 2 个有效采样（跨墙反射会失真，用 |dy|/|dt| 限制窗口 0.9s）
        vx = vy = 0.0
        if prev and now - prev[2] < 0.95:
            dt = max(now - prev[2], 1e-3)
            vx = (bx - prev[0]) / dt
            vy = (by - prev[1]) / dt
        prev2, prev = prev, (bx, by, now)
        tx = bx
        if vy > 40:      # 下降：直接外推
            t_hit = (PADDLE_Y - by) / vy
            tx = fold(bx + vx * t_hit)
        elif vy < -40:   # 上升：先顶墙反射
            t_hit = (by + PADDLE_Y) / (-vy)
            tx = fold(bx + vx * t_hit)
        tx = max(WALL_L + 8, min(WALL_R - 8, tx))
        adb("shell", "input", "swipe", str(int(est_pad)), str(PADDLE_Y), str(int(tx)), str(PADDLE_Y), "150")
        est_pad = int(tx)
        i += 1
        if i % 6 == 1:
            log(f"iter {i}: balls={len(balls)} b0=({bx:.0f},{by:.0f}) v=({vx:.0f},{vy:.0f}) tgt={tx:.0f}")
        dtl = time.time() - t0
        if dtl < CYCLE:
            time.sleep(CYCLE - dtl)
    log(f"=== handplay v3 end: iters={i} taps={taps} ===")

if __name__ == "__main__":
    main()
