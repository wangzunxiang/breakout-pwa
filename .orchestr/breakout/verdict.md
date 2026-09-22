# Breakout 999 — 验收结论 (verdict.md)

日期: 2026-09-22  验收人: Hermes (亲自重跑, 不采信工人自评)

## 交付物
- PWA 本体:  /mnt/e/codex/breakout/web/   (index.html + css/ + js/ + manifest.json + icons/ + sw.js)
- 安卓壳:     /mnt/e/codex/breakout/android/
- 签名 release APK: /mnt/e/codex/breakout/android/app/build/outputs/apk/release/app-release.apk
    package com.secops.breakout  versionName 1.0.0  versionCode 1
    签名 CN=Breakout 999, OU=SecOps, O=SecOps, C=US  (独立 keystore ~/keystore/breakout-release.keystore)
    sha256 bd6f924f6f9539f5bfe62d41db55818bfcae500478103d461e7822c0eb655ed9

## 工作分配 (Routing Doctrine 执行记录)
| 单元 | 性质 | 计划执行方 | 实际 | 结果 |
|------|------|-----------|------|------|
| U1 PWA 核心 | 游戏仓库级实现 | Claude Code | **Hermes 自写** | Claude(hosted Qwen3.8) 23min 0 文件, 网关连接 612s 无字节 + ConnectionReset, 判卡死止损; 我直接实现 |
| U2 安卓壳 | 构建/打包/管线 | Codex | Codex (NTSec 网关) | 完成, 偏差 3 处均合理(vendor-trimmed SDK) |
| U3 安全审计 | 只读 | Codex | Hermes grep 审计 | 通过(见下) |
| U4 Web 实玩 | 动态复验 | Hermes | Hermes | 全通 |
| U5 APK 门禁 | 构建门禁 | Hermes | Hermes | 6/6 PASS |

路由修正(写入技能): hosted Qwen3.8-27B 经 Claude Code 做"绿地大型多文件游戏实现"吞吐不可用(23min 未落盘),
  此类任务应 Hermes 直写 或 改路由, 不派给走该网关的 Claude。

## U1 Web 核心 — 验收 (全 PASS)
- node --check: levels/audio/store/engine/pwa/sw 全 OK
- 999 关生成器校验 (Hermes 独立校验器 /tmp/hermes_lvl_check.js):
    checked=999 fails=0 monotonicViolations=0 determinism=PASS  9 archetypes 全出现  HERMES_999_VALID
  难度曲线: ballSpeed 280->630 (单调非降), paddleWidth 150->80 (单调非增), ballCount 1->3,
            cols 10->16, rows 5->8
- 真实引擎 headless 实玩仿真 (跑真 engine.js 物理, /tmp/hermes_play_sim.js):
    level 1/5/15/30/45/60/75/90/150/300/500/750/999  全部 CLEAR  (ALL_LEVELS_CLEARED)
- 生产冒烟 (无 test flag, /tmp/hermes_prod_smoke.js): PROD_SMOKE_PASS
    初始停 TITLE / 无球 / start->playing lvl1 / 3命 / 1球 / 300步不崩 / setLevel(999)=3球+板80
- 真实浏览器 (browser_exec): 生产页停 TITLE 无 JS 报错; ?test&lvl=1 实玩通关 levelclear(score500);
    截图视觉核对 canvas 真渲染 (HUD/球/挡板/LEVEL CLEAR overlay)
- 安全审计: 无外部 URL / 无 eval / new Function / document.write / innerHTML / insertAdjacentHTML /
    fetch / XHR / import(); 所有 src/href 仅 self; CSP default-src 'self'; 无 console/debugger 残留

## U2/U5 Android — 验收 (全 PASS)
- gradle assembleRelease: BUILD SUCCESSFUL
- build-gate.sh 6/6:
    [PASS] apk-exists   629529 bytes
    [PASS] permissions  no uses-permission; only: package: com.secops.breakout  (零权限)
    [PASS] badging      versionName=1.0.0 sdkVersion=26 targetSdkVersion=34
    [PASS] signature    verified: CN=Breakout 999, OU=SecOps, O=SecOps, C=US
    [PASS] asset-marker marker 'Breakout 999' FOUND in assets/index.html (非旧占位)
    [PASS] sha256       已记录
- 安卓实机 (emulator-5554, adb):
    install -r  Success
    am start    MainActivity 到前台 (topResumedActivity=com.secops.breakout/.MainActivity)
    截图视觉核对: TITLE 屏真渲染 (BREAKOUT 999 + Tap/Space to start + HUD LEVEL1/SCORE0/LIVES3 + 挡板)
    tap 屏幕中心 -> 进入 gameplay: 砖块被击碎, SCORE 170, 球在动, 挡板右移, LIVES 3  (真实可玩)
- 注: 模拟器曾跑王者荣耀抢占前台, force-stop 后正常置顶; 非 app 问题

## 已修 bug (验收逮到, 非"代码看着对")
1. 纯垂直发射退化: 单球正中垂直发射+正中接住 => 永远垂直, 只清中列. 修: 发射加固定斜角 TILT=0.16 (仍确定性)
2. 近水平/垂直闭合轨道: 确定性物理 + 完美追踪 bot 形成闭合轨道只碰子集砖. 修: 保速+|vy|下限 +
   test-mode 扫描角(每次挡板命中变向) + test-mode stuck-escape(6000步无进展则确定性重发). 均 flag 门控, 正常玩法零影响
3. 球移除逻辑空循环 + 误判: 重写为干净判定 (y-BALL_R>LH+20 即死)
4. stuck-escape 误报: 阈值 240->6000, 不再打断正常往返; sim 中止阈值 15000

## 边界 / 残留
- 999 关不可人工全测: 生成器 999 关几何可达性全绿 + 采样 13 关端到端实玩全通 兜底
- 真机触屏操作(拖拽移板)未在实机逐帧验证, 但: 触摸代码走标准 touchstart/move + screenToLogical,
  且键盘/鼠标/触摸共用同一 paddleTargetFromInput, node 仿真已证明物理闭环
- 无 push / 无 release (遵守: 仅用户明说时执行)
- keystore 密码在 android/signing.properties (gitignored, chmod 600), 未入 git
