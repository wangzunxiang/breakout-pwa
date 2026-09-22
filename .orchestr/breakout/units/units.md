# Breakout 打砖块 — 单元清单

仓库布局（单源真值，一份 PWA 核心 → 两壳）：
  /mnt/e/codex/breakout/web/        U1 PWA 本体（Canvas 游戏，零第三方依赖）
  /mnt/e/codex/breakout/android/    U2 WebView 壳工程（纯原生 Activity，零权限）

## 单元
- U1  PWA 游戏核心
      引擎(物理/碰撞/球/挡板) + 9 类关卡确定性生成器 + 内置校验器
      + UI/触屏/键鼠 + WebAudio 音效(isFinite 守卫) + localStorage 存档(catch)
      + 测试钩子 (?test 自动驾驶, flag 门控)
- U2  Android WebView 壳工程
      原生 Activity + 零权限 Manifest + 沉浸式全屏 + 签名管线 + 构建门禁脚本
- U3  最终安全/质量审计（只读）
      无外部 URL / eval / innerHTML / 动态代码；CSP self；持久化仅 localStorage

## 验收（Hermes 亲跑，不采信自评）
- U4  Web 实玩：node --check 全 JS；headless CDP 通关 lvl1、加载 lvl 50/100/300/999 不崩、
      ?test 自动驾驶；生成器校验器 999 关逐条断言全绿；外部请求=0；localStorage 读写
- U5  APK 门禁：assembleRelease + cp assets + aapt permissions(零) + badging +
      apksigner verify + unzip assets grep 新标记 + sha256
