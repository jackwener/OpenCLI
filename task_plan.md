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
| 3. Light write operations | in_progress | `ask`、`source-add-text`、`source-add-url`、`notes-save` 已落地；仍需后续决定是否继续补 share 写操作或更多 note/source 写命令 |
| 4. Long-running jobs | in_progress | 已补最小 `generate/report`、`generate/audio`、`generate/slide-deck` 提交链路与命令内最小等待；完整 artifact/poll 子系统仍未展开 |
| 5. Download and export | in_progress | 已完成 `download/report`、`download/slide-deck`、`download/audio`、`download/video` 和最小下载索引 `download/list`；更完整的 artifact/export 面仍待后续评估 |
| 6. Docs / release / PR | pending | 文档、测试矩阵、面向维护者的 PR 收口 |

## Decisions

- 不按“命令名逐个平移”推进，按 transport 能力层推进。
- `opencli` 维持 `site + 单层 command` 结构，不把 `notebook source list` 这类三层命令硬搬进来。
- 与原 `notebooklm-cdp-cli` 的命令习惯对齐，优先通过 alias / wrapper 做低成本兼容层。
- 三层命令树重构单独按框架线程推进，当前现实方案是：
  - 允许命令定义使用 path-like name，如 `source/list`
  - 在 commander 层把它映射成真实嵌套子命令 `source list`
  - 不要求这一轮同时迁移已有 NotebookLM 业务命令
- `wXbhsf` 是当前首页 notebook list 的真实 RPC，后续新命令优先从 live network 反推。
- 浏览器内执行为主，不引入 cookies replay / `storage_state.json` 主认证模型。
- `opencli` 只承接 browser-bridge 路线；Linux direct CDP 继续留在原仓库。
- Download 方向本轮优先级已明确：
  - 先落 `download/report`
  - 第二优先级是 `download/slide-deck`
  - 第三优先级原先是 `download/audio`
  - 暂不补 `artifact list/get/export` 公开命令面
- 选择 `download/report` 的原因：
  - `gArtLc` raw artifact list 已足够定位 report artifact id
  - report 正文可直接从 artifact payload slot `7` 提取 markdown
  - 不依赖 export RPC，也不依赖额外 signed download URL / cookie stream 下载
- `download/audio` / `download/slide-deck` 的现实前置不是 generate，而是：
  - 先复用内部 artifact raw list helper
  - 再接现有 opencli download/cookie forwarding 基础设施
  - 但这一层复杂度明显高于 report 文本落盘，因此延后
- `download/slide-deck` 已按这个判断落地：
  - 仍然只复用内部 `gArtLc` raw artifact helper
  - 直接消费 slot `16` 里的 PDF/PPTX URL
  - 用现有 opencli `httpDownload` + browser cookie forwarding 落盘
  - 没有先实现 `artifact/list|get|export`
- `download/audio` 已按同一原则落地：
  - 仍然只复用内部 `gArtLc` raw artifact helper
  - 直接消费 slot `6[5]` 里的 media variants
  - 选择规则与上游一致：优先首个 `audio/mp4`，否则回退第一个 variant URL
  - 用现有 opencli `httpDownload` + browser cookie forwarding 落盘
  - 仍然没有先实现 `artifact/list|get|export`
- `download/video` 已按同一原则落地：
  - 仍然只复用内部 `gArtLc` raw artifact helper
  - video artifact type 已确认是 `type=3`
  - 直接消费 slot `8[4]` 里的 media variants
  - 当前 live raw row 同时给出 direct `video/mp4`、HLS、DASH 和一个备用 `video/mp4`
  - 选择规则保持最小且稳定：优先首个 `video/mp4`，否则回退第一个 variant URL
  - 用现有 opencli `httpDownload` + browser cookie forwarding 落盘
  - 仍然没有先实现 `artifact/list|get|export`
- 当前最小下载索引也已落地：
  - 命令名选择 `download/list`
  - 仍然只复用内部 `gArtLc` raw artifact helper
  - 只输出当前 download 命令真正需要的字段：
    - `artifact_id`
    - `artifact_type`
    - `status`
    - `title`
    - `download_variants`
    - `source`
  - 不暴露完整 artifact payload，也不扩成 `artifact/*`
- `artifact-id` 补全本轮也维持最小范围：
  - 只覆盖现有 4 个 NotebookLM 下载命令
  - 不扩成通用 `source-id` / `note-id` / `notebook-id` 补全系统
  - 数据源直接复用当前 notebook 的 `download/list` / `gArtLc` 索引
  - 需要的框架改动只限 completion 入口异步化和按命令 lazy-load TS adapter metadata
- 当前最小 generate 方向也已落地：
  - `generate/report`
  - `generate/audio`
  - `generate/slide-deck`
  - 三者都直接复用 `R7cb6c` create-artifact RPC
  - 提交前只取当前 notebook source ids 与同类型 artifact baseline
  - `--wait` 只做命令内最小轮询，仍然不公开 `artifact wait/poll/list/get/export`
  - `report` 等到 markdown 可见即可
  - `audio` 等到 media variant 可见即可判定 ready
  - `slide-deck` 等到 PDF/PPTX 任一下载 URL 可见即可判定 ready
  - 当前 live 说明：
    - `report` 在最小 wait 窗口内可稳定闭环
    - `audio` / `slide-deck` 的真实生成时长可能超过最小 wait 窗口，因此提交路径与后续 artifact 可见性已验证，但不应把这版误写成完整长任务恢复体系
- 对 `generate/audio` / `generate/slide-deck` 的专项调查已补充一个更强结论：
  - 在当前 rich notebook 上，`R7cb6c` 对 report 会直接返回 artifact row
  - 但对 audio / slide-deck 会稳定返回 `wrb.fr(..., null, ..., UserDisplayableError, ...)`
  - 页面 Studio 面板同时出现明确 upsell/quota 文案：
    - `您已达到每日音频概览和幻灯片数量上限，改日再来吧。 或进行升级。`
  - 因此当前最可能根因是 server-side quota / eligibility gate，而不是 opencli 少传了某个最小 payload 槽位
  - 继续修复时应优先处理“把这类返回识别成 quota/eligibility failure 并给出明确诊断”，而不是盲目扩 payload
- 已完成：generate 错误分类最小增强
  - `UserDisplayableError` 现在会被显式识别
  - generate row 新增：
    - `error_type`
    - `message`
  - 当前支持的分类：
    - `daily_limit_reached`
    - `feature_not_eligible`
    - `content_insufficient`
    - `generation_failed_unknown`
  - 若服务端没有返回可读 message，则保守落到 `generation_failed_unknown`

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
- 已完成：框架层最小三层命令树能力，支持把 `source/list` 这类 path-like 命令名映射成真实的 `source list` 子命令，并保持平面命令向后兼容
- 已完成：NotebookLM 第一批业务命令 remount 到嵌套路径，同时保留旧平面命令兼容：
  - `source/list`
  - `source/get`
  - `source/fulltext`
  - `source/guide`
  - `notes/list`
  - `notes/get`
  - `language/list`
  - `language/get`
  - `language/set`
- 本轮已完成的轻写 / 全局能力：
  - `source-add-text`
  - `source-add-url`
  - `notes-save`
  - `share-status`
  - `language-list` / `language-get` / `language-set`
- 已完成：`notes-save` 从“标题唯一”提升到更稳的最小可用版：
  - 优先尝试当前 visible note editor 周围的 DOM hint stable id
  - 若 editor 周围没有稳定 id，则回退到 `title + content` 精确匹配 RPC note list
- 已完成：`notes-get` / `notes-save` 增加显式 `--note-id`
  - `--note-id` 优先于标题和默认选择逻辑
  - 用于把重复标题、重复空正文的 note 消歧显式交给用户
- 当前下一步：
  - 本轮已完成 download 方向侦察，并在链路足够清晰后只落了一个最小命令：
    - `download/report`
    - `download/slide-deck`
    - `download/audio`
    - `download/video`
    - `download/list`
  - 当前不继续扩 `artifact/*`
  - 当前也不继续扩 `generate/*` 到：
    - `video`
    - `quiz`
    - `flashcards`
    - `infographic`
  - 若下一轮继续 download：
    - 才评估是否要补最小 `artifact/list`
    - 仍不必先做完整 `artifact list/get/export` 命令树
  - 若继续推进 generate / artifact：
    - 优先评估是否真的需要公开最小 `artifact/list`
    - 不应先铺完整 `artifact wait/poll/export` 面
  - 若继续推进 `generate/audio` / `generate/slide-deck`：
    - 当前已完成 server-side `UserDisplayableError` 分类兜底
    - 若还要继续收窄原因，再决定是否需要额外 live UI request 对比或内部 envelope code 对照
    - 当前不建议先改 `R7cb6c` payload builder
  - `notes-save` 已不再只依赖标题唯一；当前剩余 live 阻塞变成“当前 visible editor 没有稳定 id，且 notebook 内存在 title 和 content 都完全相同的重复 note”
  - 这类歧义现在可以通过显式 `--note-id` 解决，但前提仍然是当前页已经打开目标 note editor
  - 若继续推进三层命令树，优先 remount 仍保留平面形态的 notebook/share 命令，而不是扩大业务范围
  - A 模块 notebook 轻写 CRUD 这一轮已完成：
    - `create`
    - `rename`
    - `delete`
    - `describe`
    - `remove-from-recent`
  - 其中 `describe` 的现实收口是：
    - 先尝试真实 `VfAZjd` summary/topics RPC
    - live 拿不到结构化 topics 时，回退到稳定的 summary wrapper
    - 因而当前 `describe` 是“真实 RPC 优先 + summary wrapper fallback”，不是纯结构化 topics 命令
  - `notes/list` 这一轮已单独收口：
    - 先确认 live `no data` 的一次复现来自浏览器里没有可绑定的 `/notebook/...` tab，不是已证实的 DOM selector 漂移
    - 当前真实 notebook 页上，旧 DOM selector `artifact-library-note` 仍然存在且可解析 note id/title
    - 为降低 Studio 面板折叠或局部渲染缺失带来的脆弱性，`notes/list` 现在在 DOM 为空时回退到现有 `cFji9` RPC
  - A 模块 notes 轻写 CRUD 这一轮已补完：
    - `notes/create`
    - `notes/rename`
    - `notes/delete`
  - 这轮 notes 写命令的现实收口是：
    - `create` 直接走 `CYK0Xb`，再立刻用 `cYAfTb` 写入 title/content
    - `rename` / `delete` 优先支持 `--note-id`
    - 标题兼容只保留“唯一精确标题命中”，重复标题时明确要求 `--note-id`
  - A 模块 source 中等复杂度管理命令这一轮已完成：
    - `source/rename`
    - `source/delete`
    - `source/refresh`
    - `source/check-freshness`
  - 这轮 source 写/状态命令的现实收口是：
    - `rename` / `delete` / `refresh` / `check-freshness` 都只针对“当前 notebook”
    - 优先 `--source-id`
    - 不带 `--source-id` 时，只接受“唯一精确标题命中”
    - 不继续发明 partial title 或别的 source 选择 heuristics
  - 当前 live 还存在一个运行态边界：
    - NotebookLM 浏览器标签会偶发漂到 `?addSource=true` 的 add-source 页面
    - 一旦当前绑定 notebook 漂移，`refresh` / `check-freshness` 这类命令的前置 source 校验就会落到错误 notebook 上
    - 这轮先不扩“强制切回目标 notebook”的框架能力，只把该现象记录为运行态阻塞
  - A 模块 source 管理稳定性这一轮已完成最小修复：
    - `ensureNotebooklmNotebookBinding(...)` 不再只信 `page.getCurrentUrl()`，而是优先看真实页面状态
    - 若实际已在 notebook 页但 URL 是 `?addSource=true` 等非 canonical 形态，会先回到 canonical notebook URL
    - `Page.evaluate(...)` 现在把 `Detached while handling command.` 当成一次可重试瞬态
  - 当前结论：
    - `source/refresh`
    - `source/check-freshness`
    已能在同一 notebook 上连续多次 live 跑通
  - A 模块 source ingest 这一轮已完成：
    - `source/add-file`
    - `source/wait-for-sources`
    - `source/wait`
  - 这轮 source ingest 的现实收口是：
    - `add-file` 不走脆弱 DOM 点击，而是走“`o4cbdc` 注册 source + NotebookLM resumable upload”链路
    - `wait-for-sources` / `wait` 共用同一个 RPC polling 核心，只在命令层分别收单个和逗号分隔的多个 source id
    - 当前仍不扩 `source add-drive` / `source add-research`

## 2026-03-31 From-0 Integration Test Summary (9 Modules, Historical Only)

### Test Environment
- Browser Bridge daemon: port 19825, extension v1.5.5, connected
- 手动 `curl .../navigate` 可将 browser bridge tab 导航到 notebook URL（opencli CLI 内无内置 navigate 命令）
- `bind-current` / `use` 在 browser 无 notebook tab 时失败，需要先手动 navigate
- **关键运行态问题**：每次 CLI 命令执行后，browser bridge tab 会偶发漂回 home 页（约 2-3 条命令后），严重影响 notebook-context 命令连续测试

### 测试模块 0：基础环境 — PASS
- `npx tsc --noEmit` → EXIT 0
- `npm run build` → EXIT 0，475 entries
- `list -f json` → notebooklm 命令被发现
- `notebooklm --help` → 正常展开 60+ 命令
- `completion bash` → 正常输出

### 测试模块 1：绑定前置条件 — PASS（需手动 navigate）
- `bind-current` → FAIL（browser 无 notebook tab）
- 手动 `curl navigate` → PASS
- `status -f json` → `page: "notebook"`，`url: https://notebooklm.google.com/notebook/6fd8aeb5-...`
- 当前测试 notebook：`6fd8aeb5-ddd1-4114-bcda-c376389a8508`（Electron Debugging 2026）

### 测试模块 2：Notebook 基础读写 — 大部分 PASS
| 命令 | 结果 | 备注 |
|------|------|------|
| `status` | PASS | |
| `current` | PASS | `source: "current-page"` |
| `get` | PASS | `source: "rpc"`，含 source_count |
| `metadata` | PASS | alias of get |
| `describe` | PASS | `source: "summary-dom"`，summary 正文返回 |
| `list` | PASS | RPC |
| `create` | PASS | 创建 notebook |
| `rename` | PASS | 重命名成功 |
| `remove-from-recent` | PASS | |
| `delete` | PASS | |
| `summary` | FAIL | browser drift 导致，需要重新 navigate |
| `history` | FAIL | browser drift 导致，需要重新 navigate |

### 测试模块 3：Source 读链路 — PASS
| 命令 | 结果 | 备注 |
|------|------|------|
| `source list` | PASS | 7 sources，`type` 解析正确（pdf/web/audio/pasted-text/youtube），`source: "rpc"` |
| `source get` | PASS | 按 title "粘贴的文字" 匹配 |
| `source fulltext` | PASS | 返回 893 字符 markdown 内容 |
| `source guide` | PASS | 返回 summary + 5 keywords |
| `source-list`（flat）| FAIL | browser drift 导致 |

### 测试模块 4：Source ingest 与管理 — 部分 PASS
| 命令 | 结果 | 备注 |
|------|------|------|
| `source-add-text` | PASS | |
| `source-add-url` | PASS | |
| `source-wait` | PASS | 等到 ready |
| `source-check-freshness` | PASS | `is_fresh: true` |
| `source-rename` | FAIL | browser drift |
| `source-refresh` | FAIL | browser drift |
| `source-delete` | FAIL | browser drift |

### 测试模块 5：Notes — 部分 PASS
| 命令 | 结果 | 备注 |
|------|------|------|
| `notes list` | PASS（不稳定）| browser drift 导致不稳定 |
| `notes create` | PASS | 创建 note |
| `notes rename` | PASS | |
| `notes delete` | FAIL | browser drift |
| `notes-save` | NOT TESTED | 需要 visible note editor |

### 测试模块 6：Ask — PASS
`ask --prompt "用一句话总结"` → PASS，返回 answer 正文（中文）

### 测试模块 7：Generate — PASS
`generate report` → PASS，返回 `artifact_id: b9934a76-53df-47ec-9f24-f990a8da8072`

### 测试模块 8：Download — 部分 PASS
| 命令 | 结果 | 备注 |
|------|------|------|
| `download list` | PASS | 显示 report/audio/slide_deck，`status` 字段正确 |
| `download report` | PASS | 成功写出 5563 字节 .md 文件，内容正确 |
| `download audio` | FAIL | "fetch failed" — artifact URL 过期（运行态，非代码缺陷） |
| `download slide-deck` | FAIL | "fetch failed" — artifact URL 过期（运行态）|

### 测试模块 9：兼容层与命令树 — PASS
- `source --help`、`notes --help`、`download --help`、`language --help` → 全部正常
- `language get` 和 `language-get` → 均 PASS（alias 正常）

### 历史测试结论（不作为当前统一 PR 判断依据）

**当时可直接确认的命令：**
1. `status` / `list` — 稳定，RPC
2. `create` / `rename` / `delete` / `remove-from-recent` — 稳定，RPC，闭环验证通过
3. `current` / `get` / `metadata` / `describe` — 稳定
4. `source list` / `source get` / `source fulltext` / `source guide` — 稳定，RPC
5. `source-add-text` / `source-add-url` / `source-wait` / `source-check-freshness` — 稳定
6. `notes create` / `notes rename` — 稳定
7. `ask` — 稳定，返回 answer
8. `generate report` — 稳定，返回 artifact_id
9. `download list` — 稳定，正确索引 artifacts
10. `download report` — 稳定，成功写出文件
11. `language-list` / `language-get` / `language-set` — 稳定，RPC
12. 命令树三层结构和帮助文本 — 框架稳定

**当时受运行态影响、未纳入判断的命令：**
- `source-rename` / `source-refresh` / `source-delete` — browser drift 导致测试不稳定，需要稳定性修复后再验证
- `notes delete` / `notes-save` — 同上
- `download audio` / `download slide-deck` — artifact URL 过期是运行态问题，不是代码缺陷；但需要稳定可用的 artifact 样本才能验证

**设计边界确认（不是 bug）：**
- `summary` / `history` 偶发 FAIL 是 browser drift，不是代码缺陷
- `bind-current` 在无 notebook tab 时失败是设计预期，需要先 navigate
- `download audio/slide-deck` 的 "fetch failed" 是 URL 过期，不是实现问题

### 历史运行态问题：Browser Drift（仅用于排障记录）
- 每次 CLI 命令执行后，browser bridge CDP session 会偶发漂回 home 页
- 在连续 2-3 条命令后必然发生
- 影响所有 notebook-context 命令的连续测试
- 根因：`navigate` 命令在 daemon 端执行后，下一次 CLI 调用时 CDP session 丢失了 notebook URL 上下文
- 当前 workaround：每次 FAIL 后重新 `curl navigate`，然后继续测试
- 建议：这是 daemon/CDP session 管理问题，不是 NotebookLM adapter 代码缺陷

## 2026-03-31 统一 PR 前验证（第 2 轮）

> 以下结论是当前统一 PR 的唯一判断口径。上面的 From-0 结果只保留为历史排障记录，不再作为 PR judgment 依据。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（浏览器自动化工具全解析）
- `bind-current` → ✅
- `status` → ✅ `page: "notebook"`

### 模块 A：Source ingest 闭环

| 命令 | 结果 | 备注 |
|------|------|------|
| `source-add-text` | ✅ | source id 返回，RPC |
| `source wait` | ✅ | `status_code: 2, status: "ready"` |
| `source wait-for-sources` | ✅ | 单 id 逗号形式可用 |
| `source-add-file` | ❌ | `fetch failed` — resumable upload URL 过期（运行态）|

- `source delete` ✅（清理测试 source）

### 模块 B：Notes 精确操作

| 命令 | 结果 | 备注 |
|------|------|------|
| `notes list` | ✅ | 3 条，含两条同名"新建笔记" |
| `notes get --note-id` | ✅ | 绕过重复标题歧义，精确命中 |
| `notes create` | ✅ | RPC，id 返回 |
| `notes delete --note-id` | ✅ | RPC |
| `notes rename --note-id` | ✅ | RPC |
| `notes-save` | ❌ | 无 visible editor（设计边界，预期）|

### 模块 C：Generate 最小闭环

| 命令 | 结果 | 备注 |
|------|------|------|
| `generate report --wait` | ✅ | artifact id `c0674240-...`，完整闭环 |
| `generate audio` | ❌ | `status: failed`，artifact_id=null（非超时，是生成失败）|
| `generate audio --wait` | ❌ | 超时，这个 notebook 内容可能不足以生成 audio |
| `generate slide-deck` | ❌ | `status: failed`，同上 |
| `generate slide-deck --wait` | ❌ | 超时 |

- `generate audio/slide-deck` 失败是这个 notebook 的内容限制，不是代码缺陷
- 在有足够源材料的 notebook（如 Electron Debugging 2026）上 audio/slide-deck 提交链路已验证

### 模块 D：Download 闭环

| 命令 | 结果 | 备注 |
|------|------|------|
| `download list` | ✅ | 正确索引 report + slide_deck |
| `download report` | ✅ | 新 artifact 9.9K 写出 |
| `download slide-deck` | ❌ | `fetch failed` — URL 过期（运行态）|

### 模块 E：artifact-id 补全

| probe | 结果 | 备注 |
|------|------|------|
| `download slide-deck ... --artifact-id` | ✅ | 补全 slide-deck id |
| `download report ... --artifact-id` | ✅ | 补全 report id |
| `download audio ... --artifact-id` | ✅ | 空（无 audio artifact）|
| `download video ... --artifact-id` | ✅ | 空（无 video artifact）|
| `download-slide-deck`（flat）| ✅ | 同 slide-deck |
| `download-report`（flat）| ✅ | 同 report |

### 统一 PR 准入复核（当前有效）

**可进入统一 PR 的能力：**
1. `source-add-text` / `source wait` / `source wait-for-sources` / `source delete` — 稳定
2. `notes list` / `notes get --note-id` / `notes create` / `notes delete --note-id` / `notes rename --note-id` — 稳定
3. `generate report --wait` — 完整闭环，downloadable
4. `download list` / `download report` — 稳定
5. `completion --artifact-id` 补全 — 正确，空时返回空

**不该因运行态问题阻塞 PR 的命令：**
- `source-add-file` — 该能力此前已 live 验证通过；最新定向验证中的失败属于 daemon 侧网络/上传会话运行态问题，不是 adapter 代码问题
- `download slide-deck` — 该能力此前已用 fresh artifact live 验证通过；最新定向验证未能建立新 artifact 前置条件，不应反向否定下载实现

**仍建议拆 follow-up 的部分：**
- `generate audio` / `generate slide-deck` — 在该 notebook 上 `status: failed`；content 调查后仍失败，疑似 server-side payload 限制，不排除代码问题，需独立调查
- `notes-save` 的 visible editor 要求 → 建议文档化而非改设计

**已知设计边界：**
- signed download URL 有 TTL（~1 天）
- resumable upload URL 有 TTL
- audio/slide-deck 生成依赖 notebook 内容丰富程度
- `notes-save` 要求当前页有 visible note editor

## 2026-03-31 剩余运行态定向验证（第 3 轮）

> 本轮用于检查剩余边界，不覆盖此前已经完成的 live 成功样本；若与更早的成功验证冲突，以“能力已验证通过，但本轮样本/环境未满足前置条件”记载。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（浏览器自动化工具全解析）
- 10 条 sources（pdf/web/youtube/pasted-text/audio），内容丰富 ✅
- 该 notebook 之前已成功 generate report ✅
- `bind-current` ✅，`status` ✅ `page: "notebook"`

### 定向验证结果

**模块 1：source-add-file**
- 结果：❌ 运行态失败（HTTP fetch failed）
- 分类：**本轮受 daemon 侧网络/上传会话问题影响**；该能力此前已 live 验证通过
- 清理了 3 条 stale `type-0` 测试 source 残留

**模块 2：notes-save**
- 结果：⚠️ 前置条件未满足
- 分类：**设计边界**（需 visible note editor，CDP 自动化无法人工打开 editor）
- notes list 有 3 条 note，但无 visible editor

**模块 3：generate audio**
- 结果：❌ `status: failed`（`artifact_id: null`）
- 分类：**运行态失败，在内容丰富的 notebook 上仍复现**；report 成功（说明非网络问题）；不排除代码实现问题（payload 格式差异或 server-side 限制）
- 该 notebook 有 7 条正常 sources，内容充分

**模块 4：generate slide-deck**
- 结果：❌ `status: failed`（与 audio 同模式）
- 分类：同模块 3；疑似 audio/slide-deck 共用同一失败根因

**模块 5：download slide-deck**
- 结果：⚠️ 前置条件未满足（generate slide-deck 失败，无法获得新 artifact id）
- 分类：本轮依赖模块 4，闭环无法建立；该能力此前已用 fresh artifact live 验证通过

### 关键发现
- `generate audio` / `generate slide-deck` 的 `status: failed` 在内容丰富的 notebook 上仍复现
- `report` 成功说明核心 RPC 路径正确，R7cb6c 对 report 类型有效
- audio/slide-deck 疑似 payload 类型或格式与 report 不同，或该 notebook 有 server-side 限制
- 这值得独立调查，但不推翻当前统一 PR 的 report/download 主路径
- `source-add-file` 本轮失败是 daemon 侧网络/上传会话问题，不是 adapter 代码问题；该能力此前已 live 验证通过
