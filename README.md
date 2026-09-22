# Breakout 999 · 打砖块

纯本地 PWA + 零权限安卓 APK（WebView 壳）。999 关确定性生成，9 种关卡原型，真机逐关实时验收。

- **零第三方依赖**：原生 JS + Canvas 2D
- **零权限 / 零网络 / 零采集**：Android 无任何 `uses-permission`，游戏完全离线
- **999 关确定性生成**：`mulberry32(seed=n)`，同关卡号永远同布局；生成器内置 flood-fill 可达性自检
- **9 种原型**：GRID / PYRAMID / TUNNEL / RINGS / SLITS / OBSTACLE / MULTIBALL / BOSS / FRACTAL
- **命数规则**：开局 3 条命，每通过一关 LIVES +1（本局生效）
- **v2.0 规则**：
  - 手动暂停（暂停按钮 / P 键 / Esc），失焦自动暂停
  - 命耗尽失败 → **留在当前关卡重试**，命重置为 3，本关刷的分数回滚
  - 通关 999 关（YOU WIN）后重开 → 回第 1 关
  - 清关后进入下一关倒计时 5 秒（HUD 可见）

## 玩法规则

- 触摸/鼠标拖动挡板，球打到砖块得分；球掉底掉一命
- 可破坏砖块全部清完 → 进入下一关（+1 命）
- 打完第 999 关 → YOU WIN
- 最高分与进度本地持久化（localStorage）

## 网页版

把 `web/` 目录放到任意静态服务器（或直接本地打开）：

```
web/index.html   # 入口
```

支持 PWA 安装与离线运行（manifest + service worker）。

## 安卓 APK

`android/app/build/outputs/apk/release/app-release.apk`（v1.0.3）

从源码重建：

```bash
cd android
bash gradle-build.sh     # 需要 JDK17 + Android SDK platform-34 + Gradle 8.9
bash build-gate.sh "Breakout 999"   # 6 项交付门禁（权限/签名/资产标记/sha256）
```

## 验收

- 999 关可清性静态校验 + 无头实玩打穿（1→999，1200 万物理步，0 失败）
- 真机（Android 14 模拟器）实时逐关实玩 1→100 关：207.8 分钟真实 60fps，0 掉命，LIVES 3→103，逐关截图 + JSON 留证（见 `docs/architecture.md` §6）

## 架构

见 [`docs/architecture.md`](docs/architecture.md)：模块职责、构建门禁、五级验证金字塔、关键设计决策与踩坑。
