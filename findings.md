# NotebookLM OpenCLI Findings

## Verified Facts

- NotebookLM 首页当前真实请求仍包含以下 `batchexecute` RPC：
  - `ZwVcOc`
  - `wXbhsf`
  - `ub2Bae`
  - `ozz5Z`
- `wXbhsf` 是“我的笔记本”列表的真实 RPC。
- `wXbhsf` 之前返回空，不是因为 RPC 失效，而是本地请求参数形状发错。
- 修正参数后，`opencli notebooklm list -f json` 已返回 18 条，且 `source: "rpc"`。

## Root Cause of the Empty RPC Result

- 真实前端请求体参数：`[null,1,null,[2]]`
- 本地旧实现发送：`[[null,1,null,[2]]]`
- 多包了一层数组，导致服务端返回 `200` 但结果无法按预期解析。

## Stability Findings From This Round

- `history` 偶发失败不只是页面 HTML 里 token 不稳定，NotebookLM 当前页还会把关键 auth token 暴露在 `window.WIZ_global_data`：
  - `SNlM0e`
  - `FdrFJe`
- 旧实现只扫 `document.documentElement.innerHTML`，因此会错过这条更稳的 token 来源。
- `rLM1Ne` 的 detail/source 返回当前常见为“单元素 envelope 包一层 payload”，旧 parser 没有先解包。
- source id 的 live 形状不总是 `[[id]]`，也会出现 `[id]`，旧 parser 对这种更浅的嵌套层级会漏掉 id。
- `Page.evaluate(...)` 在 bridge 侧偶发遇到 `Inspected target navigated or closed`，一旦不重试，就会把短暂页面 settle 抖动放大成上层命令失败。

## Current Adapter Surface in OpenCLI

- `status`
- `list`
- `current`

Files:

- `src/clis/notebooklm/shared.ts`
- `src/clis/notebooklm/utils.ts`
- `src/clis/notebooklm/status.ts`
- `src/clis/notebooklm/list.ts`
- `src/clis/notebooklm/current.ts`
- `src/clis/notebooklm/utils.test.ts`

## Original notebooklm-cdp-cli Command Surface

High-level groups verified from the source repo:

- `browser`
- `auth`
- `notebook`
- `source`
- `research`
- `share`
- `ask`
- `history`
- `artifact`
- `generate`
- `download`
- `language`
- `notes`

## Migration Buckets

### Read-first

- notebook list / get / summary / metadata / current
- source list / get / guide / fulltext / freshness
- notes list / get
- history
- share status
- research status
- artifact list / get
- language list / get

### Light write

- notebook create / rename / delete / use
- source add-url / add-text / rename / delete / refresh
- notes create / save / rename / delete
- ask
- share public / add / update / remove
- language set

### Long-running / stateful

- source add-file / add-drive / add-research
- research wait
- artifact poll / wait / pending / resolve-pending
- generate report/audio/video/slide/infographic/quiz/flashcards/data-table/mind-map
- revise-slide

### Download / export

- artifact export
- download report/audio/video/slide/infographic/quiz/flashcards/data-table/mind-map

## Architectural Direction

- Keep NotebookLM execution in browser context through `opencli` runtime.
- Build one reusable NotebookLM RPC client before expanding command count.
- Add explicit debug hooks for raw RPC capture because reverse engineering is part of the maintenance cost.

## Command-Surface Mapping Strategy

- `opencli` 当前是 `site + 单层 command` 注册模型。
- 因此不适合把原项目的 `notebook use` / `source get` / `notes list` 原样搬成三层子命令。
- 现实方案是：
  - 原命令只是命名差异时，用 `aliases`
  - 原命令需要一点参数语义适配时，用薄 `wrapper`
  - 暂不实现长任务或下载类空壳命令

## Low-Cost / High-Value Compatibility Commands

| Original CLI surface | OpenCLI command | Strategy | Status |
|---|---|---|---|
| `notebook use` | `notebooklm use` | alias -> `bind-current` | implemented |
| `notebook metadata` | `notebooklm metadata` | alias -> `get` | implemented |
| `notes list` | `notebooklm notes-list` | alias -> `note-list` | implemented |
| `source get` | `notebooklm source-get <source>` | wrapper over `source-list` retrieval + local filtering | implemented |
| `source fulltext` | `notebooklm source-fulltext <source>` | wrapper over source lookup + dedicated source RPC | implemented |
| `source guide` | `notebooklm source-guide <source>` | wrapper over source lookup + dedicated source RPC | implemented |
| `notebook summary` | `notebooklm summary` | new read command, DOM-first with existing RPC fallback hook | implemented |
| `notes get` | `notebooklm notes-get <title-or-id>` | new read command, current visible note editor first | implemented with limitation |
| `notebook get` | `notebooklm get` | existing read command | already present |
| `source list` | `notebooklm source-list` | existing read command | already present |
| `history` | `notebooklm history` | existing read command | already present |

## Alias Framework Findings

- Registry 现在需要把 alias 视为同一命令的备用键，而不是单独 adapter。
- Commander 需要直接注册这些 alias，否则兼容命令名无法执行。
- `opencli list` / `serializeCommand(...)` / help text / build manifest 也需要暴露 alias 元数据，否则兼容层不可见。
- Manifest 与 discovery 都需要保留 alias 信息，避免 build 后能力回退。

## Implemented Compatibility Layer

- `bind-current` 增加 alias：`use`
- `get` 增加 alias：`metadata`
- `note-list` 增加 alias：`notes-list`
- 新增 `source-get`
  - 当前 notebook 上自动前置 `bind-current`
  - 优先复用 `listNotebooklmSourcesViaRpc(...)`
  - RPC 为空时 fallback 到 `listNotebooklmSourcesFromPage(...)`
  - 先按 source id 精确匹配，再按 title 精确匹配，最后接受唯一的标题子串匹配

## Stability Fixes Implemented

- `src/clis/notebooklm/rpc.ts`
  - token 提取增加 `window.WIZ_global_data` fallback
  - 首次 probe 没拿到 token 时增加一次短等待后重试
  - token 失败报错补了更明确的 NotebookLM 页诊断提示
- `src/clis/notebooklm/utils.ts`
  - detail/source parser 先解开 singleton envelope
  - source id 提取改成递归找首个字符串，兼容 `[id]` 和 `[[id]]`
- `src/browser/page.ts`
  - `Page.evaluate(...)` 对 target navigation 类瞬态错误重试一次

## Read-Command Findings From This Round

- 当前 notebook 页存在稳定 summary DOM：
  - `.notebook-summary`
  - `.summary-content`
- 当前 `rLM1Ne` detail payload 没有确认到稳定 summary 字段，因此 `summary` 先走 DOM-first，RPC 只保留为“已有 detail 结果里若出现可识别长文本则提取”的保守 fallback。
- Studio 笔记编辑器在当前页可见时，会暴露可读 selector：
  - `.note-header__editable-title`
  - `.note-editor .ql-editor`
- 目前 `notes-get` 的现实边界是：
  - 能读“当前可见 note editor”
  - 还不能稳定地从任意列表项自动展开并读取正文
  - 因此如果 note 只出现在 Studio 列表里但未展开，命令会明确报限制，而不是假装支持全量随机读取

## Source Fulltext Findings

- 当前 NotebookLM notebook 页里，没有观察到稳定的 source 正文详情 DOM。
- 点击 source 行后，当前页主要只体现“来源被选中”，不会稳定暴露 source 的全文块。
- 原仓库使用的上游 client 证明 `source-fulltext` 不是壳命令，而是独立 RPC：
  - RPC ID: `hizoJc`
  - 参数形状: `[[source_id], [2], [2]]`
- live `hizoJc` 返回已验证包含：
  - source 元信息
  - content blocks at `result[3][0]`
  - 可递归提取出全文字符串
- 这意味着 `source-fulltext` 的现实方案应是：
  - 先用现有 `source-list` / `source-get` 的匹配逻辑定位 source id
  - 再走 `hizoJc` 独立 RPC 提取全文
  - 不需要先依赖当前 source 详情 panel DOM

## Source Guide Assessment

- 原仓库也确认存在独立 RPC：
  - RPC ID: `tr032e`
  - 参数形状: `[[[[source_id]]]]`
- live 验证结果：
  - 当前 pasted-text source 上直接调用 `tr032e` 能稳定返回
  - 返回结构与原仓库解析一致：`[[[null, [summary], [[keywords]], []]]]`
  - 同一 source 连续重复调用 3 次，返回 summary 长度与 keywords 全部一致
  - source 未点击展开时调用一次、点击 source 行后再调用 3 次，返回仍完全一致
- 语义验证结果：
  - 返回是约 300 字的导读性 summary，加一组 topic keywords
  - 与 `source-fulltext` 的长文本正文显著不同，不是换皮 metadata，也不是换皮 fulltext
  - 当前看起来符合“面向 source 的导读/结构摘要/学习引导”
- 当前边界：
  - 原先只确认对 pasted-text source 可用
  - 当前 notebook 新增非 pasted-text source 后，已完成额外的 live cross-type 验证

## Source Guide Cross-Type Validation

- 当前 notebook 的原始 `rLM1Ne` payload 已确认存在非 pasted-text source：
  - `code=9` 的 YouTube source
  - 同一个 notebook 里还出现了带外链元数据的其他 source，但这轮只验证 1 个额外 type，不扩范围
- 一个重要附带发现：
  - 现有 `source-list` 命令的类型解析还在读 `entry[3]`
  - 但 live `rLM1Ne` 里更像真实 source kind 信号的是 `entry[2][4]`
  - 因此这轮 cross-type 取证直接基于原始 `rLM1Ne` payload，而不是当前 `source-list` 的 `type/type_code`
- `tr032e` 在当前 notebook 的 YouTube source 上验证结果：
  - 参数形状仍然成立：`[[[[source_id]]]]`
  - 返回的核心结构仍然成立：`[[[null, [summary], [[keywords]], []]]]`
  - 个别调用的第 0 槽位会出现 source id envelope，但 summary / keywords / trailing empty array 的 4 槽布局保持不变
  - summary 仍然是导读式内容，keywords 仍然是主题词，不是 fulltext 或 metadata 换皮
  - 在未操作 source 行时连续调用 3 次，summary / keywords 完全一致
  - 点击该 YouTube source 行后再次连续调用 3 次，summary / keywords 仍完全一致
- 这说明：
  - `tr032e` 不只适用于 pasted-text，至少对当前 notebook 的 YouTube source 也稳定成立
  - `source-guide` 已经跨过“单一 source type 才成立”的阻塞
  - 因此 `source-guide` 已可作为当前 notebook 内的 source 读命令实现

## Source Type Parsing Fix

- `source-list` 之前把 `entry[3]` 当作 source type/type_code 来源，但 live `rLM1Ne` 里这个槽位当前更像固定 envelope，不能区分 source kind。
- 当前 live notebook 已验证更可靠的 kind 槽位在 `entry[2][4]`：
  - `3 -> pdf`
  - `5 -> web`
  - `8 -> pasted-text`
  - `9 -> youtube`
- 因此 source 相关读命令现在统一优先按 metadata kind 槽位解析 type/type_code，再回退旧 envelope。
- live `source-list` 已确认修正后输出：
  - `CU240S__en-US_(1)_zh-Hans.pdf` -> `pdf`
  - `PDF24 Tools: 免费且易于使用的在线PDF工具` -> `web`
  - `粘贴的文字` -> `pasted-text`
  - `黃仁勳最新重磅專訪...` -> `youtube`

## Source Guide Implementation

- `source-guide` 的现实实现方案已经落地：
  - 先复用现有 `source-list` / `source-get` 同一套 source lookup
  - 再走独立 RPC `tr032e`
  - 输出字段固定为：
    - `source_id`
    - `notebook_id`
    - `title`
    - `type`
    - `summary`
    - `keywords`
    - `source: "rpc"`
- `tr032e` 解析需要兼容两类 live 形状：
  - `[[[null, [summary], [[keywords]], []]]]`
  - `[[[[[source_id]], [summary], [[keywords]], []]]]`
- 目前命令边界保持克制：
  - 只支持当前 notebook 内按 source id / title 匹配
  - 不切 notebook
  - 不扩展到写命令或 artifact 命令

## Live Verification After Stability Fixes

- `node dist/main.js notebooklm source-list -f json`
  - 顺序重复 5 次，5/5 返回 `source: "rpc"`
- `node dist/main.js notebooklm history -f json`
  - 顺序重复 8 次，8/8 返回 `thread_id`
- `node dist/main.js notebooklm summary -f json`
  - 返回当前 notebook 的 summary 文本，`source: "summary-dom"`
- `node dist/main.js notebooklm notes-get "新建笔记" -f json`
  - 在当前可见 note editor 上返回 note 标题与正文，`source: "studio-editor"`
- `node dist/main.js notebooklm source-fulltext "粘贴的文字" -f json`
  - 通过 `hizoJc` RPC 返回 source 全文，`source: "rpc"`
- `node dist/main.js notebooklm source-guide "黃仁勳最新重磅專訪：AI 代理時代正來...｜Jensen Huang: The Era of AI Agents Is Coming..." -f json`
  - 通过 `tr032e` RPC 返回 guide summary + keywords，`type: "youtube"`，`source: "rpc"`
- `tr032e` live repeated on the current pasted-text source
  - 参数形状确认：`[[[[source_id]]]]`
  - 未点击 source 与点击 source 后各重复调用 3 次，summary / keywords 完全一致
- 单次 `dist` smoke 也已确认：
  - `status`
  - `get`
  - `source-list`
  - `history`
  - `use`
  - `metadata`
  - `source-get`
  - `source-fulltext`
  - `summary`
  - `notes-get`

## Explicit Non-Goals For This Wave

- 不补 `generate/*` / `download/*` / `artifact/*` 的兼容空壳。
- 不把 Linux-only `notebooklm-cdp-cli` 状态文件或 direct CDP 逻辑移植到 `opencli`。
- 不重构 `opencli` 为三层命令树。
- 不为了追命令数量而跳过 transport / parser / runtime 稳定性收口。

## Implemented So Far

- `src/clis/notebooklm/rpc.ts` now owns shared transport primitives:
  - auth extraction
  - rpc body encoding
  - anti-XSSI stripping
  - chunked response parsing
  - page-side fetch
  - generic `callNotebooklmRpc(...)`
- `src/clis/notebooklm/list.ts` now reaches notebook list RPC through the shared transport path.

## Ask Minimal-Viable Findings

- 当前 `ask` 不走 `batchexecute` RPC，也不需要 DOM 点按钮；上游 `notebooklm-py` 已确认真实链路是独立 query endpoint：
  - `https://notebooklm.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed`
- query body 不是 `[[[rpcId, ...]]]` 形状，而是：
  - `f.req=[null, JSON.stringify(params)]`
  - `params = [sources_array, prompt, conversation_history|null, [2, null, [1]], conversation_id]`
- 最小可用 ask 依赖当前 notebook 的真实 source ids：
  - 当前实现直接复用已稳定的 `source-list` RPC 解析结果
  - 不接受 DOM source fallback，因为当前页 DOM 不能稳定给出真实 source UUID
- query response 是分块文本流，但最小可用版不需要流式输出：
  - 当前实现按 chunk 扫描 `wrb.fr`
  - 提取 `first[0]` 文本
  - 优先选择 `first[4][-1] == 1` 的最长 answer chunk
  - 若没有 marked answer，才回退到最长未标记文本
- live smoke 已确认：
  - `node dist/main.js notebooklm ask --prompt "用一句话总结这个 notebook" -f json`
  - 当前绑定 notebook 可直接返回回答正文，`source: "query-endpoint"`
