#!/usr/bin/env python3
"""真机实时逐关实玩监控 v3（只读，零注入）：
游戏按自身 60fps 时钟真实运行（test=1 自动驾驶）。
核心判据：观察到"进入第 N 关"即证明第 N-1 关已清（进入关卡是持久稳定状态，
不依赖能否赶上 1.2s 的 LEVEL CLEAR 结算帧）。
- 每首次进入第 L 关：截图（HUD 显示 LEVEL L + 该关砖墙）+ 记录 type/score/lives/耗时
- 1..100 全清 = 观察到进入第 101 关 -> PASS
- 任何 gameover(非win) -> FAIL
"""
import asyncio, json, time, os, urllib.request
from PIL import Image
import websockets

ADB = '/home/kylin/.local/sdk/platform-tools/adb'
OUT = '/mnt/e/codex/breakout/.orchestr/breakout/realtime100'
os.makedirs(OUT + '/levels', exist_ok=True)
J = OUT + '/levels.json'
LOGF = OUT + '/monitor.log'
TARGET = 100            # 要证明清掉的关数 1..100
DONE_LEVEL = TARGET + 1  # 进入 101 即证明 1..100 全清
TIMEOUT = 8 * 3600

def sh(cmd):
    import subprocess
    return subprocess.run(cmd, shell=True, capture_output=True, timeout=60)

def shot(name):
    try:
        p = f"{OUT}/levels/{name}"
        sh(f"{ADB} exec-out screencap -p > {p}")
        Image.open(p).convert('RGB').save(p.replace('.png', '_v.png'))
        return True
    except Exception as e:
        log(f'shot err {name}: {e}')
        return False

def log(m):
    line = f"{time.strftime('%F %T')} {m}"
    print(line, flush=True)
    with open(LOGF, 'a') as f:
        f.write(line + '\n')

def page_ws():
    try:
        lst = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json/list', timeout=5).read().decode())
        for t in lst:
            if t.get('webSocketDebuggerUrl') and 'Breakout' in t.get('title', ''):
                return t['webSocketDebuggerUrl']
    except Exception:
        pass
    return None

def reconnect():
    pid = sh(f"{ADB} shell pidof com.secops.breakout").stdout.decode().strip()
    if not pid:
        return False
    sh(f"{ADB} forward tcp:9222 localabstract:webview_devtools_remote_{pid}")
    return page_ws() is not None

def build_records(entered, t0, status, reason=''):
    """entered: {level: {type,score,lives,t_min}} 首次进入记录。
    cleared 1..(max-1)。证据截图：清掉第 k 关 -> 进入第 k+1 关的画面 level_{k+1}。"""
    max_lvl = max(entered) if entered else 0
    cleared = list(range(1, min(max_lvl, TARGET) + 1))
    recs = []
    for k in cleared:
        ev = entered.get(k + 1)
        recs.append({'cleared_level': k,
                     'evidence': f"entered level {k+1}" if ev else 'inferred (level jump)',
                     'shot': f'level_{k+1:03d}.png' if ev else None,
                     'score_at_next': ev.get('score') if ev else None,
                     't_min': ev.get('t_min') if ev else None})
    return {
        'status': status, 'reason': reason,
        'maxLevelEntered': max_lvl,
        'clearedCount': len(cleared),
        'cleared': recs,
        'enterLog': {str(k): v for k, v in sorted(entered.items())},
        'elapsed_min': round((time.time() - t0) / 60, 2),
        'verdict': 'PASS' if (status == 'done' and len(cleared) == TARGET)
                   else ('FAIL' if status == 'failed' else 'incomplete'),
    }

def save(entered, t0, status, reason=''):
    with open(J, 'w') as f:
        json.dump(build_records(entered, t0, status, reason), f, ensure_ascii=False, indent=1)

async def main():
    t0 = time.time()
    entered = {}
    log(f'=== realtime level-by-level monitor v3 start, target cleared 1..{TARGET} ===')
    while time.time() - t0 < TIMEOUT:
        wsurl = page_ws()
        if wsurl is None:
            if reconnect():
                wsurl = page_ws()
            if wsurl is None:
                await asyncio.sleep(5); continue
        try:
            async with websockets.connect(wsurl, max_size=None, open_timeout=10) as ws:
                mid = 0
                async def cmd(method, params=None):
                    nonlocal mid; mid += 1
                    await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
                    while True:
                        m = json.loads(await asyncio.wait_for(ws.recv(), 20))
                        if m.get('id') == mid: return m
                await cmd('Runtime.enable')
                while time.time() - t0 < TIMEOUT:
                    r = await cmd('Runtime.evaluate',
                        {'expression': 'JSON.stringify(__breakout ? __breakout.getState() : null)', 'returnByValue': True})
                    val = r.get('result', {}).get('result', {}).get('value')
                    if val and val != 'null':
                        st = json.loads(val)
                        lvl = st.get('level')
                        if st.get('state') == 'gameover' and not st.get('win'):
                            save(entered, t0, 'failed', f'gameover at level {lvl}')
                            shot(f'gameover_level_{lvl:03d}.png')
                            log(f'=== FAILED: gameover at level {lvl}, cleared {min(max(entered)-1,0) if entered else 0}+ ===')
                            return
                        if lvl and lvl > DONE_LEVEL - 1 and st.get('state') in ('playing', 'levelclear'):
                            # 进入 101 -> 1..100 全清
                            if lvl not in entered:
                                entered[lvl] = {'type': st.get('lvType'), 'score': st.get('score'),
                                                'lives': st.get('lives'), 't_min': round((time.time() - t0)/60, 2)}
                                shot(f'level_{lvl:03d}.png')
                                log(f"ENTER level {lvl} -> ALL 1..{TARGET} CLEARED")
                            save(entered, t0, 'done')
                            shot('final_level101.png')
                            log(f'=== DONE: 1..{TARGET} all cleared, total {(time.time()-t0)/60:.1f}min ===')
                            return
                        # 首次进入某关（含跳关补齐截图机会）
                        if lvl and lvl not in entered and lvl <= DONE_LEVEL:
                            entered[lvl] = {'type': st.get('lvType'), 'score': st.get('score'),
                                            'lives': st.get('lives'), 't_min': round((time.time() - t0)/60, 2)}
                            ok = shot(f'level_{lvl:03d}.png')
                            log(f"ENTER level {lvl} (type {st.get('lvType')}, score {st.get('score')}, lives {st.get('lives')}, t={(time.time()-t0)/60:.1f}min) shot={'ok' if ok else 'MISS'}")
                            save(entered, t0, 'incomplete')
                    await asyncio.sleep(0.3)
        except Exception as e:
            log(f'conn error: {e!r} — reconnecting')
            await asyncio.sleep(5)
    save(entered, t0, 'incomplete', 'timeout')
    log(f'=== TIMEOUT, max entered {max(entered) if entered else 0} ===')

asyncio.run(main())
