#!/usr/bin/env python3
"""真机 WebView 实跑 Breakout 999 前 100 关（CDP 驱动，引擎 stepOnce 逐步）。
验收标准：level 1..100 全部被真实通关（可破坏砖块全清），任意一关 gameover 即 FAIL。
testMode 的球体永生/自动驾驶仅用于证明"该关可被清完"；关卡几何、碰撞、通关条件均为生产代码。
"""
import asyncio, json, re, time
import urllib.request
import websockets

INSTALL = """
(function(){
  if (globalThis.__drv2) return 'already';
  globalThis.__drv2 = {
    cleared: {},        // level -> {score, type, stepsInLevel}
    maxLevel: 1,
    lastCleared: 0,
    steps: 0,
    status: 'running',
    reason: ''
  };
  return 'installed';
})()
"""

# 每次最多推 STEP_LIMIT 步或清完 LIMIT_CLEAR 关就交还主线程，避免手机长卡顿
CHUNK = """
(function(){
  var d = globalThis.__drv2, h = globalThis.__breakout;
  if (!d || d.status !== 'running') return JSON.stringify({status:d?d.status:'nondrv'});
  var STEP_LIMIT = 80000, LIMIT_CLEAR = 12;
  if (Object.keys(d.cleared).length >= 100) { d.status = 'done'; return JSON.stringify({status:'done'}); }
  var steps = 0, clearedThisChunk = 0;
  while (d.status === 'running') {
    var s = h.getState();
    if (Object.keys(d.cleared).length >= 100) { d.status = 'done'; break; }
    if (s.state === 'gameover') {
      d.status = 'failed';
      d.reason = 'gameover at level ' + s.level + ' (lost all lives), score=' + s.score;
      break;
    }
    if (s.level > d.maxLevel) d.maxLevel = s.level;
    if (s.state === 'levelclear') {
      if (s.level !== d.lastCleared) {
        d.cleared[s.level] = { score: s.score, type: s.lvType, stepsInLevel: d.steps };
        d.lastCleared = s.level;
        clearedThisChunk++;
      }
    }
    if (steps >= STEP_LIMIT || clearedThisChunk >= LIMIT_CLEAR) break;
    h.stepOnce(); steps++; d.steps++;
  }
  return JSON.stringify({
    status: d.status, reason: d.reason, maxLevel: d.maxLevel,
    clearedCount: Object.keys(d.cleared).length, steps: d.steps,
    cur: h.getState()
  });
})()
"""

async def main():
    lst = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json/list').read().decode())
    page = [t for t in lst if t.get('webSocketDebuggerUrl') and 'Breakout' in t.get('title', '')][0]
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None) as ws:
        mid = 0
        async def cmd(method, params=None):
            nonlocal mid
            mid += 1
            await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get('id') == mid:
                    return m
        await cmd('Runtime.enable')
        # 干净重载：回到 level 1 全新开局（?test=1 自动 start）
        await cmd('Page.enable')
        await cmd('Page.reload', {'ignoreCache': True})
        await asyncio.sleep(3.0)
        r = await cmd('Runtime.evaluate', {'expression': 'JSON.stringify(__breakout.getState())', 'returnByValue': True})
        print('reloaded state:', r['result']['result'].get('value'), flush=True)
        r = await cmd('Runtime.evaluate', {'expression': INSTALL, 'returnByValue': True})
        print('install:', r['result']['result'].get('value'), flush=True)
        t0 = time.time()
        for it in range(80):
            r = await cmd('Runtime.evaluate', {'expression': CHUNK, 'returnByValue': True})
            res = r['result'].get('result', {})
            if 'value' not in res:
                print('EVAL ERROR:', json.dumps(r['result'], ensure_ascii=False)[:400], flush=True)
                break
            v = json.loads(res['value'])
            cur = v.get('cur', {})
            print(f"[{time.time()-t0:6.1f}s] status={v['status']} maxLevel={v['maxLevel']} cleared={v['clearedCount']} state={cur.get('state')} level={cur.get('level')} score={cur.get('score')}", flush=True)
            if v['status'] == 'failed':
                print('REASON:', v['reason'], flush=True)
                break
            if v.get('maxLevel', 0) >= 101:   # 推进到 101 = 已清完 1..100
                break
        # 最终汇总
        r = await cmd('Runtime.evaluate', {'expression': 'JSON.stringify(__drv2)', 'returnByValue': True})
        final = json.loads(r['result']['result']['value'])
        cleared = sorted(int(k) for k in final['cleared'].keys())
        missing = [n for n in range(1, 101) if n not in cleared]
        print('=== SUMMARY ===', flush=True)
        print('totalSteps:', final['steps'], ' elapsed:', f"{time.time()-t0:.1f}s", flush=True)
        print('cleared levels count:', len(cleared), flush=True)
        print('maxLevel reached:', final['maxLevel'], ' status:', final['status'], final['reason'], flush=True)
        print('missing from 1..100:', missing[:20], flush=True)
        print('types seen:', sorted(set(t['type'] for t in final['cleared'].values())), flush=True)
        # 存证
        with open('/mnt/e/codex/breakout/.orchestr/breakout/phone_run100.json', 'w') as f:
            json.dump({
                'phone': 'emulator-5554 WebView (test build)',
                'final': final,
                'clearedCount': len(cleared),
                'missing': missing,
                'verdict': 'PASS' if (final['status'] == 'running' and not missing) else 'FAIL',
            }, f, ensure_ascii=False, indent=1)
        print('saved phone_run100.json', flush=True)

asyncio.run(main())
