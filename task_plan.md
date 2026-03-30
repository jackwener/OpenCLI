# NotebookLM OpenCLI Task Plan

## Goal

把 NotebookLM 逐步并入 `opencli`，以 `opencli` 现有 Browser Bridge / CDP 运行时为底座，先做稳定的 transport 层，再按能力波次扩展命令面，最终覆盖原 `notebooklm-cdp-cli` 的主要功能。

## Current Status

- Phase 0 已完成：`status` / `list` / `current` 骨架已接入 `opencli`
- `list` 已验证走真实首页 RPC `wXbhsf`，不是 DOM fallback
- Linux 产品线继续留在 `notebooklm-cdp-cli`
- `opencli` 侧当前目标是 Windows / Browser Bridge 优先

## Phases

| Phase | Status | Outcome |
|-------|--------|---------|
| 0. Baseline validation | complete | `status` / `list` / `current` 可运行，`list` 走真实 RPC |
| 1. Transport consolidation | in_progress | 已抽出 `rpc.ts` 和独立 transport 测试，并补了 auth / parser / page-eval 稳定性收口；待继续提升 RPC 命中率与诊断信息 |
| 2. Read-surface expansion | in_progress | 已补 `get` / `source-list` / `history` / `note-list`，并开始做与原 CLI 的兼容命名层；下一步继续做高价值读命令 |
| 3. Light write operations | pending | 扩展 ask / source add / notes save 等轻写命令 |
| 4. Long-running jobs | pending | research / artifact / generate 的提交、轮询、状态恢复 |
| 5. Download and export | pending | report/audio/video/slide 等下载导出 |
| 6. Docs / release / PR | pending | 文档、测试矩阵、面向维护者的 PR 收口 |

## Decisions

- 不按“命令名逐个平移”推进，按 transport 能力层推进。
- `opencli` 维持 `site + 单层 command` 结构，不把 `notebook source list` 这类三层命令硬搬进来。
- 与原 `notebooklm-cdp-cli` 的命令习惯对齐，优先通过 alias / wrapper 做低成本兼容层。
- `wXbhsf` 是当前首页 notebook list 的真实 RPC，后续新命令优先从 live network 反推。
- 浏览器内执行为主，不引入 cookies replay / `storage_state.json` 主认证模型。
- `opencli` 只承接 browser-bridge 路线；Linux direct CDP 继续留在原仓库。

## Risks

- NotebookLM RPC ID 和参数形状可能按功能分散且存在前端版本漂移。
- 同一 workspace 下连续执行命令时，页面切换或 bridge 瞬态抖动会放大 auth token 获取和 page-eval 的偶发失败。
- 长任务类命令需要轮询、状态恢复、下载流处理，复杂度明显高于 read path。
- `opencli` 当前 doctor / bridge 状态展示与 live 执行路径仍可能存在观测不一致。

## Near-Term Next Step

先继续收口 Phase 1/2 交界处的“稳底座 + 厚读命令”：

- 已完成：框架级 `aliases` 支持，`use` / `metadata` / `notes-list` 兼容命名，以及 `source-get` wrapper
- 已完成：`history` token 获取和 `source-list` RPC 解析的稳定性修复，`dist` 下已验证 `source-list` 5/5 RPC 命中、`history` 8/8 返回 `thread_id`
- 已完成：`summary` 和 `notes-get` 两个高价值读命令
- 已完成：`source-fulltext`，优先走独立 source RPC，不依赖当前 source 详情 DOM
- 已完成：`source-guide`，复用 source lookup 并调用 `tr032e`
- 已完成：`source-list` 的 source type/type_code 解析修正，当前 live notebook 已能区分 `pdf` / `web` / `pasted-text` / `youtube`
- 下一步：
  - 继续停在 source 读链路；如需继续，优先评估是否还有值得补的 source 只读命令，而不是进入写命令
  - 保持 `get` / `metadata` 现状，暂不单独补 `notebook-get`
  - 暂不进入 `generate/*` / `download/*` / `artifact/*`
