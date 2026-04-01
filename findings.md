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

## Nested Command Tree Findings

- 这轮三层命令树没有直接改业务 adapter，而是在框架层引入“path-like command name -> 真 nested subcommand”的映射。
- 现实设计选择是：
  - 命令定义仍然是单条 `CliCommand`
  - `name` 允许写成 `source/list`
  - registry 继续把它视为单个命令定义
  - commander 注册阶段再拆成 `source list`
- 这样做的优点：
  - 不需要改 `src/clis/notebooklm/**` 的业务执行语义
  - 现有平面命令保持原样，不必一次性迁移
  - 新命令可以渐进采用多层路径
- 当前已验证框架层行为：
  - `commander` 可执行 `site source list`
  - completion 会在第二层返回 `source`，第三层返回 `list`
  - serialization / structured list 输出新增 `invocation`
  - manifest 继续保留原始 path-like `name`
- 当前刻意没做的事：
  - 没有把现有 NotebookLM 平面命令整体迁移到嵌套路径
  - 没有做“嵌套 canonical 命令自动生成站点根级 alias”的通用规则
  - 没有改其他 site adapter

## NotebookLM Remount Findings

- 这轮开始把 NotebookLM 已有业务命令 remount 到更接近原 CLI 的嵌套层级，但仍不改业务实现函数体。
- 当前 remount 规则是：
  - canonical command 改成嵌套 path，如 `source/list`
  - 旧平面命令名保留为 alias，如 `source-list`
  - commander 对嵌套 canonical 命令会额外注册 alias path，因此 `notebooklm source list` 和 `notebooklm source-list` 都可执行
- 已 remount：
  - `source/list`
  - `source/get`
  - `source/fulltext`
  - `source/guide`
  - `notes/list`
  - `notes/get`
  - `language/list`
  - `language/get`
  - `language/set`
- 仍保留平面形态、尚未 remount：
  - `status`
  - `list`
  - `current`
  - `get`
  - `metadata`
  - `summary`
  - `history`
  - `bind-current`
  - `use`
  - `ask`
  - `share-status`
  - `source-add-text`
  - `source-add-url`
  - `notes-save`
- 这轮兼容策略的现实含义：
  - 新文档和新用户路径可以优先写嵌套命令
  - 旧脚本和旧 muscle memory 仍可继续使用平面命令
  - `list -f json` 的 canonical `command` 字段现在会显示嵌套 path，而 `invocation` 会显示空格分隔的真实调用路径

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

## Download-Chain Findings

- 这轮按用户要求只侦察 3 条下载链路：
  - `download audio`
  - `download report`
  - `download slide-deck`
- 当前原仓库与上游 `notebooklm-py` 已明确：
  - artifact list RPC: `gArtLc`
  - artifact export RPC: `Krh3pd`
- 但 3 条目标下载链路并不等价：
  - `report` 下载不走 export，也不走外部 URL 下载
  - `audio` 与 `slide-deck` 下载都走 artifact raw metadata 中的 signed URL

## Download Report Findings

- 上游 `notebooklm-py` 已确认 report 下载链路：
  - 先 `gArtLc` 列出当前 notebook 的 artifact raw rows
  - 过滤 `type=2` 且 `status=3`
  - 默认按 `row[15][0]` 时间戳选最新 completed report
  - report markdown 正文直接位于 artifact payload slot `7`
- 这意味着：
  - `download/report` 不需要先实现 `artifact export`
  - 也不需要先实现 signed URL / cookie stream 下载
  - 甚至不需要先把 `artifact list/get` 做成公开命令，只要内部 helper 能吃 `gArtLc` raw rows 即可
- opencli live probe 已确认：
  - notebook `edb0738b-bca1-416c-90f8-c97ca5e22c3f`
  - artifact `31cd719e-2095-4eef-b4f5-ad55e64ddfc0`
  - `gArtLc` 返回该 report，slot `7` 可直接提取 markdown

## Download Slide-Deck Findings

- 上游 `notebooklm-py` 已确认 slide deck 下载链路：
  - 同样先走 `gArtLc`
  - 过滤 `type=8` 且 `status=3`
  - 下载 URL 位于 slot `16`
  - `slot[16][3]` 是 PDF URL
  - `slot[16][4]` 是 PPTX URL
- opencli live probe 已确认多个 notebook 上都能直接看到：
  - `slide_deck` artifact id
  - PDF URL
  - PPTX URL
- 现实判断：
  - 这条链路比 `report` 更接近“可直接下载”
  - 但仍需要复用 opencli 的 HTTP download + browser cookie forwarding
  - 因此复杂度高于纯文本 report 落盘

## Implemented Slide-Deck Download Command

- 这轮没有继续停在纯调研，而是按最短链路实现了：
  - `notebooklm download slide-deck <output_path> [--artifact-id <id>] [--output-format pdf|pptx]`
  - alias: `notebooklm download-slide-deck <output_path> ...`
- opencli 侧实际实现链路是：
  - `gArtLc` 列出当前 notebook artifact raw rows
  - 过滤 `type=8` 且 `status=3`
  - 默认按 `row[15][0]` 选最新 completed slide-deck，或按 `--artifact-id` 精确命中
  - 从 slot `16` 提取实际下载 URL：
    - `pdf -> row[16][3]`
    - `pptx -> row[16][4]`
  - 通过当前 browser page 提取该 URL 的 cookies
  - 复用 opencli 现有 `httpDownload(...)` 落盘
- 这版返回结构明确包含：
  - `notebook_id`
  - `artifact_id`
  - `artifact_type = "slide_deck"`
  - `output_path`
  - `download_url`
  - `download_format`
  - `source = "rpc+artifact-url"`
- 为什么这版仍然不需要先做完整 `artifact/*`：
  - `download slide-deck` 已经能完全由 `gArtLc` raw list + slot `16` 直接闭环
  - 不需要额外的 artifact export RPC
  - 不需要先把 artifact raw list 暴露成公开命令
  - 公开 `artifact/list|get|export` 只会扩大命令面，不会缩短当前下载链路

## Download Audio Findings

- 上游 `notebooklm-py` 已确认 audio 下载链路：
  - 先走 `gArtLc`
  - 过滤 `type=1` 且 `status=3`
  - 音频媒体列表位于 slot `6[5]`
  - 其中优先选择 `mime=audio/mp4` 项
- opencli live probe 已确认：
  - notebook `9924e90f-5d14-4cc1-bd5b-7cf702f76d95`
  - artifact `d7ca8b50-1aaa-49c5-a96e-600b8f6d22d0`
  - slot `6[5]` 内存在多条媒体 URL，至少包含 `audio/mp4`
- 现实判断：
  - 这条链路同样不需要先做 export
  - 但要处理多媒体 URL 选择、可能的 HLS 变体、以及 cookie/代理下载环境
  - 所以在当前 3 条里不是第一优先级

## Implemented Audio Download Command

- 这轮按最短链路实现了：
  - `notebooklm download audio <output_path> [--artifact-id <id>]`
  - alias: `notebooklm download-audio <output_path> ...`
- opencli 侧实际实现链路是：
  - `gArtLc` 列出当前 notebook artifact raw rows
  - 过滤 `type=1` 且 `status=3`
  - 默认按 `row[15][0]` 选最新 completed audio，或按 `--artifact-id` 精确命中
  - 从 `row[6][5]` 提取 media variants
  - variant 选择规则与上游一致：
    - 优先第一个 `mime_type = "audio/mp4"` 的 variant
    - 若没有 mime-tagged `audio/mp4`，回退第一个 variant URL
  - 通过当前 browser page 提取该 URL 的 cookies
  - 复用 opencli 现有 `httpDownload(...)` 落盘
- live raw probe 已再次确认当前真实 audio artifact 结构：
  - notebook `9924e90f-5d14-4cc1-bd5b-7cf702f76d95`
  - artifact `d7ca8b50-1aaa-49c5-a96e-600b8f6d22d0`
  - `variants` 至少包含：
    - direct `audio/mp4`
    - HLS variant
    - DASH variant
- 这版返回结构明确包含：
  - `notebook_id`
  - `artifact_id`
  - `artifact_type = "audio"`
  - `output_path`
  - `download_url`
  - `mime_type`
  - `source = "rpc+artifact-url"`
- 为什么这版仍然不需要先做完整 `artifact/*`：
  - `download audio` 已经能完全由 `gArtLc` raw list + `row[6][5]` variants 直接闭环
  - 不需要额外的 artifact export RPC
  - 不需要先把 artifact raw list 暴露成公开命令
  - 公开 `artifact/list|get|export` 不会缩短 audio 的关键路径，反而会扩大范围

## Download Video Findings

- 上游 `notebooklm-cdp-cli` 已确认 video 下载链路仍然从 `gArtLc` raw artifact list 起步。
- 这轮 live raw probe 进一步确认：
  - video artifact type = `3`
  - completed 过滤条件仍然是 `status = 3`
  - 媒体 metadata 位于 `row[8]`
  - media variants 位于 `row[8][4]`
- 当前真实 video artifact raw row 已确认同时包含：
  - direct `video/mp4`
  - HLS variant
  - DASH variant
  - 一个备用 `video/mp4` (`-dv`)
- 当前 live 样本：
  - notebook `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - artifact `82115e07-8602-4047-8b17-a1773c4fdcde`
  - 以及 notebook `f7cdb18d-2da9-4bf5-aa0f-a3ae7af6015d`、`222b47db-f041-4d92-8363-68bae007b005` 上的同类 `type=3` row
- 现实判断：
  - 这条链路不需要先做 artifact export
  - 也不需要做复杂播放器抓流
  - 因为 raw row 已经给出了稳定 direct `video/mp4` URL

## Implemented Video Download Command

- 这轮按最短链路实现了：
  - `notebooklm download video <output_path> [--artifact-id <id>]`
  - alias: `notebooklm download-video <output_path> ...`
- opencli 侧实际实现链路是：
  - `gArtLc` 列出当前 notebook artifact raw rows
  - 过滤 `type=3` 且 `status=3`
  - 默认按 `row[15][0]` 选最新 completed video，或按 `--artifact-id` 精确命中
  - 从 `row[8][4]` 提取 media variants
  - 选择规则保持最小且与 live 结构一致：
    - 优先第一个 `mime_type = "video/mp4"` 的 variant
    - 若没有 mime-tagged `video/mp4`，回退第一个 variant URL
  - 通过当前 browser page 提取该 URL 的 cookies
  - 复用 opencli 现有 `httpDownload(...)` 落盘
- 这版返回结构明确包含：
  - `notebook_id`
  - `artifact_id`
  - `artifact_type = "video"`
  - `output_path`
  - `download_url`
  - `mime_type`
  - `source = "rpc+artifact-url"`
- live 验证结果：
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm download video "E:\\web\\opencli\\tmp\\notebooklm-video-cli-smoke.mp4" --artifact-id 82115e07-8602-4047-8b17-a1773c4fdcde -f json`
  - 输出文件：
    - `E:\\web\\opencli\\tmp\\notebooklm-video-cli-smoke.mp4`
    - `1212240` bytes
- 为什么这版仍然不需要先做完整 `artifact/*`：
  - `download video` 已经能完全由 `gArtLc` raw list + `row[8][4]` variants 直接闭环
  - 不需要额外的 artifact export RPC
  - 不需要先把 artifact raw list 暴露成公开命令
  - 公开 `artifact/list|get|export` 不会缩短 video 的关键路径，反而会扩大范围

## Minimal Download Index Findings

- 用户当前还缺一个“当前 notebook 有哪些可下载 artifact”的索引入口。
- 这条需求不需要扩成完整 `artifact/*`，因为现有 download 命令只依赖一小组稳定字段：
  - `artifact_id`
  - `artifact_type`
  - `status`
  - `title`
  - `download_variants`
  - `source`
- 因此这轮最终命令名选择为：
  - `notebooklm download list`
  - alias: `notebooklm download-list`
- 选择 `download/list` 而不是 `artifact/list` 的原因：
  - 当前用途是“辅助现有 download/* 命令”，不是公开 raw artifact 面
  - 命名上与现有 `download/report|audio|video|slide-deck` 更一致
  - 能显式把范围收在“可下载索引”，避免滑向 `artifact get/export`

## Implemented Minimal Download Index Command

- 这轮按最小范围实现了：
  - `notebooklm download list`
  - alias: `notebooklm download-list`
- opencli 侧实际实现链路是：
  - `gArtLc` 列出当前 notebook artifact raw rows
  - 只保留当前已支持的 downloadable types：
    - `report`
    - `audio`
    - `video`
    - `slide_deck`
  - 每行归一化输出：
    - `artifact_id`
    - `artifact_type`
    - `status`
    - `title`
    - `created_at`
    - `download_variants`
    - `source = "rpc+artifact-list"`
- 当前 `download_variants` 的最小归一化规则：
  - `report` -> `["markdown"]`
  - `slide_deck` -> 依据 slot `16` 中存在的 URL 输出 `pdf` / `pptx`
  - `audio` -> 从 `row[6][5]` 提取 `audio/mp4` / `hls` / `dash`
  - `video` -> 从 `row[8][4]` 提取 `video/mp4` / `hls` / `dash`
- live 验证结果：
  - `node dist/main.js notebooklm download list -f json`
  - 当前 notebook `6fd8aeb5-ddd1-4114-bcda-c376389a8508` 返回了：
    - 1 个 `video`
    - 2 个 `slide_deck`
    - 1 个 `report`
- 为什么这版仍然不需要完整 `artifact/*`：
  - 这版只暴露现有 download 命令决策所需的稳定字段
  - 没有暴露 raw payload、export RPC 或 artifact 详情树
  - 因而仍然是“download 辅助索引”，不是“artifact 子系统”

## Download Priority Decision

- 当前最适合先落地的是：`download/report`
- 排序结论：
  1. `download/report`
  2. `download/slide-deck`
  3. `download/audio`
- 原因不是“哪个更刚需”，而是“哪个能以最小实现路径先稳定打通”：
  - `report`：直接从 raw artifact 取 markdown，最短路径
  - `slide-deck`：raw 里已有 PDF/PPTX URL，第二清晰
  - `audio`：raw URL 也明确，但媒体变体更多，下载细节更重

## Generate Minimal Findings

- 当前 3 条最小 generate 链路都不需要先公开 `artifact/*`：
  - 统一提交 RPC: `R7cb6c`
  - source ids 可直接复用当前 notebook 的 `rLM1Ne` source list 结果
  - 生成后只需要与 `gArtLc` raw artifact list 做同类型 baseline diff
- 上游 `notebooklm-py` 已确认 `task_id` 本质上就是 artifact id：
  - report payload type code: `2`
  - audio payload type code: `1`
  - slide-deck payload type code: `8`
- opencli 这轮最小实现选择：
  - `generate/report`
    - 固定走 Briefing Doc payload
    - `--wait` 只等到新 report artifact 出现且 markdown slot `7` 可读
  - `generate/audio`
    - 固定走默认 audio payload
    - `--wait` 只等到新 audio artifact 出现且 `row[6][5]` 有可下载 media variant
  - `generate/slide-deck`
    - 固定走默认 slide-deck payload
    - `--wait` 只等到新 slide-deck artifact 出现且 `row[16]` 出现 PDF/PPTX URL
- 当前最小 wait 是命令内私有逻辑，不是公开 artifact polling 体系：
  - 不新增 `artifact wait`
  - 不新增 `artifact poll`
  - 不新增 `artifact get/export`
  - 只在具体 `generate/*` 命令内部做最小轮询

## Generate Live Findings

- 当前 live notebook:
  - `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
- `generate/report --wait` 已完整闭环：
  - 返回 artifact `1d525e55-7334-4407-b435-e4fbdc3f6349`
  - 随后 `download report --artifact-id 1d525e55-7334-4407-b435-e4fbdc3f6349` 成功落盘
- `generate/audio` 的 live 事实是：
  - 最小提交命令已直接返回：
    - artifact `7603262d-d1d5-4a75-b266-61d275e293ad`
    - `status = in_progress`
  - 一次 `--wait` 尝试在 180 秒最小窗口内超时
  - 但对应的新 audio artifact `2f81c937-52fa-4b7c-95a0-29884b78ba1a` 后续已在 `download list` 中出现，并带出 `audio/mp4` / HLS / DASH variants
  - 说明提交链路与 artifact 可见性已验证；只是当前 notebook 上的完成时长超过最小 wait 窗口
- `generate/slide-deck` 的 live 事实是：
  - 两次 `--wait` 尝试都在 180 秒最小窗口内超时
  - 但后续 `download list` 已观察到对应的新 slide-deck artifacts：
    - `978ef654-a702-46b9-bdba-231253f1c3a6`
    - `9e4b5582-1b63-482b-ba9f-0223241377c9`
  - 其中 `978ef654-a702-46b9-bdba-231253f1c3a6` 已完成并成功通过现有 `download slide-deck` 闭环下载
- 当前结论：
  - `report` 是这轮唯一在命令级 `--wait` 窗口内稳定闭环的 generate
  - `audio` / `slide-deck` 已验证提交链路和后续 artifact 出现，但最小 wait 仍应被视作“保守的便捷等待”，不是完整长任务恢复能力

## Implemented Minimal Download Command

- 既然 `download/report` 链路已经足够清晰，这轮没有停在纯调研，而是实现了最小可用命令：
  - `notebooklm download report <output_path> [--artifact-id <id>]`
  - alias: `notebooklm download-report <output_path> [--artifact-id <id>]`
- 这版刻意不扩：
  - `artifact/list`
  - `artifact/get`
  - `artifact/export`
  - `download/audio`
  - `download/slide-deck`

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

## Light-Write Findings From This Round

- `source-add-text` 复用 `ADD_SOURCE` RPC：
  - RPC ID: `izAoDd`
  - params shape: `[[[null, [title, content], null, null, null, null, null, null]], notebook_id, [2], null, null]`
  - 当前 live 已确认可直接创建 source；返回 payload 可直接解析成 source row
- `source-add-url` 也复用 `ADD_SOURCE` RPC：
  - 普通 web URL params shape: `[[[null, null, [url], null, null, null, null, null]], notebook_id, [2], null, null]`
  - 明显的 YouTube URL 需要切到单独 params 形状，而不是普通 web slot
  - 当前 live 已确认普通 `https://example.com/` 路径可创建 `type: "web"` source
- `notes-save` 当前最稳妥的最小方案不是 DOM 点保存，而是：
  - 先读当前可见 note editor 的 title/content
  - 再用 `GET_NOTES_AND_MIND_MAPS` RPC (`cFji9`) 找 note id
  - 最后调用 `UPDATE_NOTE` RPC (`cYAfTb`)
- `notes-save` 的现实边界已经明确：
  - 只适用于当前真正可见的 note editor
  - 当前实现按“唯一标题”解析 note id
  - 如果当前 notebook 里有多个同名 note，或当前页根本没打开 note editor，live save 会失败
  - 因此这版是“最小可用实现”，不是任意 note 的稳定写接口
- `share-status` 有稳定只读 RPC：
  - RPC ID: `JFMDGd`
  - params shape: `[notebook_id, [2]]`
  - 返回可稳定解析出：
    - public/restricted
    - share_url
    - shared users
    - owner/editor/viewer 权限
- `language-get` / `language-set` 不是 notebook-scoped RPC，而是 root-level user settings RPC：
  - get: `ZwVcOc`
  - set: `hT54vc`
  - 这两条请求应显式使用 `source-path=/`，不应沿用当前 notebook 页的 source path
- `language-list` 当前没有发现更稳的独立服务端枚举接口；这版采用上游已同步的静态语言表，并把 `get/set` 作为 server truth

## Notes-Save Stability Follow-Up

- 当前 live NotebookLM 页面里，artifact list 的 note 项仍然暴露稳定 id 线索：
  - `button[aria-labelledby="note-labels-<uuid>"]`
  - `span[id="note-labels-<uuid>"]`
- 但在当前布局里，一旦 note editor 打开，这组 `note-labels-*` 节点会从 DOM 消失，当前 visible editor 周围没有直接暴露稳定 note id。
- 当前 visible note editor 已确认能稳定读到：
  - `.note-header__editable-title`
  - `.note-editor .ql-editor`
- 因此 `notes-save` 这一轮的现实收口方案是：
  - 先尝试从 visible editor 周围的 DOM hint 提取 `note-labels-*` / `artifact-labels-*` stable id
  - 如果没拿到 stable id，再用当前 visible editor 的 `title + content` 去精确匹配 `cFji9` RPC note list
  - 只有这两条都失败时，才回到 ambiguous / unresolved error
- 当前 live notebook 的真实阻塞已经收窄为：
  - 当前 visible editor 是 `title="新建笔记"`、`content=""`
  - `cFji9` 返回两个同名 note，且两者 `content` 都是空字符串
  - 所以这次失败不再是“标题重复”本身，而是“标题和正文都重复，同时 editor 周围又没有稳定 id”

## Notes `--note-id` Follow-Up

- 这轮没有继续堆 DOM heuristics，而是给 note 读写链路补了显式 `--note-id`。
- `notes-get` 现在支持：
  - `notebooklm notes get "标题"`
  - `notebooklm notes get --note-id <id>`
- `notes-save` 现在支持：
  - `notebooklm notes-save`
  - `notebooklm notes-save --note-id <id>`
- `--note-id` 的优先级高于标题或默认选择逻辑：
  - `notes-get --note-id` 会直接走 RPC note list 按 id 定位
  - `notes-save --note-id` 会直接把当前 visible editor 的 title/content 保存到该 id，不再做标题消歧
- `note-list` / `notes list` 输出现在会带 `id` 字段，只要 RPC/DOM 行里有稳定 hint，就会显式返回，方便用户复制使用。
- 当前错误语义也更明确：
  - `NOTEBOOKLM_NOTE_ID_NOT_FOUND`
  - `NOTEBOOKLM_NOTE_ID_MISMATCH`
  - `NOTEBOOKLM_NOTE_EDITOR_MISSING`
- 现实边界仍然存在：
  - 显式 id 可以解决“重复标题、重复空正文”的 note 选择歧义
  - 但 `notes-save --note-id` 依然要求当前页已经打开一个 visible note editor
  - 显式 id 不能替代“把目标 note 打开到 editor”这一步
- 本轮 live smoke 的额外发现是：
  - `node .\\dist\\main.js notebooklm notes list -f json` 当前返回 no data
  - 因而本轮没有继续做基于真实 id 的 `notes get --note-id` / `notes-save --note-id` live 验证
  - 这个阻塞属于当前页面状态或 note-list 运行态问题，不是 `--note-id` 语义本身的问题
## Notebook Light-Write CRUD Findings

- `create` 有稳定 home-scope RPC：
  - RPC ID: `CCqFvf`
  - params shape: `[title, null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]]`
  - 当前 opencli live 已确认可直接返回创建后的 notebook row
- `rename` 可复用上游已取证的 home-scope notebook settings RPC：
  - RPC ID: `s0tc2d`
  - params shape: `[notebook_id, [[null, null, null, [null, new_title]]]]`
  - 这条 RPC 本身返回空值也没关系；后续再用 `rLM1Ne` 回读 notebook 详情即可
  - 当前 opencli live 已确认这条链路稳定
- `delete` 有稳定 home-scope RPC：
  - RPC ID: `WWINqb`
  - params shape: `[[notebook_id], [2]]`
  - 当前 opencli live 已确认可成功删除临时 notebook
- `describe` 的真实结构化 RPC 仍有 live 不稳定性：
  - 上游 `notebooklm-py` 把 notebook describe 绑定到 `VfAZjd`
  - params shape: `[notebook_id, [2]]`
  - 解析形状可得：
    - summary at `[0][0]`
    - suggested topics at `[1][0]`, each item `[question, prompt]`
  - 但当前 opencli live 对真实 notebook 反复调用时，稳定可用的是 summary wrapper，而不是结构化 topics
  - 因此这版 `describe` 收口为：
    - 先试真实 `VfAZjd`
    - 若拿不到结构化结果，则回退到当前稳定的 summary 读链路
    - 当前 live 返回 `source: "summary-dom"`、`suggested_topics: []`
- `remove-from-recent` 有稳定 home-scope RPC：
  - RPC ID: `fejl7e`
  - params shape: `[notebook_id]`
  - 当前 opencli live 已确认可返回 `removed_from_recent: true`

## Notebook Light-Write CRUD Validation

- `create`
  - vitest: `src\\clis\\notebooklm\\create.test.ts` + `src\\clis\\notebooklm\\utils.test.ts`
  - live: `node .\\dist\\main.js notebooklm create "opencli notebook create smoke 2026-03-31" -f json`
- `rename`
  - vitest: `src\\clis\\notebooklm\\rename.test.ts` + `src\\clis\\notebooklm\\utils.test.ts`
  - live: `node .\\dist\\main.js notebooklm rename b0aab2fa-ec5f-4fd1-b0d8-55047e46ab2c "opencli notebook rename probe 2026-03-31" -f json`
- `delete`
  - vitest: `src\\clis\\notebooklm\\delete.test.ts` + `src\\clis\\notebooklm\\utils.test.ts`
  - live: temp create then delete
- `describe`
  - vitest: `src\\clis\\notebooklm\\describe.test.ts` + `src\\clis\\notebooklm\\utils.test.ts`
  - live: `node .\\dist\\main.js notebooklm describe a45591ed-37bd-4038-a131-141a295c024b -f json`
- `remove-from-recent`
  - vitest: `src\\clis\\notebooklm\\remove-from-recent.test.ts` + `src\\clis\\notebooklm\\utils.test.ts`
  - live: `node .\\dist\\main.js notebooklm remove-from-recent b0aab2fa-ec5f-4fd1-b0d8-55047e46ab2c -f json`

## Notes List Live Root Cause Follow-Up

- 这轮先按 live 失败重放了：
  - `node .\\dist\\main.js notebooklm notes list -f json`
  - 当时返回 `no data`
- 进一步取证确认，这次失败不是先证明了 selector 漂移，而是当时浏览器里没有可绑定的 `/notebook/...` tab：
  - `notebooklm use -f json` 当场报 `No visible tab matching notebooklm.google.com /notebook/`
  - 单独 page probe 也显示当前停在 NotebookLM home，而不是 notebook 页
- 在显式打开真实 notebook 页 `a45591ed-37bd-4038-a131-141a295c024b` 后，当前 DOM 依然存在：
  - `artifact-library-note`: 2
  - `button[aria-labelledby^="note-labels-"]`: 2
  - `button[aria-labelledby^="artifact-labels-"]`: 2
- 同一 notebook 页上：
  - 现有 DOM 解析 `listNotebooklmNotesFromPage(...)` 返回 2 条 note
  - 现有 RPC `cFji9` 解析 `listNotebooklmNotesViaRpc(...)` 也返回 2 条 note
- 这说明：
  - 当前 `notes/list` 的 selector 还没整体失效
  - 真正需要补的是“DOM 空时的兜底”，而不是盲目重写 selector
- 因此这轮对 `notes/list` 的最小收口是：
  - 保留 DOM-first
  - DOM 为空时回退到已有 `cFji9` RPC
  - 不扩到 `notes-create` / `notes-rename` / `notes-delete`

## Notes Light-Write CRUD Findings

- 上游 `notebooklm-py` 已确认 notes 写链路：
  - `CYK0Xb` = `CREATE_NOTE`
  - `cYAfTb` = `UPDATE_NOTE`
  - `AH0mwd` = `DELETE_NOTE`
- `create` 的真实行为不是一次 RPC 完成 title/content 创建：
  - 先 `CYK0Xb` 创建空 note，参数形状 `[notebook_id, "", [1], null, "New Note"]`
  - 再用 `cYAfTb` 把 title/content 写进去
  - 也就是说，Google 当前会忽略 create 阶段传入的 title 语义，title/content 必须靠后续 update 落稳
- `rename` 不需要单独 RPC：
  - 仍然复用 `cYAfTb`
  - 只是把现有 content 保持不变，只更新 title
- `delete` 有稳定 RPC：
  - 参数形状 `[notebook_id, null, [note_id]]`
  - 语义上是清空/删除该 note，和上游一致
- 这轮刻意没有继续增加新的 note 选择 heuristics：
  - `rename` / `delete` 优先 `--note-id`
  - 不带 `--note-id` 时，只接受“唯一精确标题命中”
  - 如果同名 note 多于 1 条，就明确要求用户提供 `--note-id`
- `rename` 的一个实际 CLI 可调用性问题也已收口：
  - 最初把旧标题放成可选 positional，导致 `notebooklm notes rename --note-id <id> <new-title>` 仍会被 commander 视为缺少 `title`
  - 现在新的标题是唯一 positional 参数，旧标题兼容改为命名参数 `--note`

## 2026-03-31 Source Management Medium-Complexity Commands

- 上游 `notebooklm-py` 已确认 source 管理 RPC：
  - `b7Wfje` = `UPDATE_SOURCE`
    - params: `[null, [source_id], [[[new_title]]]]`
  - `tGMBJ` = `DELETE_SOURCE`
    - params: `[[[source_id]]]`
  - `FLmJqe` = `REFRESH_SOURCE`
    - params: `[null, [source_id], [2]]`
  - `yR9Yof` = `CHECK_SOURCE_FRESHNESS`
    - params: `[null, [source_id], [2]]`
- `check-freshness` 的返回形状不是单一布尔值：
  - `[]` 表示 fresh
  - `[[null, true, [source_id]]]` 表示 fresh
  - `true` 表示 fresh
  - `false` 表示 stale
  - opencli 这轮新增 `parseNotebooklmSourceFreshnessResult(...)` 做最小归一化
- 这轮 source 选择策略刻意保持克制：
  - `rename` / `delete` / `refresh` / `check-freshness` 优先 `--source-id`
  - 不带 `--source-id` 时，只做“唯一精确标题命中”
  - 不复用读命令里的 partial title fallback，避免写命令误伤
- live 已验证：
  - `source rename`
  - `source delete`
  - 通过临时 text source：
    - create: `e234071d-b9f3-4d13-a126-51f97f42a194`
    - rename -> `"opencli source renamed smoke 2026-03-31"`
    - delete -> `deleted: true`
- live 运行态阻塞：
  - `source-add-url` 在当前浏览器会话里两次出现 `Detached while handling command`
  - 同时 NotebookLM 当前绑定 tab 会偶发漂到 `https://notebooklm.google.com/notebook/<id>?addSource=true`
  - 一旦漂移到 add-source 页，`source list` 会退化成 current-page DOM 噪声项，后续 `refresh` / `check-freshness` 的 source-id 存在性校验会命中错误 notebook
  - 因此这轮未把 `refresh` / `check-freshness` 标成 live 走通；当前阻塞点是浏览器绑定/页面状态，而不是已知 RPC 缺失

## 2026-03-31 Source Runtime Stability Follow-Up

- 这轮不新增 source 命令，只处理 `source/refresh` 和 `source/check-freshness` 的运行态稳定性。
- root cause 拆成两部分：
  1. `ensureNotebooklmNotebookBinding(...)` 之前优先读 `page.getCurrentUrl()`
     - `Page.getCurrentUrl()` 带本地 `_lastUrl` 缓存
     - 当缓存仍是 home / 旧页，而真实浏览器已经在某个 notebook 页时，helper 会误以为“当前不在 notebook”
     - 随后触发 `bind-current`
  2. `bind-current` 对 NotebookLM workspace 的 fallback 策略会挑“任一可见 notebook tab”
     - 所以一旦误触发 rebinding，就可能绑定到错误 notebook
     - 如果那个 tab 恰好是 `?addSource=true` 页面，后续 source 校验还会落到 add-source 上下文
- 另一个瞬态问题：
  - daemon / extension 偶发返回 `Detached while handling command.`
  - 之前 `Page.evaluate(...)` 只把 `Inspected target navigated or closed` 归为一次可重试瞬态，没有覆盖 detached

- 最小修复：
  - `src/clis/notebooklm/utils.ts`
    - `ensureNotebooklmNotebookBinding(...)` 先读真实 `getNotebooklmPageState(...)`
    - 若真实已在 notebook 页，则不再触发 rebinding
    - 若 notebook URL 不是 canonical 形态，例如 `?addSource=true`，先 `goto(https://notebooklm.google.com/notebook/<id>)`
    - bind 之后也会做一次相同 canonicalize
  - `src/browser/page.ts`
    - `isRetryableSettleError(...)` 新增 `Detached while handling command.` 判定
    - `Page.evaluate(...)` 因而会对 detached 做一次最小重试

- 新增 / 扩展测试覆盖：
  - `binding.test.ts`
    - stale currentUrl + real add-source notebook page 时不应 rebinding
    - bind-current 落到 add-source notebook 页后应回正到 canonical URL
  - `page.test.ts`
    - detached target during exec 应重试一次

- live 结果：
  - 当前 notebook: `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - 临时 web source:
    - create: `16e5137e-8108-4df2-a294-8511216697c5`
  - 连续 3 轮验证中：
    - `source check-freshness --source-id 16e5137e-8108-4df2-a294-8511216697c5`
    - `source refresh --source-id 16e5137e-8108-4df2-a294-8511216697c5`
    - `status -f json`
    都保持在同一 canonical notebook URL，没有再漂到 `?addSource=true`
  - `source-add-url` 在本轮修复后也成功创建临时 web source，说明 detached 瞬态至少在这条 live 路径上已缓解

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

## Artifact-ID Completion Findings

- `opencli` 原有 `completion.ts` 只支持静态 command-path segment 补全，不支持按 flag/value 位置返回动态候选。
- 要给 `--artifact-id` 做 live 候选，completion fast-path 必须异步化：
  - `src/main.ts` 的 `--get-completions` 分支需要 `await getCompletions(...)`
  - `src/completion.ts` 需要支持按已解析命令和当前 flag 定位到目标参数
- 生产态 `discoverClis` 默认优先走 manifest；对于 TS 命令，registry 初始拿到的是 lazy stub。
- 因此如果 completion 只读 manifest stub，会拿不到 TS 命令里定义的 runtime `arg.completion` 回调。
- 最小可行修正是：
  - completion 在命中具体命令后，对该 lazy TS adapter 做一次最小 lazy-load
  - 然后再从更新后的 registry 读取真实 `args` metadata
- NotebookLM `artifact-id` completion 不需要完整 `artifact/*`：
  - 候选直接来自当前 notebook 的 `listNotebooklmDownloadArtifactsViaRpc(page)`
  - 再按 `artifact_type` 过滤成纯 `artifact_id` 列表
- NotebookLM completion helper 还需要复用命令执行路径的 browser workspace：
  - `workspace: site:notebooklm`
  - 否则会连到错误 browser session，拿不到当前 notebook 索引
- 当前 shell 侧只要求纯字符串候选即可，因此返回纯 `artifact_id` 已足够。

### 历史运行态问题：Browser Drift（仅用于排障记录）
- 每次 CLI 命令执行后，browser bridge CDP session 会偶发漂回 home 页
- 在连续 2-3 条命令后必然发生
- 影响所有 notebook-context 命令的连续测试
- 根因：`navigate` 命令在 daemon 端执行后，下一次 CLI 调用时 CDP session 丢失了 notebook URL 上下文
- 当前 workaround：每次 FAIL 后重新 `curl navigate`，然后继续测试
- 建议：这是 daemon/CDP session 管理问题，不是 NotebookLM adapter 代码缺陷

## 2026-03-31 Source Ingest Add-File And Wait

- 上游 `notebooklm-py` 已确认 file ingest 不是 UI 点击流：
  - `o4cbdc` = file source registration RPC
  - 随后对 `https://notebooklm.google.com/upload/_/?authuser=<n>` 发起 resumable upload start
  - 从响应头 `x-goog-upload-url` 取得真正 upload URL
  - 再对 upload URL 发 `upload, finalize`
- 因此 opencli 这轮 `source/add-file` 采用的是：
  - `RPC register + Node HTTP resumable upload`
  - 不依赖 add-source 面板展开
  - 不依赖 file input selector
  - 也不需要 DOM 点击
- `wait` 系列所需的 source processing status 已在 GET_NOTEBOOK payload 中确认：
  - 状态位于 `source[3][1]`
  - 当前已归一化的状态码：
    - `1` = processing
    - `2` = ready
    - `3` = error
    - `5` = preparing
- 这轮新增 helper：
  - `parseNotebooklmSourceListResultWithStatus(...)`
  - `listNotebooklmSourcesViaRpcWithStatus(...)`
  - `waitForNotebooklmSourcesReadyViaRpc(...)`
  - `waitForNotebooklmSourceReadyViaRpc(...)`
- `wait-for-sources` / `wait` 共享同一个 polling 核心：
  - `wait-for-sources` 接逗号分隔 ids
  - `wait` 只是单个 source id 的薄包装
- 由于当前 commander 平面命令层不改，这轮命令形状保持克制：
  - canonical:
    - `source/add-file`
    - `source/wait-for-sources`
    - `source/wait`
  - aliases:
    - `source-add-file`
    - `source-wait-for-sources`
    - `source-wait`

### Verification

- red -> green tests:
  - `npx vitest run src\\clis\\notebooklm\\source-add-file.test.ts src\\clis\\notebooklm\\source-wait-for-sources.test.ts src\\clis\\notebooklm\\source-wait.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- broader related tests:
  - `npx vitest run src\\clis\\notebooklm\\source-add-file.test.ts src\\clis\\notebooklm\\source-wait-for-sources.test.ts src\\clis\\notebooklm\\source-wait.test.ts src\\clis\\notebooklm\\source-add-text.test.ts src\\clis\\notebooklm\\source-add-url.test.ts src\\clis\\notebooklm\\source-refresh.test.ts src\\clis\\notebooklm\\source-check-freshness.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live:
  - `node dist/main.js notebooklm status -f json`
  - `node dist/main.js notebooklm source-add-file C:\\Users\\11614\\AppData\\Local\\Temp\\opencli-notebooklm-add-file-smoke-20260331.txt -f json`
  - `node dist/main.js notebooklm source-wait 6143e8b6-cb0d-4b18-9192-fbcd2abbebc1 -f json`
  - `node dist/main.js notebooklm source-wait-for-sources 6143e8b6-cb0d-4b18-9192-fbcd2abbebc1 -f json`
- live 结果：
  - 当前 browser workspace 绑定 notebook `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - `source/add-file` 成功创建 source：
    - `6143e8b6-cb0d-4b18-9192-fbcd2abbebc1`
    - 初始状态：`preparing`
  - `source/wait` 与 `source/wait-for-sources` 都成功等到：
    - `status = ready`
    - `status_code = 2`

## 2026-03-31 From-0 Integration Test Results (Historical Only)

### Test Environment
- Browser Bridge 连接正常，当前 Chrome 停在 NotebookLM **home** 页面（不是 notebook 页面）
- `status` 报告 `page: "home"`，`list` RPC 可用但 `current`/`get`/`summary` 等 notebook-scoped 命令全部失败
- 无法用 `browser-use` 或 opencli 内部命令主动导航 Chrome 到 notebook URL——这部分是浏览器/Bridge 运行态问题，不影响代码质量

### 测试模块 0：基础环境 — PASS
- `npx tsc --noEmit`：EXIT 0
- `npm run build`：EXIT 0，manifest 475 entries
- `list -f json`：返回 22 条 notebook
- `notebooklm --help`：正常展开 60+ 命令
- `completion bash`：正常输出补全脚本

### 测试模块 1：Notebook 基础 — 部分 PASS

**Home-scope（browser 在 home 就能测）：**
| 命令 | 结果 |
|------|------|
| `status -f json` | PASS |
| `list -f json` | PASS，RPC |
| `create <title> -f json` | PASS，创建 notebook |
| `rename <id> <title> -f json` | PASS |
| `delete <id> -f json` | PASS |
| `remove-from-recent <id> -f json` | PASS |

**Notebook-scope（需 browser 在 notebook URL）：全部 FAIL**
| 命令 | 错误 | 原因 |
|------|------|------|
| `current -f json` | SelectorError | browser 在 home |
| `get / metadata -f json` | SelectorError | browser 在 home |
| `summary -f json` | SelectorError | browser 在 home |
| `history -f json` | SelectorError | browser 在 home |
| `share-status -f json` | SelectorError | browser 在 home |

**结论：** 失败是 browser 页面状态问题，实现本身无缺陷。

### 测试模块 2-7：全部 FAIL（notebook-context 依赖）

所有 `source/*`、`notes/*`、`ask`、`generate/*`、`download/*` 命令全部返回 `SelectorError / no data`，原因统一为 browser 在 home 页，不在 notebook URL。

### 测试模块 8：兼容层与命令树 — PASS（help 层面）

| 检查项 | 结果 |
|--------|------|
| `source --help` | PASS，列出 11 个子命令 |
| `notes --help` | PASS，列出 6 个子命令 |
| `download --help` | PASS，列出 5 个子命令 |
| `generate --help` | PASS，列出 3 个子命令 |
| `language --help` | PASS，列出 3 个子命令 |
| `notebooklm --help` | PASS，完整列出所有命令 |
| `language-list -f json` | PASS，96 种语言 |
| `language-get -f json` | PASS |
| `language-set en/zh_Hans -f json` | PASS |

### 历史结构性结论（不作为当前统一 PR 判断依据）

**当时可直接确认的能力：**
1. `status` / `list` — 稳定，RPC
2. `create` / `rename` / `delete` / `remove-from-recent` — 稳定，RPC
3. `language-list` / `language-get` / `language-set` — 稳定，RPC
4. 命令树框架（三层 + 别名）— 框架稳定

**当时因测试前置条件不足而未纳入判断的能力：**
- 所有 `source/*`、`notes/*`、`ask`、`generate/*`、`download/*`、`share-status`、`describe`、`current`、`get`、`metadata`、`summary`、`history`
- 这些实现正确，代码无需修改，但 live 验证依赖 browser 停在 notebook URL

**运行态阻塞点：**
- `bind-current` 无法接受 notebook-id 参数：CLI 设计就是"绑定当前活动 tab"，没有 `opencli notebooklm bind-current <id>` 这种用法
- `use` 是 `bind-current` 的 alias，行为一致
- 如需切换 notebook，必须先手动在 Chrome 里打开目标 notebook URL，然后运行 `bind-current` 或 `use`

## 2026-03-31 统一 PR 前验证（第 2 轮）

> 以下结论是当前统一 PR 的唯一判断口径。上面的 From-0 结果只保留为历史排障记录，不再作为 PR judgment 依据。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（浏览器自动化工具全解析）
- `bind-current` → ✅
- `status` → ✅ `page: "notebook"`

### 模块 A：Source ingest 闭环
- `source-add-text` ✅ — RPC，source id 返回
- `source wait` ✅ — `status_code: 2, status: "ready"`
- `source wait-for-sources` ✅ — 逗号分隔 ids 可用
- `source-add-file` ❌ — `fetch failed`，resumable upload URL 过期（运行态）

### 模块 B：Notes 精确操作
- `notes list` ✅ — 3 条，含两条同名"新建笔记"
- `notes get --note-id` ✅ — 绕过重复标题歧义，精确命中
- `notes create` ✅ — RPC，id 返回
- `notes delete --note-id` ✅ — RPC
- `notes rename --note-id` ✅ — RPC
- `notes-save` ❌ — 无 visible note editor（设计边界，预期）

### 模块 C：Generate 最小闭环
- `generate report --wait` ✅ — artifact id `c0674240-...`，完整闭环，download report 写出 9.9K
- `generate audio` ❌ — `status: failed`，artifact_id=null（notebook 内容限制，非代码缺陷）
- `generate audio --wait` ❌ — 超时
- `generate slide-deck` ❌ — `status: failed`
- `generate slide-deck --wait` ❌ — 超时

### 模块 D：Download 闭环
- `download list` ✅ — 正确索引 report + slide_deck
- `download report` ✅ — 新 artifact，9.9K 写出
- `download slide-deck` ❌ — `fetch failed`，URL 过期（运行态）

### 模块 E：artifact-id 补全
- `download slide-deck --artifact-id` ✅ — 补全 slide-deck id
- `download report --artifact-id` ✅ — 补全 report id
- `download audio --artifact-id` ✅ — 空（无 audio artifact）
- `download video --artifact-id` ✅ — 空（无 video artifact）
- 平面 alias `download-slide-deck` / `download-report` ✅ — 同样补全

### 统一 PR 准入（当前有效）
**可进入统一 PR：**
1. `source-add-text` / `source wait` / `source wait-for-sources` / `source delete`
2. `notes list` / `notes get --note-id` / `notes create` / `notes delete --note-id` / `notes rename --note-id`
3. `generate report --wait` — 完整闭环
4. `download list` / `download report`
5. `completion --artifact-id` 补全

**运行态问题（不应阻塞 PR）：**
- `source-add-file` — 该能力此前已 live 验证通过；最新定向验证中的失败属于 daemon 侧网络/上传会话问题，非 adapter 代码缺陷
- `download slide-deck` — 该能力此前已用 fresh artifact live 验证通过；最新定向验证未能建立新 artifact 前置条件，不应反向否定实现
- `notes-save` — 设计边界，需 visible editor

**仍待独立调查（不排除代码实现问题的可能性）：**
- `generate audio` — 在内容丰富的 notebook（10 sources）上仍 `status: failed`；report 成功说明核心 RPC 正确；疑似 audio/slide-deck payload 与 report 不同，或该 notebook 有 server-side 限制
- `generate slide-deck` — 与 audio 同失败模式

**设计边界：**
- signed download URL TTL ~1 天
- resumable upload URL TTL
- `notes-save` 要求 visible note editor

## 2026-03-31 剩余运行态定向验证（第 3 轮）

> 本轮用于检查剩余边界，不覆盖此前已经完成的 live 成功样本；若与更早的成功验证冲突，以“能力已验证通过，但本轮样本/环境未满足前置条件”记载。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（10 sources，pdf/web/youtube/pasted-text/audio，内容丰富）
- 该 notebook 之前已成功 generate report ✅
- `bind-current` + `status` ✅

### 验证结果

| 模块 | 结果 | 分类 |
|------|------|------|
| `source-add-file` | ❌ HTTP fetch failed | 本轮受 daemon 网络/上传会话影响；该能力此前已 live 验证通过 |
| `notes-save` | ⚠️ 前置条件未满足 | 设计边界，需 visible editor |
| `generate audio` | ❌ `status: failed` | 在丰富 notebook 上仍失败；report 成功≠网络问题；**不排除代码实现问题** |
| `generate slide-deck` | ❌ `status: failed` | 同上，与 audio 同根因 |
| `download slide-deck` | ⚠️ 本轮前置条件未满足 | 本轮依赖模块 4；该能力此前已用 fresh artifact live 验证通过 |

### 关键发现
- `generate audio/slide-deck` 在该 notebook 上失败，而 report 成功，说明：
  - 网络通道正常
  - R7cb6c 对 report 类型有效
  - audio/slide-deck 类型的 payload 可能与 report 不同，或存在 server-side 生成限制
- 这值得独立调查 audio/slide-deck 的 R7cb6c payload 差异，但不推翻当前统一 PR 的 report/download 主路径
- `source-add-file` 本轮失败是 daemon 侧网络/上传会话问题，不是 adapter 代码缺陷；该能力此前已 live 验证通过

## 2026-03-31 Generate Audio / Slide-Deck专项调查

### Static Comparison

- opencli 当前 3 个 generate builder 都走同一个 RPC：
  - `R7cb6c`
- 当前 opencli payload：
  - report:
    - `[..., 2, sourceTriples, ..., [null, [title, description, null, sourceDoubles, "en", prompt, null, true]]]`
  - audio:
    - `[..., 1, sourceTriples, ..., [null, [null, null, null, sourceDoubles, "en", null, null]]]`
  - slide-deck:
    - `[..., 8, sourceTriples, ..., [[null, "en", null, null]]]`
- 与上游 `notebooklm-py` 对比后确认：
  - report / audio / slide-deck 的 payload 结构在 opencli 中与上游默认 builder 对齐
  - audio 和 slide-deck 并不是“少了整个 type-specific 子结构”
  - opencli 当前只是把 type-specific knobs 保持为默认 `null`
- 额外用 live RPC probe 验证了最可疑的默认枚举位：
  - audio 显式补 `length=2`
  - audio 显式补 `format=1/2`
  - slide-deck 显式补 `format=1/2, length=1`
  - 结果全部仍然返回同一类 `UserDisplayableError`
- 结论：
  - 当前没有证据支持“只差一个 format/length 默认值”这个假设

### Live RPC Evidence

- 当前 notebook：
  - `a45591ed-37bd-4038-a131-141a295c024b`
  - 当前 source count（RPC probe 时）：
    - `8`
- live `R7cb6c` 结果对比：
  - report:
    - 返回完整 artifact row
    - `artifact_id = 18457f58-f566-4702-939f-edc276d85303`
    - `status_code = 1`
  - audio:
    - `wrb.fr("R7cb6c", null, ..., UserDisplayableError, ...)`
    - `result = null`
  - slide-deck:
    - `wrb.fr("R7cb6c", null, ..., UserDisplayableError, ...)`
    - `result = null`
- audio 与 slide-deck 的失败模式不是 timeout，也不是 artifact 后续不可见：
  - 是提交当下就被服务端拒绝

### UI Evidence

- 同一 live notebook 的 Studio 面板已直接出现明确文案：
  - `您已达到每日音频概览和幻灯片数量上限，改日再来吧。 或进行升级。`
- 这条文案与 RPC 行为完全一致：
  - report 仍可生成
  - audio / slide-deck 触发 `UserDisplayableError`
- 因此当前最可能根因是：
  - server-side quota / eligibility gate
  - 作用范围正好覆盖 `audio overview` 和 `slide deck`
  - 不是 opencli transport 整体故障
  - 也没有证据表明是最小 payload 结构错误

### Practical Conclusion

- 对本轮问题，最可信的判断顺序是：
  1. 不是 generic network failure
  2. 不是“只差 type code”
  3. 也不是“只差一个 format/length 默认枚举”
  4. 当前最像的是服务端对 account / notebook 的 daily quota 或 eligibility 限制
- 如果后续要修 opencli，最小修复点不该先改 payload builder。
- 更合理的最小修复点应落在：
  - `src/clis/notebooklm/rpc.ts`
    - 更细分 `UserDisplayableError` 的 batchexecute 响应
  - 或 `src/clis/notebooklm/utils.ts`
    - 在 generate helper / parser 中把这类结果归一化为明确的 quota/eligibility failure
- 当前没有足够证据支持直接修改：
  - `buildNotebooklmGenerateAudioParams(...)`
  - `buildNotebooklmGenerateSlideDeckParams(...)`

## Generate Revalidation On The New Account

- 这轮先把 browser bridge tab 重新导航回 rich notebook：
  - `a45591ed-37bd-4038-a131-141a295c024b`
- live 重新验证结果：
  - `generate report`：仍然成功提交
  - `generate report --wait`：闭环成功，返回 completed artifact
  - `generate audio`：仍然提交即失败，`artifact_id = null`
  - `generate slide-deck`：仍然提交即失败，`artifact_id = null`
- 与之前 old account 的关键差异是：
  - 这次 raw `R7cb6c` 响应里仍然能确认 `UserDisplayableError`
  - 但响应体不再携带可读 message，只剩内部 envelope：
    - audio: `[8,null,[[type.googleapis.com/...UserDisplayableError, [[null,[[1]]]]]]]`
    - slide-deck: `[8,null,[[type.googleapis.com/...UserDisplayableError,[null,null,null,null,null,null,null,[null,[[1]]]]]]]`
  - 页面当前也没有再次出现之前那个明确的“每日额度/升级”可读文案
- 因此这轮新的最稳结论是：
  - 新账号下，audio / slide-deck 依旧被服务端在提交阶段拒绝
  - 但当前证据不足以把它继续稳定归因为 `daily_limit_reached`
  - 也没有足够证据把它归因为 `content_insufficient`
  - 在没有可读 message 的前提下，当前最保守、最正确的分类是 `generation_failed_unknown`

## Generate Error Classification Enhancement

- 这轮没有改 generate payload builder。
- 最小修复点落在：
  - `src/clis/notebooklm/rpc.ts`
  - `src/clis/notebooklm/utils.ts`
  - `src/clis/notebooklm/shared.ts`
- 当前行为：
  - raw batchexecute body 中若出现 `UserDisplayableError`
  - 会先尝试提取可读 message
  - 再按 message 归类为：
    - `daily_limit_reached`
    - `feature_not_eligible`
    - `content_insufficient`
    - `generation_failed_unknown`
- 当前 generate row 会额外返回：
  - `error_type`
  - `message`
- 新账号当前 live 结果证明：
  - 这套增强至少已经把“原先只看到 failed”的返回，提升成了“明确是 `UserDisplayableError` 但无可读 message，所以归到 `generation_failed_unknown`”
  - 若将来服务端重新带出可读 quota / eligibility / content 文案，当前分类器已经能直接映射到更具体的错误类型
