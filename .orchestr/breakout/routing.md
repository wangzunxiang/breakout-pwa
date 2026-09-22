# Breakout — 路由决策（依据 = 模块性质 + 历史质量反馈）

拓扑：Hermes = 编排 + 第三方验收（spec 先、quality 后）；Claude/Codex = 工人，星型互不可见。
一工人一 worktree；长任务 background + 日志落盘；验收三动作（diff 逐一审 / 测试亲跑 / 前后 diff --stat）。

## 路由
| 单元 | 性质 | 执行方 | worktree / 目录 |
|------|------|--------|-----------------|
| U1   | 游戏仓库级实现（引擎/关卡/物理/UI） | Claude Code | web/ |
| U2   | 构建/打包/管线/门禁脚本          | Codex      | android/ |
| U3   | 安全审计（只读、终端批量）         | Codex      | 独立 lane |
| U4   | 动态实玩复验（CDP 自动驾驶）        | Hermes     | — |
| U5   | APK 构建门禁                       | Hermes     | — |
| 生成器正确性判定 / 冲突裁决 | 推理判真伪 | Hermes | — |

## 工人配置
- Claude Code 2.1.278 → ANTHROPIC_BASE_URL=127.0.0.1:9999 (adapter) → Qwen3.8-27B；--dangerously-skip-permissions
- Codex 0.155.1 → NTSec AI 网关 ai.ntsec.cn:3000 (responses api)，NTSEC_API_KEY 在 env
- 注：两工人与 Hermes 同模型（Qwen3.8-27B）。分配价值 = 上下文隔离 + 并行 + 独立验收，
  非"更强模型"。Hermes 亲自验收是唯一质量闸门，工人自评一律视为未验证声明。

## 排期（依赖）
Wave 1: U1 (Claude, web)  —— 唯一关键路径
Wave 2: U2 (Codex, android, 依赖 U1 assets 定稿) ‖ U3 (Codex, 只读审计 U1 源码)
Wave 3: U4 + U5 (Hermes 亲跑, 串在 U1/U2 后)
