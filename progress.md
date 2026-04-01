# NotebookLM OpenCLI Progress

## 2026-03-31

### Session Summary

- Confirmed `opencli` is the Windows/browser-bridge target repo.
- Added NotebookLM adapter scaffold and docs in earlier work.
- Investigated why homepage `wXbhsf` looked empty.
- Captured real NotebookLM homepage network traffic from live Chrome.
- Verified `wXbhsf` is still the real notebook-list RPC.
- Found request-shape bug in local implementation.
- Fixed parameter shape in `src/clis/notebooklm/utils.ts`.
- Updated `src/clis/notebooklm/utils.test.ts`.
- Re-verified live command output:
  - `npx tsx src/main.ts notebooklm list -f json`
  - output now returns RPC-backed notebook rows
- Created planning artifacts for the next phase.
- Started implementation from the new plan using subagents.
- Extracted shared transport into `src/clis/notebooklm/rpc.ts`.
- Added dedicated transport tests in `src/clis/notebooklm/rpc.test.ts`.
- Re-exported shared transport helpers from `utils.ts` to keep existing tests green.
- Compared the current `opencli` NotebookLM surface against the original `notebooklm-cdp-cli` command groups.
- Locked in the compatibility strategy as `alias / wrapper`, not a three-level command tree migration.
- Added framework-level command alias support across:
  - `registry.ts`
  - `commanderAdapter.ts`
  - `serialization.ts`
  - `build-manifest.ts`
  - `discovery.ts`
  - `cli.ts`
  - `completion.ts`
- Added NotebookLM compatibility commands:
  - `notebooklm use` -> alias of `bind-current`
  - `notebooklm metadata` -> alias of `get`
  - `notebooklm notes-list` -> alias of `note-list`
  - `notebooklm source-get <source>` -> wrapper over current source retrieval and filtering
- Added new tests for alias support and NotebookLM compatibility commands.
- Investigated the two main live stability gaps before adding more commands:
  - `history` intermittent page-token failures
  - `source-list` frequently falling back to DOM
- Confirmed NotebookLM page auth tokens are also available in `window.WIZ_global_data`.
- Confirmed `rLM1Ne` detail/source payloads currently arrive as a singleton envelope and with shallower source-id nesting than the old parser assumed.
- Added a retry to `Page.evaluate(...)` for transient target-navigation settle errors.
- Tightened NotebookLM transport/parser logic so read commands stay on RPC more often.
- Re-verified `dist` commands sequentially instead of using the earlier incorrect single-string node invocation.
- Added `notebooklm summary` as a DOM-first read command for the current notebook summary block.
- Added `notebooklm notes-get <title-or-id>` as a minimal read command for the currently visible Studio note editor.
- Verified the real NotebookLM page exposes stable summary selectors and note-editor selectors before implementing those commands.
- Assessed `source-fulltext` data sources before touching any write path.
- Confirmed current page DOM does not reliably expose source fulltext after selecting a source row.
- Confirmed upstream `notebooklm` client uses dedicated source RPCs:
  - `hizoJc` for fulltext
  - `tr032e` for guide
- Added `notebooklm source-fulltext <source>` using source lookup plus `hizoJc`.
- Verified live `hizoJc` payload contains source metadata plus nested content blocks that can be flattened into the extracted fulltext.
- Ran a narrow `source-guide` evaluation only, without implementing a command.
- Confirmed `tr032e` returns guide-shaped data for the current pasted-text source:
  - markdown-style summary
  - keyword list
- Confirmed `tr032e` does not appear to depend on the source being expanded in the current page state.
- Continued the requested cross-type validation in the same notebook after a non-`pasted-text` source was added.
- Verified raw `rLM1Ne` detail now exposes a YouTube source in the current notebook, even though the current `source-list` type parser still reports every source as `pasted-text`.
- Verified `tr032e` on that YouTube source:
  - params still `[[[[source_id]]]]`
  - core guide structure still matches `[[[null, [summary], [[keywords]], []]]]`
  - summary and keywords are guide-like, not fulltext/meta
  - repeated calls before and after clicking the source row remained identical
- Kept the scope narrow: no `source-guide` command implementation, no extra commands, no notebook switch.
- Implemented the deferred follow-up in one narrow wave:
  - fixed `source-list` type/type_code parsing to use the live metadata kind slot
  - added `notebooklm source-guide <source>` over source lookup + `tr032e`
- Added parser coverage for both `tr032e` shapes:
  - slot 0 is `null`
  - slot 0 is a source-id envelope
- Re-verified live that `source-list` now reports `pdf`, `web`, `pasted-text`, and `youtube` correctly in the current notebook.
- Re-verified live that `source-guide` returns `source_id`, `notebook_id`, `title`, `type`, `summary`, `keywords`, and `source: "rpc"`.
- Continued with the next constrained milestone only:
  - implemented `notebooklm ask --prompt ...` as the minimal viable ask path
  - kept scope to the current notebook only
  - did not add thread selection, multi-turn state, note saving, streaming, or any other write command
- Confirmed from upstream `notebooklm-py` that ask uses the dedicated query endpoint rather than `batchexecute`:
  - `GenerateFreeFormStreamed`
- Added minimal ask transport/parsing in the NotebookLM adapter:
  - build query `f.req` from current notebook source ids + prompt + fresh conversation UUID
  - post via in-page fetch with current NotebookLM auth/session tokens
  - parse chunked `wrb.fr` response and return the longest marked answer body
- Added new test coverage for:
  - ask command execution
  - ask request-body shape
  - ask response parsing
- Re-verified live that:
  - `node dist/main.js notebooklm ask --prompt "用一句话总结这个 notebook" -f json`
  - returns `notebook_id`, `prompt`, `answer`, `url`, and `source: "query-endpoint"`
- In a parallel framework-only thread, added minimal nested-command-tree support without touching NotebookLM business adapters:
  - command definitions can now use path-like names such as `source/list`
  - commander maps those to real nested subcommands such as `source list`
  - flat commands remain backward-compatible
- Added failing-then-passing framework tests for:
  - nested commander registration/execution
  - nested completion behavior
  - manifest preservation of path-like command names
- Updated framework output shape so structured command serialization/list rows now include an `invocation` field for space-separated command paths.
- Followed up by remounting the first NotebookLM command slice onto nested canonical paths while keeping flat aliases working:
  - `source/list`
  - `source/get`
  - `source/fulltext`
  - `source/guide`
  - `notes/list`
  - `notes/get`
  - `language/list`
  - `language/get`
  - `language/set`
- Kept the remount wave narrow:
  - no NotebookLM RPC or parser changes
  - no new business commands
  - no `generate/*`, `artifact/*`, or `download/*`
- Added failing-then-passing tests for:
  - nested canonical commands still accepting flat aliases at the site root
  - NotebookLM registry remount keys resolving both nested and flat forms
- Re-verified live that both nested and flat NotebookLM source/language commands continue to work after remount.

### Verification

- `npx vitest run src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npx tsx src/main.ts notebooklm list -f json`
- `npx vitest run src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx tsx src/main.ts notebooklm status -f json`
- `npx tsx src/main.ts notebooklm list -f json | Select-String '"source": "rpc"'`
- `npx vitest run src\\registry.test.ts src\\serialization.test.ts src\\commanderAdapter.test.ts src\\build-manifest.test.ts src\\clis\\notebooklm\\bind-current.test.ts src\\clis\\notebooklm\\binding.test.ts src\\clis\\notebooklm\\history.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\compat.test.ts src\\clis\\notebooklm\\source-get.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- `node dist/main.js notebooklm status -f json`
- `node dist/main.js notebooklm get -f json`
- `node dist/main.js notebooklm source-list -f json`
- `node dist/main.js notebooklm history -f json`
- `node dist/main.js notebooklm use -f json`
- `node dist/main.js notebooklm metadata -f json`
- `node dist/main.js notebooklm source-get "粘贴的文字" -f json`
- `npx vitest run src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\browser\\page.test.ts --reporter=verbose`
- `npx vitest run src\\registry.test.ts src\\serialization.test.ts src\\commanderAdapter.test.ts src\\build-manifest.test.ts src\\browser\\page.test.ts src\\clis\\notebooklm\\bind-current.test.ts src\\clis\\notebooklm\\binding.test.ts src\\clis\\notebooklm\\history.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\compat.test.ts src\\clis\\notebooklm\\source-get.test.ts --reporter=verbose`
- `node dist/main.js notebooklm source-list -f json` repeated 5 times -> 5/5 `source: "rpc"`
- `node dist/main.js notebooklm history -f json` repeated 8 times -> 8/8 `thread_id`
- `npx vitest run src\\clis\\notebooklm\\summary.test.ts src\\clis\\notebooklm\\notes-get.test.ts --reporter=verbose`
- `npx vitest run src\\browser\\page.test.ts src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\summary.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\history.test.ts src\\clis\\notebooklm\\source-get.test.ts src\\clis\\notebooklm\\compat.test.ts --reporter=verbose`
- `node dist/main.js notebooklm summary -f json`
- `node dist/main.js notebooklm notes-get "新建笔记" -f json`
- `npx vitest run src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\source-fulltext.test.ts --reporter=verbose`
- `npx vitest run src\\browser\\page.test.ts src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\source-get.test.ts src\\clis\\notebooklm\\source-fulltext.test.ts src\\clis\\notebooklm\\summary.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\history.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\compat.test.ts --reporter=verbose`
- `node dist/main.js notebooklm source-fulltext "粘贴的文字" -f json`
- live `tr032e` probe on the current source with params `[[[[source_id]]]]`
- repeated `tr032e` calls before and after clicking the source row -> identical summary and keywords across 6 runs
- `node dist/main.js notebooklm source-list -f json` -> current parser still reports every source as `pasted-text`
- live `rLM1Ne` raw payload dump -> current notebook includes at least one non-`pasted-text` source (`code=9`, YouTube)
- live `tr032e` probe on that YouTube source with params `[[[[source_id]]]]`
- repeated `tr032e` calls before and after clicking the YouTube source row -> identical summary / keywords across 6 runs
- `npx vitest run src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\source-guide.test.ts src\\clis\\notebooklm\\source-get.test.ts src\\clis\\notebooklm\\source-fulltext.test.ts --reporter=verbose`
- `node dist/main.js notebooklm source-list -f json` -> live types now render as `pdf`, `web`, `pasted-text`, `youtube`
- `node dist/main.js notebooklm source-guide "黃仁勳最新重磅專訪：AI 代理時代正來...｜Jensen Huang: The Era of AI Agents Is Coming..." -f json`
- `npx vitest run src\\clis\\notebooklm\\ask.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx vitest run src\\browser\\page.test.ts src\\clis\\notebooklm\\ask.test.ts src\\clis\\notebooklm\\bind-current.test.ts src\\clis\\notebooklm\\binding.test.ts src\\clis\\notebooklm\\compat.test.ts src\\clis\\notebooklm\\history.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\source-fulltext.test.ts src\\clis\\notebooklm\\source-get.test.ts src\\clis\\notebooklm\\source-guide.test.ts src\\clis\\notebooklm\\summary.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- `node dist/main.js notebooklm ask --prompt "用一句话总结这个 notebook" -f json`
- `npx vitest run src\\commanderAdapter.test.ts src\\completion.test.ts src\\serialization.test.ts src\\build-manifest.test.ts src\\registry.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- `node dist/main.js list -f json`
- `node dist/main.js completion bash`
- `npx vitest run src\\registry.test.ts src\\serialization.test.ts src\\commanderAdapter.test.ts src\\completion.test.ts src\\build-manifest.test.ts src\\clis\\notebooklm\\compat.test.ts src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\language.test.ts src\\clis\\notebooklm\\source-get.test.ts src\\clis\\notebooklm\\source-fulltext.test.ts src\\clis\\notebooklm\\source-guide.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- `node dist/main.js list -f json`
- `node dist/main.js completion bash`
- `node dist/main.js notebooklm source list -f json`
- `node dist/main.js notebooklm notes get "新建笔记" -f json`
- `node dist/main.js notebooklm language get -f json`
- `node dist/main.js notebooklm source-list -f json`
- `node dist/main.js notebooklm language-get -f json`
- `npx vitest run src\\clis\\notebooklm\\notes-save.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- `node .\\dist\\main.js notebooklm notes-save -f json`
- live只读 probe:
  - visible editor -> `title="新建笔记"`, `content=""`, `id=null`
  - same-title RPC notes -> 2 条，且 `content_length` 都为 `0`

### Open Items

- Continue using the shared transport for more commands beyond `list` / `history`.
- `summary` 已落地，当前优先继续观察是否需要更强 RPC fallback，而不是急着逆新 RPC。
- `notes-get` 当前只保证“当前可见 note editor”读取；后续如果要读任意 note，需要先解决 Studio 列表项稳定展开。
- `source-fulltext` 已落地，当前更适合单独验证 `source-guide` 的 live RPC 稳定性，而不是进入写命令。
- `source-guide` 现已落地为当前 notebook 内的读命令；下一步不该顺手扩到写命令。
- `source-list` 的 type/type_code 解析偏差已修正，当前 live notebook 的 source 类型输出与 RPC metadata 对齐。
- 暂不单独补 `notebook-get`，避免和 `get` / `metadata` / `current` 制造命令噪音。
- `tr032e` 的 live payload 现在已跨 type 验证过，并已经进入 `source-guide` 命令实现。
- Keep `generate/*`, `download/*`, `artifact/*`, and command-tree refactors out of scope for now.
- Three-level command tree support is now in active NotebookLM use for the first remount slice; additional notebook/share/write-adjacent commands are still pending remount.
- The first NotebookLM remount wave is complete, but notebook-level and share/write-adjacent commands still remain on flat names.
- `ask` 当前仍有明确边界：
  - 只支持当前绑定 notebook
  - 每次调用都生成新的 conversation UUID，不做多轮延续
  - 不返回 citations / references
  - 不做流式输出
  - 依赖 RPC source ids，因此页面退化到只有 DOM source 标题时无法继续 ask
- 本轮按顺序补完了 5 组相邻能力：
  - `source-add-text`
  - `source-add-url`
  - `notes-save`
  - `share-status`
  - `language-list` / `language-get` / `language-set`
- `source-add-text` 已按红测 -> 实现 -> 绿测收口，并完成 live：
  - `node .\\dist\\main.js notebooklm source-add-text "opencli source-add-text smoke 2026-03-31" "smoke validation from opencli on 2026-03-31" -f json`
- `source-add-url` 已按红测 -> 实现 -> 绿测收口，并完成 live：
  - `node .\\dist\\main.js notebooklm source-add-url "https://example.com/" -f json`
- `notes-save` 已按红测 -> 实现 -> 绿测收口，但 live 当前受页面状态阻塞：
  - `node .\\dist\\main.js notebooklm notes-save -f json`
  - 当前会明确报 `NOTEBOOKLM_NOTE_AMBIGUOUS`
  - 新的剩余阻塞已缩小为：同一 notebook 中有两条 `新建笔记`，且两条正文都为空，同时 visible editor 周围没有可解析的 stable id
- `share-status` 已按红测 -> 实现 -> 绿测收口，并完成 live：
  - `node .\\dist\\main.js notebooklm share-status -f json`
- `language-list` / `language-get` / `language-set` 已按红测 -> 实现 -> 绿测收口，并完成 live：
  - `node .\\dist\\main.js notebooklm language-list -f json`
  - `node .\\dist\\main.js notebooklm language-get -f json`
  - `node .\\dist\\main.js notebooklm language-set zh_Hans -f json`
- 这轮继续只收 `notes-save`：
  - 已确认 artifact list 的 note 项会暴露 `note-labels-<uuid>`，但 editor 打开后这组节点会消失
  - `notes-save` 现在优先尝试 editor 周围 DOM hint stable id；拿不到时再按 `title + content` 精确匹配 RPC note list
  - 当前 live 的新剩余阻塞不是“标题重复”本身，而是“标题和正文都重复，同时 editor 周围没有 stable id”
- 这轮只做了一个更窄的补强：
  - `notes-get` 增加 `--note-id`
  - `notes-save` 增加 `--note-id`
  - `note-list` / `notes list` 输出显式带 `id`
- 行为变化：
  - `notes-get --note-id <id>` 直接按 RPC id 命中，不再依赖标题匹配
  - `notes-save --note-id <id>` 直接把当前 visible editor 的 title/content 保存到该 id，不再尝试标题消歧
  - 当显式 id 不存在、显式 id 与当前 visible editor 暴露的稳定 id 不一致、或当前页没有 visible editor 时，都会给出更明确的错误
- 这轮验证结果：
  - `npx vitest run src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\notes-save.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
  - `npx tsc --noEmit`
  - `npm run build`
- 这轮 live 只跑到：
  - `node .\\dist\\main.js notebooklm notes list -f json`
  - 当前返回 no data，所以没有继续基于真实 id 运行 `notes get --note-id ...` / `notes-save --note-id ...`
  - 因此这轮 live 结论是：实现和测试已收口，但真实 notebook 页上的 `--note-id` smoke 还缺一个可读的 note-list 结果作为入口
- 这轮 generate 只做重新验证和错误分类增强：
  - 先确认 browser bridge 初始停在 NotebookLM home，无法直接做 live generate
  - 用 daemon `navigate` 把 workspace tab 切回 rich notebook：
    - `a45591ed-37bd-4038-a131-141a295c024b`
  - live 重新验证：
    - `generate report` -> `in_progress`
    - `generate report --wait` -> `completed`
    - `generate audio` -> 立即 `failed`
    - `generate slide-deck` -> 立即 `failed`
  - 额外只读 probe 抓到 raw `R7cb6c` 响应：
    - audio / slide-deck 仍然都是 `UserDisplayableError`
    - 但这次 raw body 不再带可读 message
    - 当前页面也没复现旧账号上的“每日额度/升级”提示
- 因此这轮实现没有改 payload builder，只做了最小错误分类增强：
  - `src/clis/notebooklm/rpc.ts`
    - 增加 `UserDisplayableError` envelope 提取
  - `src/clis/notebooklm/utils.ts`
    - 增加 generate failure message 分类
    - 增加从 raw RPC body 提取 `error_type/message`
    - generate report/audio/slide-deck row 现在会带 `error_type` / `message`
  - `src/clis/notebooklm/shared.ts`
    - `NotebooklmGenerateRow` 新增 `error_type` / `message`
- 这轮分类规则已覆盖：
  - `daily_limit_reached`
  - `feature_not_eligible`
  - `content_insufficient`
  - `generation_failed_unknown`
- 当前新账号 live 结果：
  - report 正常
  - audio / slide-deck 仍失败
  - 由于服务端没有返回可读 message，当前实际落到：
    - `error_type: "generation_failed_unknown"`
    - `message: null`
- 这轮验证结果：
  - `npx vitest run src\\clis\\notebooklm\\rpc.test.ts src\\clis\\notebooklm\\utils.test.ts src\\clis\\notebooklm\\generate-audio.test.ts src\\clis\\notebooklm\\generate-slide-deck.test.ts src\\clis\\notebooklm\\generate-report.test.ts --reporter=verbose`
  - `npx tsc --noEmit`
  - `npm run build`
  - `node dist/main.js notebooklm generate report -f json`
  - `node dist/main.js notebooklm generate audio -f json`
  - `node dist/main.js notebooklm generate slide-deck -f json`
  - `node dist/main.js notebooklm generate report --wait -f json`

## 2026-03-31 Notebook Light-Write CRUD

- 完成 `create`
  - 新增 `src/clis/notebooklm/create.ts`
  - 新增 `src/clis/notebooklm/create.test.ts`
  - utils 补 `CCqFvf` create params 和 helper
  - live: 创建成功，返回真实 notebook id
- 完成 `rename`
  - 新增 `src/clis/notebooklm/rename.ts`
  - 新增 `src/clis/notebooklm/rename.test.ts`
  - utils 补 `s0tc2d` rename params、helper，以及按 id 回读 notebook detail
  - live: `b0aab2fa-ec5f-4fd1-b0d8-55047e46ab2c` 已成功改名
- 完成 `delete`
  - 新增 `src/clis/notebooklm/delete.ts`
  - 新增 `src/clis/notebooklm/delete.test.ts`
  - utils 补 `WWINqb` delete params 和 helper
  - live: 临时 notebook `93ff083f-02af-4d93-a6c8-75f7aed403e7` 已成功删除
- 完成 `describe`
  - 新增 `src/clis/notebooklm/describe.ts`
  - 新增 `src/clis/notebooklm/describe.test.ts`
  - utils 补 `VfAZjd` parser 和 helper
  - 真实收口为：先试结构化 describe RPC，再回退到稳定的 summary wrapper
  - live: `a45591ed-37bd-4038-a131-141a295c024b` 返回 summary 成功，当前来源是 `summary-dom`
- 完成 `remove-from-recent`
  - 新增 `src/clis/notebooklm/remove-from-recent.ts`
  - 新增 `src/clis/notebooklm/remove-from-recent.test.ts`
  - utils 补 `fejl7e` params 和 helper
  - live: `b0aab2fa-ec5f-4fd1-b0d8-55047e46ab2c` 已成功移出 recent

- 本轮每项均按顺序执行：
  - 先补 failing tests
  - 再实现
  - 再跑相关 vitest
  - 再跑 `npx tsc --noEmit`
  - 再跑 `npm run build`
- 本轮未触碰：
  - `notes-get.ts`
  - `notes-save.ts`
  - `note-list.ts`
  - notes 相关测试
  - command tree / commander / registry / completion / build-manifest 框架层
  - `generate/*` / `artifact/*` / `download/*` / `research/*` / `share/*`

## 2026-03-31 Notebook Download Direction Recon + Minimal Report Download

- 按用户要求只侦察 3 条下载链路，不顺手扩 `generate/*` / `artifact/*`：
  - `download audio`
  - `download report`
  - `download slide-deck`
- 对照原仓库 `notebooklm-cdp-cli` 与上游 `notebooklm-py` 后确认：
  - `report` 下载不是 export，也不是外部 URL 下载，而是直接从 `gArtLc` raw artifact slot `7` 取 markdown
  - `slide-deck` 下载走 `gArtLc` raw artifact slot `16`：
    - `[3]` = PDF URL
    - `[4]` = PPTX URL
  - `audio` 下载走 `gArtLc` raw artifact slot `6[5]` media list，优先 `audio/mp4`
- opencli live `gArtLc` probe 结果：
  - notebook `edb0738b-bca1-416c-90f8-c97ca5e22c3f` 已确认存在 completed report artifact
  - notebook `a45591ed-37bd-4038-a131-141a295c024b` / `ffd3074a-5734-4114-be51-5e57e0985321` 已确认存在 completed slide deck artifacts，且 raw 中直接带 PDF/PPTX URL
  - notebook `9924e90f-5d14-4cc1-bd5b-7cf702f76d95` 已确认存在 completed audio artifact，slot `6[5]` 含多条 media URL
- 结论：
  - 第一优先级是 `download/report`
  - 它不需要先做 `artifact/list|get|export` 公开命令
  - 只要内部 helper 能调用 `gArtLc` 并选中 completed report 即可
- 因为链路已经足够清晰，这轮直接落了一个最小命令而不是只停在调研：
  - 新增 `src/clis/notebooklm/download-report.ts`
  - 新增 `src/clis/notebooklm/download-report.test.ts`
  - `shared.ts` 新增 `NotebooklmReportDownloadRow`
  - `utils.ts` 新增最小 artifact raw helpers：
    - `parseNotebooklmArtifactListResult`
    - `selectNotebooklmCompletedArtifact`
    - `extractNotebooklmReportMarkdown`
    - `listNotebooklmArtifactsViaRpc`
    - `downloadNotebooklmReportViaRpc`
- 当前命令形态：
  - canonical: `notebooklm download report <output_path>`
  - alias: `notebooklm download-report <output_path>`
  - optional: `--artifact-id <id>`
- 这轮实现刻意没做：
  - `artifact/list`
  - `artifact/get`
  - `artifact/export`
  - `download/audio`
  - `download/slide-deck`

### Verification

- `npx vitest run src\\clis\\notebooklm\\download-report.test.ts src\\clis\\notebooklm\\utils.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- live raw probe:
  - `gArtLc` scan across current notebooks to confirm real `report` / `slide_deck` / `audio` artifact rows and slots
- live command-function smoke in one browser session:
  - navigated to `https://notebooklm.google.com/notebook/edb0738b-bca1-416c-90f8-c97ca5e22c3f`
  - executed `notebooklm/download/report` with `--artifact-id 31cd719e-2095-4eef-b4f5-ad55e64ddfc0`
  - wrote `E:\\web\\opencli\\tmp\\notebooklm-report-smoke.md`
- live dist CLI smoke:
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm download report 'E:\\web\\opencli\\tmp\\notebooklm-report-cli-smoke.md' --artifact-id 31cd719e-2095-4eef-b4f5-ad55e64ddfc0 -f json`
- 一个中间排障发现：
  - 首次 CLI smoke 返回 no data，不是 report parser 坏了
  - 原因是 Browser Bridge 工作区漂移回另一个 notebook，导致当前页没有 report artifacts
  - 在把工作区重新落到目标 notebook 后，dist CLI smoke 成功

## 2026-03-31 Notebook Minimal Slide-Deck Download

- 这轮范围保持收敛，只做 `notebooklm download slide-deck`：
  - 不碰 `download/audio`
  - 不补 `artifact/*`
  - 不扩 `generate/*`
  - 不碰 notes 线、notebook CRUD、command tree
- 先做最小取证后确认：
  - 上游 CLI 已暴露 `download slide-deck`
  - raw artifact 仍走 `gArtLc`
  - slide-deck 过滤条件仍是 `type=8` + `status=3`
  - `slot 16[3]` = PDF URL
  - `slot 16[4]` = PPTX URL
- 按 TDD 顺序落地：
  - 先新增失败测试：
    - `src/clis/notebooklm/download-slide-deck.test.ts`
    - `src/clis/notebooklm/utils.test.ts`
  - 再新增实现：
    - `src/clis/notebooklm/download-slide-deck.ts`
    - `src/clis/notebooklm/shared.ts`
    - `src/clis/notebooklm/utils.ts`
- 实际实现链路：
  - `downloadNotebooklmSlideDeckViaRpc(...)`
  - `gArtLc` raw list -> select completed slide-deck artifact -> extract slot `16` URL
  - 复用 opencli `httpDownload(...)`
  - browser cookies 通过 `page.getCookies({ url })` 转成 `Cookie` header
  - `Referer` 维持当前 notebook URL
- 命令形态：
  - canonical: `notebooklm download slide-deck <output_path>`
  - alias: `notebooklm download-slide-deck <output_path>`
  - optional:
    - `--artifact-id <id>`
    - `--output-format pdf|pptx`
- 一个实现期排障发现：
  - 不能直接声明 `--format`
  - 因为 opencli 全局已占用 `-f/--format` 作为输出格式
  - 所以命令内下载格式参数最终定为 `--output-format`

### Verification

- failing tests:
  - `npx vitest run src\\clis\\notebooklm\\download-slide-deck.test.ts src\\clis\\notebooklm\\utils.test.ts`
  - 初次失败点：
    - 缺 `download-slide-deck.ts`
    - 缺 slide-deck URL extraction helper
- green tests:
  - `npx vitest run src\\clis\\notebooklm\\download-slide-deck.test.ts src\\clis\\notebooklm\\utils.test.ts`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live:
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm download slide-deck "E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pdf" --artifact-id 05b1fc1a-c2ba-48b1-b933-027468fc4e16 -f json`
  - `Get-Item "E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pdf" | Select-Object FullName,Length,LastWriteTime`
  - `node dist/main.js notebooklm download slide-deck "E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pptx" --artifact-id 05b1fc1a-c2ba-48b1-b933-027468fc4e16 --output-format pptx -f json`
  - `Get-Item "E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pptx" | Select-Object FullName,Length,LastWriteTime`
- live 结果：
  - 当前 browser workspace 已绑定 notebook `edb0738b-bca1-416c-90f8-c97ca5e22c3f`
  - slide-deck artifact `05b1fc1a-c2ba-48b1-b933-027468fc4e16` 已成功下载：
    - PDF -> `E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pdf` (`16083362` bytes)
    - PPTX -> `E:\\web\\opencli\\tmp\\notebooklm-slide-deck-cli-smoke.pptx` (`18182535` bytes)

## 2026-03-31 Notebook Minimal Audio Download

- 这轮范围保持收敛，只做 `notebooklm download audio`：
  - 不碰 `artifact/*`
  - 不做 `download video`
  - 不扩 `generate/*`
  - 不碰 notes 线、notebook CRUD、command tree
- 先做最小取证后确认：
  - 上游 helper 明确从 `audio_art[6][5]` 取 media variants
  - 选择规则是：
    - 优先第一个 `audio/mp4`
    - 否则回退第一个 variant URL
  - live raw probe 在 notebook `9924e90f-5d14-4cc1-bd5b-7cf702f76d95` 上再次确认：
    - artifact `d7ca8b50-1aaa-49c5-a96e-600b8f6d22d0`
    - `variants` 同时包含 direct `audio/mp4`、HLS、DASH
- 按 TDD 顺序落地：
  - 先新增失败测试：
    - `src/clis/notebooklm/download-audio.test.ts`
    - `src/clis/notebooklm/utils.test.ts`
  - 再新增实现：
    - `src/clis/notebooklm/download-audio.ts`
    - `src/clis/notebooklm/shared.ts`
    - `src/clis/notebooklm/utils.ts`
- 实际实现链路：
  - `downloadNotebooklmAudioViaRpc(...)`
  - `gArtLc` raw list -> select completed audio artifact -> extract `row[6][5]` variant
  - variant 选择保持与上游一致：优先首个 `audio/mp4`
  - 复用 opencli `httpDownload(...)`
  - browser cookies 通过 `page.getCookies({ url })` 转成 `Cookie` header
  - `Referer` 维持当前 notebook URL
- 命令形态：
  - canonical: `notebooklm download audio <output_path>`
  - alias: `notebooklm download-audio <output_path>`
  - optional:
    - `--artifact-id <id>`

### Verification

- failing tests:
  - `npx vitest run src\\clis\\notebooklm\\download-audio.test.ts src\\clis\\notebooklm\\utils.test.ts`
  - 初次失败点：
    - 缺 `download-audio.ts`
    - 缺 audio variant extraction helper
- green tests:
  - `npx vitest run src\\clis\\notebooklm\\download-audio.test.ts src\\clis\\notebooklm\\utils.test.ts`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live:
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm download audio "E:\\web\\opencli\\tmp\\notebooklm-audio-cli-smoke.m4a" --artifact-id d7ca8b50-1aaa-49c5-a96e-600b8f6d22d0 -f json`
  - `Get-Item "E:\\web\\opencli\\tmp\\notebooklm-audio-cli-smoke.m4a" | Select-Object FullName,Length,LastWriteTime`
- live 结果：
  - 当前 browser workspace 已绑定 notebook `9924e90f-5d14-4cc1-bd5b-7cf702f76d95`
  - audio artifact `d7ca8b50-1aaa-49c5-a96e-600b8f6d22d0` 已成功下载
  - 输出文件：
    - `E:\\web\\opencli\\tmp\\notebooklm-audio-cli-smoke.m4a`
    - `1211234` bytes

## 2026-03-31 Notes List Live No-Data Follow-Up

- 这轮只做 `notebooklm notes list` 的 live `no data` 调查与最小修复。
- 先重放 live 失败：
  - `node .\\dist\\main.js notebooklm notes list -f json` -> `no data`
- 取证发现：
  - 当时浏览器里没有可绑定的 `/notebook/...` tab
  - `notebooklm use -f json` 报 `No visible tab matching notebooklm.google.com /notebook/`
  - 因而这次失败首先是页面状态问题，不是直接证明 selector 漂移
- 继续在真实 notebook 页 `a45591ed-37bd-4038-a131-141a295c024b` 上验证：
  - `artifact-library-note` 仍存在
  - DOM note list 可解析 2 条
  - `cFji9` RPC 也可解析 2 条
- 最小代码改动：
  - `src/clis/notebooklm/note-list.ts`
  - `src/clis/notebooklm/note-list.test.ts`
  - 行为改为 `DOM first -> RPC fallback`
- 红绿过程：
  - 新增失败测试：DOM 为空时应回退到 RPC
  - 实现后目标测试转绿
- 本轮验证：
  - `npx vitest run src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\notes-save.test.ts --reporter=verbose`
  - `npx tsc --noEmit`
  - `npm run build`
  - `node .\\dist\\main.js notebooklm notes list -f json`
- 当前 live 结果：
  - 在真实 notebook 页上，`notes list` 已返回 2 条 note
  - 未扩任何 notes 写命令

## 2026-03-31 Notes Light-Write CRUD

- 本轮范围只限 notes 轻写 CRUD：
  - `notes/create`
  - `notes/rename`
  - `notes/delete`
- `notes/create`
  - 新增 `src/clis/notebooklm/notes-create.ts`
  - 新增 `src/clis/notebooklm/notes-create.test.ts`
  - `utils.ts` 新增：
    - `buildNotebooklmCreateNoteParams`
    - `createNotebooklmNoteViaRpc`
  - 实现链路：`CYK0Xb` create -> `cYAfTb` update
- `notes/rename`
  - 新增 `src/clis/notebooklm/notes-rename.ts`
  - 新增 `src/clis/notebooklm/notes-rename.test.ts`
  - `utils.ts` 新增 `renameNotebooklmNoteViaRpc`
  - CLI 形状收口为：
    - `notebooklm notes rename --note-id <id> <new-title>`
    - 可兼容 `--note <old-title> <new-title>`
  - 不再把旧标题放成 positional，避免 `--note-id` 主路径不可调用
- `notes/delete`
  - 新增 `src/clis/notebooklm/notes-delete.ts`
  - 新增 `src/clis/notebooklm/notes-delete.test.ts`
  - `shared.ts` 新增 `NotebooklmNoteDeleteRow`
  - `utils.ts` 新增：
    - `buildNotebooklmDeleteNoteParams`
    - `deleteNotebooklmNoteViaRpc`
- 这轮选择策略保持克制：
  - `rename` / `delete` 优先 `--note-id`
  - 不带 `--note-id` 时，只做“唯一精确标题命中”
  - 重复标题时直接要求用户提供 `--note-id`

### Verification

- `npx vitest run src\\clis\\notebooklm\\notes-create.test.ts --reporter=verbose`
- `npx vitest run src\\clis\\notebooklm\\notes-rename.test.ts --reporter=verbose`
- `npx vitest run src\\clis\\notebooklm\\notes-delete.test.ts --reporter=verbose`
- `npx vitest run src\\clis\\notebooklm\\note-list.test.ts src\\clis\\notebooklm\\notes-get.test.ts src\\clis\\notebooklm\\notes-save.test.ts src\\clis\\notebooklm\\notes-create.test.ts src\\clis\\notebooklm\\notes-rename.test.ts src\\clis\\notebooklm\\notes-delete.test.ts --reporter=verbose`
- `npx tsc --noEmit`
- `npm run build`
- live notebook prep:
  - navigated browser workspace `site:notebooklm` to `https://notebooklm.google.com/notebook/a45591ed-37bd-4038-a131-141a295c024b`
- live create / rename / delete chain:
  - `node .\\dist\\main.js notebooklm notes create "opencli notes create smoke 2026-03-31" "notes create body 2026-03-31" -f json`
  - created note id: `dc55301a-fae4-4cd8-97a2-46f97b7ec732`
  - `node .\\dist\\main.js notebooklm notes rename --note-id dc55301a-fae4-4cd8-97a2-46f97b7ec732 "opencli notes renamed smoke 2026-03-31" -f json`
  - `node .\\dist\\main.js notebooklm notes delete --note-id dc55301a-fae4-4cd8-97a2-46f97b7ec732 -f json`

## 2026-03-31 Source Management Medium-Complexity Commands

- 本轮范围只限：
  - `source/rename`
  - `source/delete`
  - `source/refresh`
  - `source/check-freshness`
- 新增命令：
  - `src/clis/notebooklm/source-rename.ts`
  - `src/clis/notebooklm/source-delete.ts`
  - `src/clis/notebooklm/source-refresh.ts`
  - `src/clis/notebooklm/source-check-freshness.ts`
- 新增测试：
  - `src/clis/notebooklm/source-rename.test.ts`
  - `src/clis/notebooklm/source-delete.test.ts`
  - `src/clis/notebooklm/source-refresh.test.ts`
  - `src/clis/notebooklm/source-check-freshness.test.ts`
- `shared.ts` 新增：
  - `NotebooklmSourceDeleteRow`
  - `NotebooklmSourceRefreshRow`
  - `NotebooklmSourceFreshnessRow`
- `utils.ts` 新增：
  - `buildNotebooklmRenameSourceParams`
  - `renameNotebooklmSourceViaRpc`
  - `deleteNotebooklmSourceViaRpc`
  - `refreshNotebooklmSourceViaRpc`
  - `parseNotebooklmSourceFreshnessResult`
  - `checkNotebooklmSourceFreshnessViaRpc`
- 当前实现边界：
  - 全部仅作用于当前 notebook
  - 写命令和 freshness 检查只接受 `--source-id` 或唯一精确标题
  - 不支持 partial title 模糊命中

### Verification

- item tests:
  - `npx vitest run src/clis/notebooklm/source-rename.test.ts --reporter=verbose`
  - `npx vitest run src/clis/notebooklm/source-delete.test.ts --reporter=verbose`
  - `npx vitest run src/clis/notebooklm/source-refresh.test.ts --reporter=verbose`
  - `npx vitest run src/clis/notebooklm/source-check-freshness.test.ts --reporter=verbose`
- aggregate:
  - `npx vitest run src/clis/notebooklm/source-rename.test.ts src/clis/notebooklm/source-delete.test.ts src/clis/notebooklm/source-refresh.test.ts src/clis/notebooklm/source-check-freshness.test.ts src/clis/notebooklm/utils.test.ts --reporter=verbose`
  - result: `5 files, 52 tests passed`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live:
  - `node dist/main.js notebooklm source list -f json`
  - `node dist/main.js notebooklm source-add-text "opencli source rename smoke 2026-03-31" "source rename delete smoke body 2026-03-31" -f json`
  - created source id: `e234071d-b9f3-4d13-a126-51f97f42a194`
  - `node dist/main.js notebooklm source rename --source-id e234071d-b9f3-4d13-a126-51f97f42a194 "opencli source renamed smoke 2026-03-31" -f json`
  - `node dist/main.js notebooklm source delete --source-id e234071d-b9f3-4d13-a126-51f97f42a194 -f json`
  - `node dist/main.js notebooklm source-add-url "https://example.com/?opencli-source-smoke=2026-03-31" -f json`
    - hit runtime error: `Detached while handling command`
  - `node dist/main.js notebooklm source check-freshness --source-id <id> -f json`
  - `node dist/main.js notebooklm source refresh --source-id <id> -f json`
    - both currently blocked when NotebookLM browser binding drifts to `?addSource=true` page / wrong notebook

## 2026-03-31 Source Runtime Stability

- 本轮只做 source 管理命令运行态稳定性，不新增命令。
- 代码改动：
  - `src/clis/notebooklm/utils.ts`
    - 新增 canonical notebook URL 回正逻辑
    - `ensureNotebooklmNotebookBinding(...)` 改为先读真实页面状态，再决定是否 rebinding
    - bind 后补一次 canonicalize
  - `src/browser/page.ts`
    - `Page.evaluate(...)` 现在会对 `Detached while handling command.` 做一次最小重试
- 测试改动：
  - `src/clis/notebooklm/binding.test.ts`
    - 覆盖 stale currentUrl + real notebook/addSource
    - 覆盖 bind-current 后 canonicalize
  - `src/browser/page.test.ts`
    - 覆盖 detached retry

### Verification

- targeted tests:
  - `npx vitest run src/clis/notebooklm/binding.test.ts --reporter=verbose`
  - `npx vitest run src/browser/page.test.ts --reporter=verbose`
- aggregate:
  - `npx vitest run src/clis/notebooklm/binding.test.ts src/clis/notebooklm/source-refresh.test.ts src/clis/notebooklm/source-check-freshness.test.ts src/browser/page.test.ts src/clis/notebooklm/utils.test.ts --reporter=verbose`
  - result: `5 files, 59 tests passed`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live prep:
  - `node dist/main.js notebooklm status -f json`
  - canonical notebook after fix:
    - `https://notebooklm.google.com/notebook/6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - `node dist/main.js notebooklm source-add-url "https://example.com/?opencli-source-stability=2026-03-31" -f json`
    - created source id: `16e5137e-8108-4df2-a294-8511216697c5`
- repeated live validation:
  - round 1:
    - `node dist/main.js notebooklm source check-freshness --source-id 16e5137e-8108-4df2-a294-8511216697c5 -f json`
    - `node dist/main.js notebooklm source refresh --source-id 16e5137e-8108-4df2-a294-8511216697c5 -f json`
    - `node dist/main.js notebooklm status -f json`
  - round 2:
    - same 3 commands
  - round 3:
    - same 3 commands
  - all 3 rounds stayed on:
    - notebook id `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
    - canonical URL without `?addSource=true`
- live cleanup:
  - `node dist/main.js notebooklm source delete --source-id 16e5137e-8108-4df2-a294-8511216697c5 -f json`

## 2026-03-31 Notebook Minimal Video Download

- 这轮范围保持收敛，只做 `notebooklm download video`：
  - 不碰 `artifact/*`
  - 不扩 `generate/*`
  - 不碰 notes/source/notebook 其他线
  - 不碰 command tree / framework
- 先做最小取证后确认：
  - upstream `notebooklm-cdp-cli` 的 video helper 仍从 `gArtLc` raw artifact rows 取媒体 URL
  - live raw probe 已确认 video artifact type = `3`
  - completed video row 的媒体 metadata 位于 `row[8]`
  - media variants 位于 `row[8][4]`
  - 当前真实样本同时包含：
    - direct `video/mp4`
    - HLS
    - DASH
    - 备用 `video/mp4` (`-dv`)
- 当前最短下载路径：
  - `gArtLc` raw list -> select completed `type=3` artifact -> extract `row[8][4]`
  - 优先第一个 `video/mp4`
  - 用现有 `httpDownload(...)` + browser cookie forwarding 落盘
- 按 TDD 顺序落地：
  - 先新增失败测试：
    - `src/clis/notebooklm/download-video.test.ts`
    - `src/clis/notebooklm/utils.test.ts`
  - 初次失败点：
    - 缺 `download-video.ts`
    - 缺 `extractNotebooklmVideoDownloadVariant(...)`
  - 再新增实现：
    - `src/clis/notebooklm/download-video.ts`
    - `src/clis/notebooklm/shared.ts`
    - `src/clis/notebooklm/utils.ts`
- 命令形态：
  - canonical: `notebooklm download video <output_path>`
  - alias: `notebooklm download-video <output_path>`
  - optional:
    - `--artifact-id <id>`

### Verification

- red -> green tests:
  - `npx vitest run src\\clis\\notebooklm\\download-video.test.ts src\\clis\\notebooklm\\utils.test.ts`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live prep:
  - navigated browser workspace `site:notebooklm` to `https://notebooklm.google.com/notebook/6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - `node dist/main.js notebooklm current -f json`
- live:
  - `node dist/main.js notebooklm download video "E:\\web\\opencli\\tmp\\notebooklm-video-cli-smoke.mp4" --artifact-id 82115e07-8602-4047-8b17-a1773c4fdcde -f json`
  - `Get-Item "E:\\web\\opencli\\tmp\\notebooklm-video-cli-smoke.mp4" | Select-Object FullName,Length,LastWriteTime`
- live 结果：
  - 当前 browser workspace 已绑定 notebook `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
  - video artifact `82115e07-8602-4047-8b17-a1773c4fdcde` 已成功下载
  - 输出文件：
    - `E:\\web\\opencli\\tmp\\notebooklm-video-cli-smoke.mp4`
    - `1212240` bytes

## 2026-03-31 Notebook Minimal Download Index

- 这轮范围保持收敛，只做一个最小下载索引命令：
  - 不新增新的具体下载类型
  - 不碰 `artifact/*`
  - 不扩 `generate/*`
  - 不碰 notes/source/notebook 其他线
  - 不碰 command tree / framework
- 命令名最终选择：
  - canonical: `notebooklm download list`
  - alias: `notebooklm download-list`
- 实现目标收口为：
  - 基于现有 `gArtLc` raw rows
  - 只列出现有 download 命令真正需要的索引信息
  - 不展开完整 artifact payload
- 按 TDD 顺序落地：
  - 先新增失败测试：
    - `src/clis/notebooklm/download-list.test.ts`
    - `src/clis/notebooklm/utils.test.ts`
  - 初次失败点：
    - 缺 `download-list.ts`
    - 缺 `parseNotebooklmDownloadListRows(...)`
  - 再新增实现：
    - `src/clis/notebooklm/download-list.ts`
    - `src/clis/notebooklm/shared.ts`
    - `src/clis/notebooklm/utils.ts`
- 当前索引输出字段：
  - `artifact_id`
  - `artifact_type`
  - `status`
  - `title`
  - `created_at`
  - `download_variants`
  - `source`
- 当前索引范围只覆盖已支持的 downloadable types：
  - `report`
  - `audio`
  - `video`
  - `slide_deck`

### Verification

- red -> green tests:
  - `npx vitest run src\\clis\\notebooklm\\download-list.test.ts src\\clis\\notebooklm\\utils.test.ts`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live:
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm download list -f json`
- live 结果：
  - 当前 browser workspace 已绑定 notebook `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
- `download list` 返回：
  - `video` artifact 1 条
  - `slide_deck` artifact 2 条
  - `report` artifact 1 条
- 当前 slide-deck 样本里 `download_variants` 只显示了已稳定可见的 `pdf`

## 2026-03-31 Notebook Minimal Generate

- 本轮范围只做最小 `generate/*` 闭环：
  - `generate/report`
  - `generate/audio`
  - `generate/slide-deck`
  - 不碰 source ingest / notes / notebook CRUD / share / research / command tree / artifact/*
- 按顺序执行并保持 TDD：
  1. `generate/report`
     - 先加失败测试：
       - `src/clis/notebooklm/generate-report.test.ts`
       - `src/clis/notebooklm/utils.test.ts`
     - 再加实现：
       - `src/clis/notebooklm/generate-report.ts`
       - `src/clis/notebooklm/shared.ts`
       - `src/clis/notebooklm/utils.ts`
     - report 相关测试转绿后才继续下一项
  2. `generate/audio`
     - 先加失败测试：
       - `src/clis/notebooklm/generate-audio.test.ts`
       - `src/clis/notebooklm/utils.test.ts`
     - 再加实现：
       - `src/clis/notebooklm/generate-audio.ts`
       - `src/clis/notebooklm/utils.ts`
     - audio 相关测试转绿后才继续下一项
  3. `generate/slide-deck`
     - 先加失败测试：
       - `src/clis/notebooklm/generate-slide-deck.test.ts`
       - `src/clis/notebooklm/utils.test.ts`
     - 再加实现：
       - `src/clis/notebooklm/generate-slide-deck.ts`
       - `src/clis/notebooklm/utils.ts`
- 实现收口：
  - 统一提交 RPC：
    - `R7cb6c`
  - 新增最小 payload builder：
    - `buildNotebooklmGenerateReportParams(...)`
    - `buildNotebooklmGenerateAudioParams(...)`
    - `buildNotebooklmGenerateSlideDeckParams(...)`
  - 新增最小 generation parser / wait helper：
    - `parseNotebooklmGenerationResult(...)`
    - `waitForNotebooklmGeneratedArtifactViaRpc(...)`
  - 新增 generate helpers：
    - `generateNotebooklmReportViaRpc(...)`
    - `generateNotebooklmAudioViaRpc(...)`
    - `generateNotebooklmSlideDeckViaRpc(...)`
  - 新增最小返回行：
    - `NotebooklmGenerateRow`
    - 字段只含：
      - `notebook_id`
      - `artifact_id`
      - `artifact_type`
      - `status`
      - `created_at`
      - `source`
- 命令面保持最小：
  - canonical:
    - `notebooklm generate report`
    - `notebooklm generate audio`
    - `notebooklm generate slide-deck`
  - aliases:
    - `notebooklm generate-report`
    - `notebooklm generate-audio`
    - `notebooklm generate-slide-deck`
  - 只暴露一个最小开关：
    - `--wait`

### Verification

- related vitest:
  - `npx vitest run src\\clis\\notebooklm\\generate-report.test.ts src\\clis\\notebooklm\\generate-audio.test.ts src\\clis\\notebooklm\\generate-slide-deck.test.ts src\\clis\\notebooklm\\utils.test.ts`
  - 结果：`4 files, 61 tests passed`
- type/build:
  - `npx tsc --noEmit`
  - `npm run build`
- live notebook:
  - `node dist/main.js notebooklm current -f json`
  - notebook id: `6fd8aeb5-ddd1-4114-bcda-c376389a8508`
- live report:
  - `node dist/main.js notebooklm generate report --wait -f json`
  - returned artifact: `1d525e55-7334-4407-b435-e4fbdc3f6349`
  - closure:
    - `node dist/main.js notebooklm download report "E:\\web\\opencli\\tmp\\notebooklm-generate-report-smoke.md" --artifact-id 1d525e55-7334-4407-b435-e4fbdc3f6349 -f json`
- live audio:
  - first wait attempt:
    - `$env:OPENCLI_BROWSER_COMMAND_TIMEOUT='300'; node dist/main.js notebooklm generate audio --wait -f json`
    - result: internal minimal wait timed out after `180` seconds
  - minimal submit path:
    - `node dist/main.js notebooklm generate audio -f json`
    - returned artifact: `7603262d-d1d5-4a75-b266-61d275e293ad`
    - `status: "in_progress"`
  - follow-up visibility:
    - `node dist/main.js notebooklm download list -f json`
    - observed new audio artifact `2f81c937-52fa-4b7c-95a0-29884b78ba1a` with media variants
- live slide-deck:
  - wait attempts:
    - `$env:OPENCLI_BROWSER_COMMAND_TIMEOUT='300'; node dist/main.js notebooklm generate slide-deck --wait -f json`
    - internal minimal wait timed out after `180` seconds
  - follow-up visibility:
    - `node dist/main.js notebooklm download list -f json`
    - observed new slide-deck artifacts:
      - `978ef654-a702-46b9-bdba-231253f1c3a6`
      - `9e4b5582-1b63-482b-ba9f-0223241377c9`
  - closure:
    - `node dist/main.js notebooklm download slide-deck "E:\\web\\opencli\\tmp\\notebooklm-generate-slide-deck-smoke.pdf" --artifact-id 978ef654-a702-46b9-bdba-231253f1c3a6 -f json`


## 2026-03-31 Source Ingest Add-File And Wait

- 范围控制：
  - 只做 source ingest 相邻 3 个命令：
    - `source/add-file`
    - `source/wait-for-sources`
    - `source/wait`
  - 不碰 notes / notebook CRUD / share / language / download / artifact / generate / framework
- 按顺序推进并保持 TDD：
  1. 先补失败测试：
     - `source-add-file.test.ts`
     - `source-wait-for-sources.test.ts`
     - `source-wait.test.ts`
     - `utils.test.ts`
  2. 初次失败点：
     - 缺命令文件
     - 缺 add-file params builder
     - 缺带 status 的 source parser
     - 缺 wait polling helper
  3. 再落实现：
     - `src/clis/notebooklm/source-add-file.ts`
     - `src/clis/notebooklm/source-wait-for-sources.ts`
     - `src/clis/notebooklm/source-wait.ts`
     - `src/clis/notebooklm/shared.ts`
     - `src/clis/notebooklm/utils.ts`
- 实现收口：
  - `add-file` 走：
    - `o4cbdc` 注册 file source
    - NotebookLM resumable upload start
    - upload URL finalize
  - `wait-for-sources` / `wait` 共用 `waitForNotebooklmSourcesReadyViaRpc(...)`
  - 当前 source row 新增最小 status 字段：
    - `status`
    - `status_code`
- 中途只修了一个最小类型问题：
  - `fetch` 上传流的 `duplex` 声明在当前 TS lib 下报错
  - 改成局部交叉类型声明，不改变实际上传行为
- 验证：
  - related vitest：`8 files, 58 tests passed`
  - `npx tsc --noEmit`：通过
  - `npm run build`：通过
  - live：
    - add-file 创建 source `6143e8b6-cb0d-4b18-9192-fbcd2abbebc1`
    - wait / wait-for-sources 都等到 ready

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

## 2026-03-31 Artifact-ID Completion

### Session Summary

- Scoped this round strictly to `artifact-id` completion for existing NotebookLM download commands.
- Confirmed the original completion path was static-only and could not return flag-value candidates.
- Added a minimal async completion path:
  - `src/completion.ts`
  - `src/main.ts`
  - `src/registry.ts`
- Added arg-level completion metadata without expanding into a generic id-completion subsystem.
- Reused the existing NotebookLM download index (`gArtLc` -> `listNotebooklmDownloadArtifactsViaRpc`) as the completion data source.
- Added NotebookLM completion helpers in `src/clis/notebooklm/utils.ts`:
  - type-filtered candidate picker
  - live artifact-id completion probe using `workspace: site:notebooklm`
- Wired `artifact-id` completion into these existing commands only:
  - `download/report`
  - `download/audio`
  - `download/video`
  - `download/slide-deck`
- Kept nested and flat alias forms both supported:
  - `notebooklm download <type>`
  - `notebooklm download-<type>`

### Tests and Verification

- Added failing-then-passing tests in:
  - `src/completion.test.ts`
  - `src/clis/notebooklm/utils.test.ts`
- Verified:
  - `npx vitest run src/completion.test.ts src/clis/notebooklm/utils.test.ts`
  - `npx tsc --noEmit`
  - `npm run build`
  - `node dist/main.js completion bash`
- Live completion probes:
  - `node dist/main.js notebooklm download list -f json`
    - current notebook: `a45591ed-37bd-4038-a131-141a295c024b`
    - current downloadable artifact sample: slide deck `ef34f755-809b-4d86-8517-e65049dca2d2`
  - `node dist/main.js --get-completions --cursor 6 notebooklm download slide-deck out.pdf --artifact-id`
    - returned `ef34f755-809b-4d86-8517-e65049dca2d2`
  - `node dist/main.js --get-completions --cursor 5 notebooklm download-slide-deck out.pdf --artifact-id`
    - returned `ef34f755-809b-4d86-8517-e65049dca2d2`
  - `node dist/main.js --get-completions --cursor 6 notebooklm download report out.md --artifact-id`
    - returned empty, matching current notebook having no report artifact
  - `node dist/main.js --get-completions --cursor 6 notebooklm download audio out.m4a --artifact-id`
    - returned empty, matching current notebook having no audio artifact
  - `node dist/main.js --get-completions --cursor 6 notebooklm download video out.mp4 --artifact-id`
    - returned empty, matching current notebook having no video artifact

## 2026-03-31 统一 PR 前验证（第 2 轮）

> 以下结论是当前统一 PR 的唯一判断口径。上面的 From-0 结果只保留为历史排障记录，不再作为 PR judgment 依据。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（浏览器自动化工具全解析）
- `bind-current` → ✅
- `status` → ✅ `page: "notebook"`

### 模块 A：Source ingest 闭环
| 命令 | 结果 | 备注 |
|------|------|------|
| `source-add-text` | ✅ | RPC，source id 返回 |
| `source wait` | ✅ | `status_code: 2, status: "ready"` |
| `source wait-for-sources` | ✅ | 逗号分隔 ids |
| `source-add-file` | ❌ | `fetch failed`，upload URL 过期（运行态）|

### 模块 B：Notes 精确操作
| 命令 | 结果 | 备注 |
|------|------|------|
| `notes list` | ✅ | 3 条，含两条同名"新建笔记" |
| `notes get --note-id` | ✅ | 绕过重复标题歧义 |
| `notes create` | ✅ | RPC，id 返回 |
| `notes delete --note-id` | ✅ | RPC |
| `notes rename --note-id` | ✅ | RPC |
| `notes-save` | ❌ | 无 visible note editor（设计边界）|

### 模块 C：Generate 最小闭环
| 命令 | 结果 | 备注 |
|------|------|------|
| `generate report --wait` | ✅ | 完整闭环，9.9K 写出 |
| `generate audio` | ❌ | `failed`，notebook 内容限制 |
| `generate slide-deck` | ❌ | `failed` |
| `generate audio/slide-deck --wait` | ❌ | 超时 |

### 模块 D：Download 闭环
| 命令 | 结果 | 备注 |
|------|------|------|
| `download list` | ✅ | 正确索引 |
| `download report` | ✅ | 新 artifact，9.9K 写出 |
| `download slide-deck` | ❌ | URL 过期（运行态）|

### 模块 E：artifact-id 补全
| probe | 结果 |
|--------|------|
| `download slide-deck --artifact-id` | ✅ |
| `download report --artifact-id` | ✅ |
| `download audio --artifact-id` | ✅ 空 |
| `download video --artifact-id` | ✅ 空 |
| 平面 alias | ✅ |

### 统一 PR 建议（当前有效）
**可进入统一 PR：**
- source ingest：`source-add-text/wait/wait-for-sources/delete`
- notes：`list/get --note-id/create/delete --note-id/rename --note-id`
- generate：`report --wait`
- download：`list/report`
- completion：`--artifact-id` 补全

**运行态问题（不应阻塞 PR）：**
- `source-add-file`：该能力此前已 live 验证通过；最新定向验证中的失败属于 daemon 侧网络/上传会话问题
- `download slide-deck`：该能力此前已用 fresh artifact live 验证通过；最新定向验证未能建立新 artifact 前置条件
- `notes-save`：设计边界，需 visible editor

**仍待独立调查：**
- `generate audio` — 内容丰富 notebook 上仍 `status: failed`；report 成功说明非网络问题；**不排除代码实现问题**
- `generate slide-deck` — 与 audio 同模式

**设计边界：**
- signed URL TTL ~1 天
- `notes-save` 要求 visible editor

## 2026-03-31 剩余运行态定向验证（第 3 轮）

> 本轮用于检查剩余边界，不覆盖此前已经完成的 live 成功样本；若与更早的成功验证冲突，以“能力已验证通过，但本轮样本/环境未满足前置条件”记载。

### 测试前提
- notebook: `a45591ed-37bd-4038-a131-141a295c024b`（10 sources，内容丰富）
- 该 notebook 已成功 generate report ✅
- `bind-current` + `status` ✅

### 定向验证结果

| 模块 | 结果 | 分类 |
|------|------|------|
| `source-add-file` | ❌ HTTP fetch failed | 本轮受 daemon 网络/上传会话影响；该能力此前已 live 验证通过 |
| `notes-save` | ⚠️ 前置条件未满足 | 设计边界，需 visible editor |
| `generate audio` | ❌ `status: failed` | 内容丰富 notebook 上仍失败；report 成功≠网络问题；**不排除代码实现问题** |
| `generate slide-deck` | ❌ `status: failed` | 与 audio 同根因 |
| `download slide-deck` | ⚠️ 本轮前置条件未满足 | 本轮依赖模块 4；该能力此前已用 fresh artifact live 验证通过 |

### 关键发现
- `generate audio/slide-deck` 在该 notebook（10 sources）上失败，report 成功 → 网络正常，R7cb6c 对 report 有效
- audio/slide-deck 值得独立调查 payload 类型差异或 server-side 限制，但这不推翻当前统一 PR 的 report/download 主路径
- 建议后续单开 follow-up 调查 audio/slide-deck 的 R7cb6c payload 与 report 的差异

## 2026-03-31 Generate Audio / Slide-Deck专项调查

### Session Summary

- Scoped this round strictly to investigation only.
- Re-read the current generate implementation in:
  - `src/clis/notebooklm/generate-report.ts`
  - `src/clis/notebooklm/generate-audio.ts`
  - `src/clis/notebooklm/generate-slide-deck.ts`
  - `src/clis/notebooklm/utils.ts`
  - `src/clis/notebooklm/shared.ts`
- Compared opencli payload builders against upstream:
  - `E:\\web\\notebooklm-cdp-cli\\src\\notebooklm_cdp_cli\\notebooklm_ops.py`
  - `E:\\web\\tools\\notebooklm-py\\src\\notebooklm\\_artifacts.py`
  - `E:\\web\\tools\\notebooklm-py\\src\\notebooklm\\rpc\\types.py`
- Confirmed statically that opencli is not missing the entire audio/slide-deck payload subtrees.
- Reproduced live on the current rich notebook:
  - `node dist/main.js notebooklm generate report -f json`
  - `node dist/main.js notebooklm generate audio -f json`
  - `node dist/main.js notebooklm generate slide-deck -f json`
- Captured live `R7cb6c` request params and raw responses through a one-off read-only probe script that reused the existing browser workspace:
  - report returns a normal artifact row
  - audio returns `null + UserDisplayableError`
  - slide-deck returns `null + UserDisplayableError`
- Ran a narrow parameter probe:
  - audio with explicit `length=2`
  - audio with explicit `format=1/2`
  - slide-deck with explicit `format=1/2, length=1`
  - all still failed with the same `UserDisplayableError`
- Inspected the live page snapshot and found the key UI evidence:
  - Studio panel currently shows:
    - `您已达到每日音频概览和幻灯片数量上限，改日再来吧。 或进行升级。`

### Outcome

- Current best explanation is now server-side quota / eligibility gating for audio overview and slide deck.
- Current evidence does not support changing:
  - `buildNotebooklmGenerateAudioParams(...)`
  - `buildNotebooklmGenerateSlideDeckParams(...)`
- If a follow-up fix is needed, the minimal target should be:
  - `src/clis/notebooklm/rpc.ts`
  - or `src/clis/notebooklm/utils.ts`
  - specifically to classify and surface this quota-style `UserDisplayableError` clearly

### Verification

- No product code was changed in this round.
- Investigation commands run:
  - `node dist/main.js notebooklm current -f json`
  - `node dist/main.js notebooklm generate report -f json`
  - `node dist/main.js notebooklm generate audio -f json`
  - `node dist/main.js notebooklm generate slide-deck -f json`
  - `node dist/main.js notebooklm download list -f json`
- Additional read-only live probes were run via inline Node scripts against the existing browser workspace to capture:
  - raw `R7cb6c` params
  - raw `R7cb6c` responses
  - current Studio-panel snapshot text
