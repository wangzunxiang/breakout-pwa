# Breakout 999 架构文档

> 单代码库（web/）→ 双端分发（浏览器 PWA + Android WebView 壳）
> 零第三方依赖 · 零权限 · 零网络 · 999 关确定性生成
>
> 版本：v1.0.3（2026-09-23）

---

## 1. 总体结构

```
                    ┌─────────────────────────────┐
                    │        web/ 核心层           │
                    │  原生 JS + Canvas 2D         │
                    │  levels / engine / store /   │
                    │  audio / pwa                 │
                    └──────────────┬──────────────┘
                                   │ 全量复制 assets/
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   ┌─────────────────────┐                 ┌──────────────────────────┐
   │  浏览器 PWA          │                 │  Android WebView 壳       │
   │  manifest + sw.js   │                 │  MainActivity.kt 单文件    │
   │  离线可用            │                 │  零 uses-permission       │
   └─────────────────────┘                 └──────────────────────────┘
```

游戏逻辑在两端**物理上不可能分叉**：Android 的 assets/ 就是 web/ 的拷贝，构建门禁校验资产标记防旧包混装。

---

## 2. 目录结构

```
/mnt/e/codex/breakout/
├── web/                        # 核心（双端共用）
│   ├── index.html              # 入口，CSP meta: default-src 'self'
│   ├── js/
│   │   ├── levels.js           # 关卡生成层（~280 行）
│   │   ├── engine.js           # 引擎层（~625 行，IIFE 单文件）
│   │   ├── store.js            # 持久化层
│   │   ├── audio.js            # 音效层
│   │   └── pwa.js              # Service Worker 注册（外链，规避 CSP unsafe-inline）
│   ├── css/style.css           # 全屏无滚动
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # 离线缓存
│   └── icons/icon.svg
├── android/                    # WebView 壳 + 构建管线
│   ├── app/src/main/
│   │   ├── java/com/secops/breakout/MainActivity.kt   # 唯一源文件（~110 行）
│   │   ├── AndroidManifest.xml                        # 零权限
│   │   ├── res/...                                    # 图标/主题/字符串
│   │   └── assets/                                    # ← web/ 全量复制
│   ├── build.gradle            # versionCode / versionName / 签名
│   ├── gradle-build.sh         # JDK17 + AGP + Gradle 8.9 release 构建
│   └── build-gate.sh           # 6 项交付门禁
├── docs/
└── .orchestr/breakout/         # 验收证据（见 §6）
```

---

## 3. 模块职责与接口

### 3.1 levels.js — 关卡层（LevelGen）

| 项 | 说明 |
|---|---|
| 生成方式 | `mulberry32(seed=n)` 确定性生成，同关卡号永远同布局 |
| 关卡规模 | 999 关，无 999 个数据文件（体积近零、可全量枚举验证） |
| 原型 | 9 种按段位轮转：GRID / PYRAMID / TUNNEL / RINGS / SLITS / OBSTACLE / MULTIBALL / BOSS / FRACTAL |
| 难度曲线 | `ballSpeed` 递增、`paddleWidth` 递减，随关卡单调变化 |
| 自检 | 生成器内做 flood-fill 可达性验证：存在不可达可破坏砖块 → 该关判生成失败 |

### 3.2 engine.js — 引擎层（Breakout）

对外只挂两个全局：`window.Breakout`（公共 API）与 `window.__breakout`（测试钩子，flag-gated）。

- **渲染/物理解耦**：固定时间步长 `DT = 1/60s` + rAF 累加器，`maxSteps=5` 防 spiral of death
- **状态机**：`title → playing ⇄ levelclear → gameover`（`win` 位区分通关/失败）
- **通关判据（单一）**：可破坏砖块计数归零。曾有分数旁路判据，因分数跨关累计导致级联自动通关，已移除（见 §7 决策 D2）
- **物理**：
  - 球-砖 AABB 碰撞，单次步进单面反弹
  - 挡板反射角 = 触点相对中心偏移 × 65°
  - 多球分裂（MULTIBALL 原型）、BOSS 核心多击破
  - `normalizeBall`：强制 `|vy|` 最小分量，消除水平无限乒乓
- **输入**：
  - touch/mouse → `pointerX`，挡板中心**瞬移**跟随（无速度限制，触摸延迟下体验上限更高）
  - 键盘左右兜底（760 逻辑 px/s）
  - 触摸兼作 title/gameover 的 start 触发
- **命数规则（用户定义）**：开局 3 命；`advanceLevel()` 每通过一关 `S.lives++`（本局立即生效，掉命正常扣减）
- **测试钩子**（`?test=1` 激活，生产路径零副作用）：

```js
global.__breakout = {
  start, reset, setLevel,
  getState,                       // 只读快照：level/score/lives/state/bricksRemaining/...
  stepOnce: () => tick(DT),       // 单步推进，供验证层驱动
  _internal: S
}
```

### 3.3 store.js — 持久化层（GameStore）

- 仅 `localStorage`，每个访问 try/catch 包裹（隐私模式/禁用存储不崩）
- 键：`breakout_highscore`、`breakout_progress`（最高到达关卡）
- 内存 fallback：存储不可用时内存兜底，游戏不中断

### 3.4 audio.js — 音效层

- WebAudio 运行时合成（无音频资源文件）
- 击墙/击砖/掉球/清关/终局各一组；参数 NaN 防护

### 3.5 pwa.js + sw.js + manifest.json

- Service Worker 注册必须外链（`default-src 'self'` 不允许 inline script）
- sw.js 做同版本资源缓存，实现离线可玩

---

## 4. Android 层

### 4.1 MainActivity.kt（唯一源文件）

| 项 | 值 / 理由 |
|---|---|
| 加载目标 | 仅 `file:///android_asset/index.html`（兜底 `about:blank`） |
| WebSettings | JS 开；`allowFileAccess=false`、`allowContentAccess=false`；cache `NO_CACHE` |
| JS 桥 | **无** `addJavascriptInterface`（无 JS↔Java 桥面，攻击面为零） |
| 导航拦截 | `WebViewClient.shouldOverrideUrlLoading`：非 asset URL 一律拒绝 |
| 主题 | 无边栏 Material，黑底 |

### 4.2 AndroidManifest.xml

```xml
<!-- 零 <uses-permission>（仅隐式 package: 声明） -->
<application
    android:allowBackup="false"
    android:supportsRtl="true" ...>
```

### 4.3 架构取舍：WebView 壳 vs Kotlin 原生

| 维度 | WebView 壳（选定） | 原生 |
|---|---|---|
| 代码库 | 单一，两端不可能分叉 | 双份逻辑，必然漂移 |
| 工作量 | ~110 行 Kotlin | 引擎重写一遍 |
| 性能 | Canvas 2D 60fps 在 Chromium WebView 无压力 | 略优（无收益场景） |
| 能力 | 无原生分享/震动 | 有（本游戏不需要） |

---

## 5. 构建与门禁管线

```
gradle-build.sh    JDK17 + AGP + Gradle 8.9
                   release 签名：keystore CN=Breakout 999, OU/O=SecOps, RSA-2048, 10000 天
                   （密钥 /home/kylin/keystore/breakout-release.keystore，别名 breakout）

build-gate.sh      6 项硬门禁，任一 FAIL 即拒交付：
  1  apk-exists     产物存在 + 大小
  2  permissions    aapt dump：无 uses-permission（仅隐式 package:）
  3  badging        package/versionCode/versionName 与预期一致
  4  signature      apksigner verify：签名 CN 正确
  5  asset-marker   APK 内 assets/index.html 含版本标记（防旧资产混装）
  6  sha256         产物指纹留档
```

**版本纪律**

- 任何内容改动必须升 `versionCode`
- 验证构建（CDP/test 开关）与交付构建物理隔离；交付包 sha256 必须与门禁记录逐字节一致
- 版本史：
  - `1.0.0` 初版
  - `1.0.1` 修 winScore 跨关自动级联通关（用户实机抓到）
  - `1.0.2` 命数规则首版（"完整通关 999 关 +1"，后按用户澄清推翻）
  - `1.0.3` 命数规则定稿：**起始 3 命，每通过一关 LIVES +1（本局生效）**

---

## 6. 验证架构（五级金字塔，从便宜到昂贵）

```
L1  静态校验     999 关可清性 / 砖块可达性 / 难度单调 / 生成确定性        秒级
L2  无头实玩     Node 加载生产引擎，真实 pipeline 逐关 stepOnce 打穿      ~13 s（1→999）
L3  设备步驱     真机 WebView + CDP 连接，引擎逐步推进                    ~1 s（1→100）
L4  设备实时     真机 60fps 真实时钟逐关实玩，只读监控 + 逐关截图         ~3.5 h（1→100）★正式验收
L5  交互层       纯 adb 触摸 + 截图像素识别球驱动挡板（零 JS 注入）       证明 touch 链路真实可用
```

各层职责边界：

- L1-L2 证明**关卡可清**（逻辑正确性）
- L3 证明**设备上的引擎与源码一致且可跑**
- L4 证明**真机实时可玩、逐关无卡死/掉命异常**（每关截图 + JSON 留证）
- L5 证明**输入链路**（触摸真实驱动挡板、击碎砖块、分数增长）

### L4 验收记录（v1.0.3，2026-09-23）

| 项 | 结果 |
|---|---|
| 判据 | 观察到"进入第 N+1 关" = 第 N 关已清（持久稳定信号，不依赖 1.2s 结算帧） |
| 结果 | **1..100 全清 → 进入 101 关，PASS** |
| 耗时 | 207.8 分钟（真实 60fps，无加速） |
| 掉命 | 0（LIVES 3 → 103，逐关 +1 程序化校验零违例：进第 N 关命数恒为 N+2） |
| 原型覆盖 | GRID 15 / PYRAMID 15 / TUNNEL 15 / RINGS 15 / SLITS 15 / OBSTACLE 15 / MULTIBALL 11 |
| 终局画面 | LEVEL 101, SCORE 38210, LIVES 103（多球状态） |
| 留证 | `.orchestr/breakout/realtime100/`：101 张关卡截图 + `levels.json` + `monitor.log` |

> 说明：L4 的挡板操作由 test 模式自动驾驶完成（纯触摸机器人掉球率 ~6%，不足以 100 关不掉命）；
> 关卡生成、碰撞、通关判定、命数规则走的都是与玩家完全相同的生产代码路径，实时时钟未动。

---

## 7. 关键设计决策（含踩坑）

| # | 决策 | 理由 / 坑 |
|---|---|---|
| D1 | 确定性生成器 > 手写 999 关数据 | 可全量枚举验证、体积近零、布局可复现 |
| D2 | 通关判据单一化（仅砖块清零） | 曾有"分数达标"旁路：分数跨关累计，第 2 关起 winScore 恒满足 → 级联自动通关。用户实机（LEVEL 176 挡板挂球、砖墙完好）抓到 |
| D3 | 测试钩子 flag-gated 而非删除 | 生产包零副作用，验证层复用同一份引擎代码 |
| D4 | 挡板瞬移跟随触点（无速度限制） | 触摸延迟下体验上限更高；简化 L5 控制回路 |
| D5 | WebView 壳而非原生 | 见 §4.3 取舍表 |
| D6 | 球发射固定倾角 ±15° | 纯垂直发射 → 回弹回中心 → 只打中缝 → 死锁（L2 模拟抓到） |
| D7 | `normalizeBall` 强制 `|vy|` 下限 | 近水平轨迹可左右无限乒乓 |
| D8 | vendor-trimmed SDK 适配 | 精简 android-34 缺 API-23 属性：`extractNativeLibraries`/`fullBackupData` 从 Manifest 省略（无 native 库，功能等价）；`setWebContentsDebuggingEnabled` 是**静态方法**（实例调用编译不过） |
| D9 | Kotlin 块注释嵌套 | KDoc 里写 `file:///android_asset/*`，路径末尾 `/*` 打开嵌套注释永不闭合 → `Unclosed comment`，报错行指向文件尾 |
| D10 | 资产标记门禁 | 验证/交付构建交替期间，曾出现占位 APK 风险；APK 内 marker 校验 + sha 留档双保险 |

---

## 8. 安全面

| 面 | 控制 |
|---|---|
| CSP | `default-src 'self'`，无 inline script、无外链、无 eval/innerHTML |
| 权限 | 零 `uses-permission` |
| JS 桥 | 无 `addJavascriptInterface` |
| URL | WebViewClient 拦截非 asset 导航 |
| 存储 | 仅 localStorage，try/catch 全包裹 |
| 网络 | 无（游戏完全离线） |

---

## 9. 交付物

| 项 | 位置 |
|---|---|
| 网页版 | `/mnt/e/codex/breakout/web/`（任意静态服务器/本地打开即可） |
| Android APK | `/mnt/e/codex/breakout/android/app/build/outputs/apk/release/app-release.apk`（v1.0.3，630 KB，已装模拟器验证） |
| 门禁记录 | 构建时输出，sha256 `8e5922b2…a94` 定版 |
| 验收证据 | `/mnt/e/codex/breakout/.orchestr/breakout/`（run999 / phone_run100 / realtime100 / proof 截图） |
| git | 本地 5 提交，未 push |
