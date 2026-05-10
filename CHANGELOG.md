# Changelog

## Unreleased

### Features

* **help / browser** — `opencli browser --help -f yaml|json` now emits a structured, agent-ready index of all browser leaf commands (including nested `tab`, `get`, and `dialog` commands), their positionals, command options, namespace options, and root global options. Individual browser commands also support structured help, backed by a shared Commander option/argument spec extractor.
* **browser state** — add opt-in AX snapshot refs via `browser state --source ax`, including backend-node click resolution and role/name stale-ref recovery for the Phase 0 browser-agent runtime prototype.
* **browser state** — AX snapshots now include same-origin iframe refs, and `browser state --compare-sources` prints DOM-vs-AX observation metrics for the Phase 1 default-source decision without dumping page contents.
* **browser locators** — `browser find`, `browser click`, and `browser get text|value|attributes` now accept semantic locator flags (`--role`, `--name`, `--label`, `--text`, `--testid`) so agents can act on common controls without a separate state-ref lookup.

### Bug Fixes

* **browser click** — `browser click` now prefers CDP `Input.dispatchMouseEvent` over DOM `el.click()`, so custom dropdowns that depend on pointer/mouse events (Radix, shadcn, Material UI, Mercury-style category pickers) open and select reliably while retaining JS click as a fallback for older backends or zero-rect targets.
* **browser state / extension 1.0.7** — `browser state --source ax` now enables the CDP Accessibility domain before reading the AX tree, fixing real-Chrome snapshots that previously returned only `RootWebArea` with zero refs.
* **help / build** — every positional arg must now declare a non-empty `help` string. The build-manifest step fails closed when a positional has empty / whitespace-only / missing `help`, so `opencli <site> <cmd> --help` always shows callers what each parameter is for. Pre-existing offenders (`twitter followers/following/list-add/list-remove/list-tweets/search/thread`, `reddit search/subreddit/user/user-comments/user-posts`, `douyin stats/update`, `bilibili subtitle`, `jike search`) now have explicit help text — most notably `twitter followers [user]` and `following [user]` now document that omitting the user fetches the currently logged-in account.

## [1.7.14](https://github.com/jackwener/opencli/compare/v1.7.13...v1.7.14) (2026-05-08)

### Features

* **help** — adapter help is now agent-friendly: per-command listings drop the `[options]` noise from globally-shared options (`--format`, `--trace`, `-v`, `-h`, etc.) and only mention them at the site level, so `opencli twitter` etc. read like a flat command index. ([#1401](https://github.com/jackwener/opencli/issues/1401))
* **twitter** — write-action symmetry P0: add `unlike`, `retweet`, `unretweet`, and `quote` to round out the read/write coverage. ([#1400](https://github.com/jackwener/opencli/issues/1400))

### Bug Fixes

* **browser daemon** — `npm install -g @jackwener/opencli@latest` now correctly auto-restarts a stale ready-state daemon so users pick up the new version without a manual `opencli daemon restart`. ([#1399](https://github.com/jackwener/opencli/issues/1399))

## [1.7.13](https://github.com/jackwener/opencli/compare/v1.7.12...v1.7.13) (2026-05-07)

Extension bumped to 1.0.6 (screenshot `--width` / `--height` / `--full-page` flags, automation tab group color marker, automation container reuse fix).

### ⚠ BREAKING CHANGES

* **linux-do** — remove deprecated compatibility shims `linux-do hot`, `linux-do category`, `linux-do latest`. Use `linux-do feed --view top --period <period>`, `linux-do feed --category <id-or-name>`, and `linux-do feed --view latest` instead.
* **grok ask** — drop the `--web` flag and the legacy `<textarea>` composer path. The default flow is now the only path and uses the current ProseMirror+TipTap composer (the path that used to require `--web true`). Existing scripts passing `--web` will get an "unknown option" error from commander; remove the flag.
* **env** — rename `OPENCLI_BROWSER_TIMEOUT` to `OPENCLI_BROWSER_IDLE_TIMEOUT`. The variable controls workspace lease idle release time, not per-command runtime; the new name reflects that. Old name was undocumented and removed without a fallback.
* **registry** — remove the unused `Strategy.HEADER`; adapter authors should use `Strategy.COOKIE` and set headers explicitly inside browser-side fetches.

### Features

* **observation** — add trace artifact primitives, `browser console`, `browser network --since/--follow/--failed`, and adapter `--trace=retain-on-failure` for failure-retained browser evidence.
* **autofix** — retire `OPENCLI_DIAGNOSTIC`; adapter repair now uses `--trace retain-on-failure`, trace `summary.md`, and error-envelope trace metadata.
* **browser** — `bind` attaches `bound:*` workspaces to user-owned Chrome tabs without taking over window lifecycle; `sessions` reports `idleMsRemaining: null` for bound workspaces because they do not schedule idle close timers. ([#1169](https://github.com/jackwener/opencli/issues/1169), [#929](https://github.com/jackwener/opencli/issues/929))
* **browser lifecycle** — owned browser workspaces now lease tabs inside a shared dedicated automation container instead of owning one Chrome window per workspace; lease state is persisted for MV3 service-worker reconciliation and idle cleanup is backed by alarms.
* **browser session** — adapter commands can opt into site-level tab reuse with `browserSession.reuse = 'site'`; Grok and other browser-backed LLM adapters now keep a shared site tab by default, and users can override with `--reuse <none|site>`.
* **chatgpt** — add browser-web baseline commands: `ask`, `send`, `read`, `history`, `detail`, `new`, and `status`.
* **grok** — add browser-web baseline commands: `read`, `history`, `detail`, `new`, `send`, and `status` (existing `ask` and `image` unchanged).
* **yuanbao** — add browser-web baseline commands: `send`, `status`, `read`, `history`, and `detail` (joining the existing `ask` and `new`).
* **qwen** — add `detail` command for opening a specific historical conversation by id.
* **web read** — make page extraction render-aware: same-origin iframe content is merged into the Markdown source, `--wait-for` can wait inside main/iframe documents, `--wait-until networkidle` waits for captured requests to settle, and `--diagnose` reports frames, empty containers, and API-like XHRs for shell/AJAX pages.

### Bug Fixes

* **pipeline / capabilityRouting** — the `fill` pipeline step (introduced in [#1222](https://github.com/jackwener/opencli/issues/1222)) now correctly triggers a browser session and gets transient retry coverage; previously a pipeline using only `fill` could crash on a missing page object. ([#1393](https://github.com/jackwener/opencli/issues/1393))
* **xiaohongshu publish** — improve image publishing reliability via creator-center URL routing, tab priority handling, and DataTransfer fallback.
* **youtube** — use watch-page HTML for transcript captions to recover when the public transcript API is unavailable.
* **desktop adapters** — restore 11 desktop adapter commands that were lost from the manifest due to a factory-pattern regression.

### Internal

* **cleanup** — remove dead `src/analysis.ts` (179 lines, 0 importers), retire `OPENCLI_DIAGNOSTIC` test residue, derive validator step allowlist from the live pipeline registry to prevent future drift.

## [1.7.8](https://github.com/jackwener/opencli/compare/v1.7.7...v1.7.8) (2026-04-25)

### Features

* **powerchina** — procurement search adapter. ([#1155](https://github.com/jackwener/opencli/issues/1155))
* **toutiao** — `articles` adapter for 头条号 creator dashboard. ([#1148](https://github.com/jackwener/opencli/issues/1148))
* **weixin** — `create-draft` and `drafts` commands for Official Account. ([#1095](https://github.com/jackwener/opencli/issues/1095))

### Bug Fixes

* **chatgpt-app** — use AX send flow and support zh-CN generating state. ([#1135](https://github.com/jackwener/opencli/issues/1135))
* **deepseek** — fix history titles and resume conversation on `ask`. ([#1153](https://github.com/jackwener/opencli/issues/1153))
* **amazon** — fall back discussion to product page. ([#1154](https://github.com/jackwener/opencli/issues/1154))
* **sinafinance** — match stock symbol in addition to name. ([#1158](https://github.com/jackwener/opencli/issues/1158))

### Chores

* **extension** — restore pre-1.6.8 neon terminal icons. ([#1177](https://github.com/jackwener/opencli/issues/1177))

## [1.7.7](https://github.com/jackwener/opencli/compare/v1.7.6...v1.7.7) (2026-04-23)

### Features

* **51job** — comprehensive adapter: `search`, `hot`, `detail`, `company`. ([#1132](https://github.com/jackwener/opencli/issues/1132))
* **weread** — `ai-outline` command for AI-generated book outlines. ([#1141](https://github.com/jackwener/opencli/issues/1141))
* **web/download** — video/audio/iframe download + `--stdout` streaming. ([#1146](https://github.com/jackwener/opencli/issues/1146))
* **download** — hardened HTML→Markdown pipeline with better element handling. ([#1143](https://github.com/jackwener/opencli/issues/1143))
* **verify** — fixture-based value validation + skill docs for COOKIE pitfalls. ([#1131](https://github.com/jackwener/opencli/issues/1131))
* **agent-native retrospective** — analyze / verify guards / fixture content checks. ([#1133](https://github.com/jackwener/opencli/issues/1133))
* **twitter** — expose `has_media` and `media_urls` columns. ([#1115](https://github.com/jackwener/opencli/issues/1115))

### Bug Fixes

* **core** — quality audit fixes: elapsed=0 display, daemon error handler state reset, cause chain truncation guard, download cookie expiry, launcher async kill, verbose error logging. ([#1151](https://github.com/jackwener/opencli/issues/1151))
* **daemon** — allow extension ping CORS for reachability probing. ([#1150](https://github.com/jackwener/opencli/issues/1150))
* **deepseek** — separate thinking process from response in `--think` mode. ([#1142](https://github.com/jackwener/opencli/issues/1142))
* **deepseek** — use position-based model selection instead of text matching. ([#1123](https://github.com/jackwener/opencli/issues/1123))
* **weread/book** — add fallback selectors for reader page without cover. ([#1138](https://github.com/jackwener/opencli/issues/1138))
* **xiaoyuzhou** — correct podcast-episodes API endpoint. ([#1129](https://github.com/jackwener/opencli/issues/1129))
* **bilibili** — resolve full video URLs and preserve full description. ([#1118](https://github.com/jackwener/opencli/issues/1118))

### Docs

* Fix stale references in READMEs and autofix skill doc. ([#1130](https://github.com/jackwener/opencli/issues/1130))
* Restore and rewrite `opencli-usage` as orientation skill. ([#1128](https://github.com/jackwener/opencli/issues/1128))

## [1.7.6](https://github.com/jackwener/opencli/compare/v1.7.5...v1.7.6) (2026-04-21)

Extension bumped to 1.0.2 (body-truncation signal unified across raw / detail / fallback paths).

### Features

* **Window lifecycle flags** — `--live` (or `OPENCLI_LIVE=1`) keeps the automation window open after a command finishes; `--focus` (or `OPENCLI_WINDOW_FOCUSED=1`) brings the window to the foreground. Works on any subcommand. ([#1122](https://github.com/jackwener/opencli/issues/1122))
* **Selector-first browser interactions** — `find` / `get` / `click` / `type` / `select` accept CSS selectors in addition to numeric refs; `--nth` disambiguates multiple matches. ([#1112](https://github.com/jackwener/opencli/issues/1112))
* **Agent-native browser payload** — structured `network` bodies with truncation signal, `get html --as json` with `--depth` / `--children-max` / `--text-max` budgets, new `browser extract` command for long-form content with resume cursor. ([#1104](https://github.com/jackwener/opencli/issues/1104))
* **`network --filter <fields>`** — filter captured requests by body-shape path segments for quick API discovery. ([#1103](https://github.com/jackwener/opencli/issues/1103))
* **`get html --as json`** — structured HTML tree output; no more silent truncation on raw `--as html`. ([#1102](https://github.com/jackwener/opencli/issues/1102))
* **`browser network` rewrite** — agent-native discovery with cache keys and shape preview. ([#1100](https://github.com/jackwener/opencli/issues/1100))
* **Compound form fields** — date / select / file controls surface a `compound` envelope with format, options, `accept`. Cascading stale-ref recovery + bbox 0.99 dedup for tagged elements. ([#1116](https://github.com/jackwener/opencli/issues/1116))
* **twitter `tweets`** — fetch a user's recent posts. ([#1098](https://github.com/jackwener/opencli/issues/1098))
* **bilibili `video`** — new video command. ([#1110](https://github.com/jackwener/opencli/issues/1110))
* **deepseek `--file`** — file upload support on `ask`. ([#1093](https://github.com/jackwener/opencli/issues/1093))

### Bug Fixes

* **twitter** — 5s timeout on `resolveTwitterQueryId` to prevent hang. ([#1106](https://github.com/jackwener/opencli/issues/1106))
* **youtube** — fall back to Videos tab when Home has no videos. ([#1109](https://github.com/jackwener/opencli/issues/1109))
* **jianyu** — keep accessible detail urls in search. ([#1099](https://github.com/jackwener/opencli/issues/1099))
* **jianyu** — block inaccessible detail links and verification pages. ([#918](https://github.com/jackwener/opencli/issues/918))

### Docs

* **opencli-browser skill** — restored and upgraded for selector-first workflow. ([#1119](https://github.com/jackwener/opencli/issues/1119))
* **Window lifecycle** — sync README + skill docs with `--live` / `--focus` behavior. ([#1125](https://github.com/jackwener/opencli/issues/1125))

### Extension (1.0.2)

* Unify body-truncation contract across raw / detail / fallback network paths; surface `body_truncated` / `body_full_size` / `body_truncation_reason`. ([#1104](https://github.com/jackwener/opencli/issues/1104))

## [1.7.5](https://github.com/jackwener/opencli/compare/v1.7.4...v1.7.5) (2026-04-20)

Extension bumped to 1.0.1 (multi-tab routing + cross-origin iframe).

### Features

* **DeepSeek adapter** — browser-based `ask` / `history` / `new` / `read` / `status` ([#1088](https://github.com/jackwener/opencli/issues/1088))
* **Eastmoney adapters** — 13 finance adapters as Phase A oracle: `quote`, `rank`, `kline`, `sectors`, `etf`, `holders`, `money-flow`, `northbound`, `longhu`, `kuaixun`, `convertible`, `index-board`, `announcement` ([#1091](https://github.com/jackwener/opencli/issues/1091))
* **Twitter GraphQL lists** — `list-tweets`, `list-add`, `list-remove` ([#1076](https://github.com/jackwener/opencli/issues/1076))
* **nowcoder adapter** — 牛客网 with 16 commands ([#1036](https://github.com/jackwener/opencli/issues/1036))
* **Chinese academic & policy adapters** — `baidu-scholar`, `google-scholar`, `wanfang`, `gov-law`, `gov-policy` ([#243](https://github.com/jackwener/opencli/issues/243))
* **Download saved path** — `web read` and `weixin download` now show saved file location ([#1042](https://github.com/jackwener/opencli/issues/1042))
* **Cross-origin iframe support** — CDP execution context for iframed content ([#1084](https://github.com/jackwener/opencli/issues/1084))

### Improvements

* **Multi-tab routing** — hardened target isolation and tab routing ([#1072](https://github.com/jackwener/opencli/issues/1072))
* **Skill consolidation** — 6 skills merged into 3 (`opencli-adapter-author`, `opencli-autofix`, `smart-search`); removed mechanical commands `explore` / `synthesize` / `generate` / `cascade` / `record` ([#1094](https://github.com/jackwener/opencli/issues/1094))
* **Browser docs rewrite** — docs reoriented for AI Agent use case ([#1080](https://github.com/jackwener/opencli/issues/1080))
* **antigravity serve** — configurable timeout + auto-reconnect ([#859](https://github.com/jackwener/opencli/issues/859), [#1063](https://github.com/jackwener/opencli/issues/1063))
* **Design debt cleanup** — deprecated APIs, arg validation, dead plugin code ([#1065](https://github.com/jackwener/opencli/issues/1065))

### Bug Fixes

* **xiaoyuzhou** — migrate from broken SSR to authenticated API ([#1059](https://github.com/jackwener/opencli/issues/1059)); accept `CONFIG_ERROR` in E2E guard ([#1066](https://github.com/jackwener/opencli/issues/1066))
* **xiaohongshu** — detect draft save success ([#1060](https://github.com/jackwener/opencli/issues/1060)); verify title input sticks on publish ([#1050](https://github.com/jackwener/opencli/issues/1050))
* **twitter** — repair lists scraping from detail pages ([#1053](https://github.com/jackwener/opencli/issues/1053))
* **zsxq** — separate content from title, remove title truncation ([#1079](https://github.com/jackwener/opencli/issues/1079))
* **extension** — per-workspace idle timeout for browser sessions ([#1064](https://github.com/jackwener/opencli/issues/1064))

### Revert

* Undo output renderer table-formatting patch ([#1085](https://github.com/jackwener/opencli/issues/1085), reverts [#1081](https://github.com/jackwener/opencli/issues/1081))

### Extension (1.0.1)

* Multi-tab routing support ([#1072](https://github.com/jackwener/opencli/issues/1072))
* Cross-origin iframe CDP contexts ([#1084](https://github.com/jackwener/opencli/issues/1084))

## [1.7.0](https://github.com/jackwener/opencli/compare/v1.6.1...v1.7.0) (2026-04-11)

This is a major release with significant internal architecture changes.
Adapter code, validation, and error handling have been modernized.

### ⚠ BREAKING CHANGES

* **Node.js >= 21 required** — `import.meta.dirname` is used in core modules; Node 20 and below will fail at startup.
* **YAML adapters deprecated** — YAML-based `.yaml` adapters are no longer loaded. Existing YAML adapters must be converted to JS via `cli()` API. A deprecation warning is emitted if `.yaml` files are detected.
* **`.ts` adapters no longer loaded at runtime** — The runtime only discovers `.js` files. If you have `.ts` adapters in `~/.opencli/clis/`, compile them to `.js` or rewrite using plain JS. A warning is printed when `.ts` files without a matching `.js` are found.
* **Error output format changed** — All errors are now emitted as a structured YAML envelope to stderr. Scripts parsing stdout for `[{error, help}]` must switch to stderr / exit code. ([#923](https://github.com/jackwener/opencli/issues/923))
* **`tabId` replaced by `targetId`** — Cross-layer page identity now uses `targetId`. Extensions and plugins referencing `tabId` must update. ([#899](https://github.com/jackwener/opencli/issues/899))
* **`operate` renamed to `browser`** — All `opencli operate` commands are now `opencli browser`. ([#883](https://github.com/jackwener/opencli/issues/883))

### Features

* **auto-close adapter windows** — Browser tabs opened by adapters are automatically closed after execution; configurable via `OPENCLI_WINDOW_FOCUSED`. ([#915](https://github.com/jackwener/opencli/issues/915))
* **Self-Repair protocol** — Automatic adapter fixing when commands fail. ([#866](https://github.com/jackwener/opencli/issues/866))
* **EarlyHint callback** — Cost gating channel for generate pipeline. ([#882](https://github.com/jackwener/opencli/issues/882))
* **verified generate pipeline** — Structured contract for AI-driven adapter generation. ([#878](https://github.com/jackwener/opencli/issues/878))
* **structured diagnostic output** — AI-driven adapter repair gets structured diagnostics. ([#802](https://github.com/jackwener/opencli/issues/802))
* **auto-downgrade to YAML in non-TTY** — Machine-readable output when piped. ([#737](https://github.com/jackwener/opencli/issues/737))
* **Browser Use improvements** — Better click/type/state handling for browser automation. ([#707](https://github.com/jackwener/opencli/issues/707))
* **CDP session-level network capture** — Full network capture support for CDPPage. ([#815](https://github.com/jackwener/opencli/issues/815), [#816](https://github.com/jackwener/opencli/issues/816))
* **AutoResearch framework** — V2EX/Zhihu test suites (194 tasks). ([#731](https://github.com/jackwener/opencli/issues/731), [#717](https://github.com/jackwener/opencli/issues/717), [#741](https://github.com/jackwener/opencli/issues/741))
* **new adapters:** Gitee ([#845](https://github.com/jackwener/opencli/issues/845)), 闲鱼 ([#696](https://github.com/jackwener/opencli/issues/696)), 1688 ([#650](https://github.com/jackwener/opencli/issues/650), [#820](https://github.com/jackwener/opencli/issues/820)), LessWrong ([#773](https://github.com/jackwener/opencli/issues/773)), 虎扑 ([#751](https://github.com/jackwener/opencli/issues/751)), 小鹅通 ([#617](https://github.com/jackwener/opencli/issues/617)), 元宝 ([#693](https://github.com/jackwener/opencli/issues/693)), 即梦 ([#897](https://github.com/jackwener/opencli/issues/897), [#895](https://github.com/jackwener/opencli/issues/895)), Quark Drive ([#858](https://github.com/jackwener/opencli/issues/858)), GitHub Trending/Binance/Weather ([#214](https://github.com/jackwener/opencli/issues/214))
* **adapter enhancements:** Instagram post/reel/story/note ([#671](https://github.com/jackwener/opencli/issues/671)), Twitter image posts/replies ([#666](https://github.com/jackwener/opencli/issues/666), [#756](https://github.com/jackwener/opencli/issues/756)), 知乎 interactions ([#868](https://github.com/jackwener/opencli/issues/868)), Bilibili b23.tv short URL ([#740](https://github.com/jackwener/opencli/issues/740)), 雪球 kline/groups ([#809](https://github.com/jackwener/opencli/issues/809)), Amazon unified ranking ([#724](https://github.com/jackwener/opencli/issues/724)), Gemini deep-research ([#778](https://github.com/jackwener/opencli/issues/778)), 新浪财经热搜 ([#736](https://github.com/jackwener/opencli/issues/736)), linux-do topic split ([#821](https://github.com/jackwener/opencli/issues/821)), JD/淘宝/CNKI revived ([#248](https://github.com/jackwener/opencli/issues/248))

### Bug Fixes

* **security:** escape codegen strings and redact diagnostic body ([#930](https://github.com/jackwener/opencli/issues/930))
* **bilibili:** add missing domain for following cli ([#947](https://github.com/jackwener/opencli/issues/947))
* clean up stale `.ts` adapter files during upgrade ([#948](https://github.com/jackwener/opencli/issues/948))
* clean up legacy shim files and stale tmp files on upgrade ([#934](https://github.com/jackwener/opencli/issues/934))
* address deep review findings (security, correctness, consistency) ([#935](https://github.com/jackwener/opencli/issues/935))
* batch quality improvements — dedupe completion, unify logging, fix docs ([#945](https://github.com/jackwener/opencli/issues/945))
* graceful fallback when extension lacks network-capture support ([#865](https://github.com/jackwener/opencli/issues/865))
* handle missing electron executable gracefully ([#747](https://github.com/jackwener/opencli/issues/747))
* recover drifted tabs instead of abandoning them ([#715](https://github.com/jackwener/opencli/issues/715))
* retry on "No window with id" CDP error ([#892](https://github.com/jackwener/opencli/issues/892))
* **launcher:** graceful degradation and manual CDP override for Windows ([#744](https://github.com/jackwener/opencli/issues/744))
* **xiaohongshu:** scope note interaction selectors, replace blind retry with MutationObserver ([#839](https://github.com/jackwener/opencli/issues/839), [#730](https://github.com/jackwener/opencli/issues/730))
* **twitter:** relax reply composer timeout, use composer for text replies ([#862](https://github.com/jackwener/opencli/issues/862), [#860](https://github.com/jackwener/opencli/issues/860))
* **doubao:** preserve image URLs, connect to correct CDP target ([#708](https://github.com/jackwener/opencli/issues/708), [#674](https://github.com/jackwener/opencli/issues/674))
* **gemini:** stabilize ask reply state handling ([#735](https://github.com/jackwener/opencli/issues/735))
* **douban:** fix marks pagination and improve subject data extraction ([#752](https://github.com/jackwener/opencli/issues/752))
* **jianyu:** avoid early API bucket cutoff, stabilize search ([#916](https://github.com/jackwener/opencli/issues/916), [#912](https://github.com/jackwener/opencli/issues/912))
* **xiaoe:** resolve missing episodes for long courses via auto-scroll ([#904](https://github.com/jackwener/opencli/issues/904))

### Refactoring

* **adapters:** convert adapter layer from TypeScript to JavaScript ([#928](https://github.com/jackwener/opencli/issues/928))
* **adapters:** migrate all CLI adapters from YAML to TypeScript, then to JS ([#887](https://github.com/jackwener/opencli/issues/887), [#922](https://github.com/jackwener/opencli/issues/922))
* **validate:** switch from YAML-file scanning to registry-based validation ([#943](https://github.com/jackwener/opencli/issues/943))
* **strategy:** normalize strategy into runtime fields at registration time ([#941](https://github.com/jackwener/opencli/issues/941))
* **errors:** unify error output as YAML envelope to stderr ([#923](https://github.com/jackwener/opencli/issues/923))
* **daemon:** make daemon persistent, remove idle timeout ([#913](https://github.com/jackwener/opencli/issues/913))
* **browser:** unify browser error classification and deduplicate retry logic ([#908](https://github.com/jackwener/opencli/issues/908))
* **monorepo:** adapter separation — `clis/` at root ([#782](https://github.com/jackwener/opencli/issues/782))
* rename `operate` to `browser` ([#883](https://github.com/jackwener/opencli/issues/883))
* eliminate `any` types in core files ([#886](https://github.com/jackwener/opencli/issues/886))
* migrate adapter imports to package exports ([#795](https://github.com/jackwener/opencli/issues/795))

### Performance

* **P0 optimizations** — faster startup, reduced overhead ([#944](https://github.com/jackwener/opencli/issues/944))
* fast-path completion/version/shell-scripts to bypass full discovery ([#898](https://github.com/jackwener/opencli/issues/898))
* optimize browser pipeline — tab query dedup, parallel stealth, incremental snapshots ([#713](https://github.com/jackwener/opencli/issues/713))
* reduce round-trips in browser command hot path ([#712](https://github.com/jackwener/opencli/issues/712))
* skip blank page on first browser command ([#710](https://github.com/jackwener/opencli/issues/710))

### Documentation

* restructure README narrative ([#885](https://github.com/jackwener/opencli/issues/885))
* add Android Chrome usage guide ([#687](https://github.com/jackwener/opencli/issues/687))
* add Electron app CLI quickstart guide
* fix stale `.ts` references across skills and docs ([#954](https://github.com/jackwener/opencli/issues/954))
* unify skill command references and merge opencli-generate into opencli-explorer ([#891](https://github.com/jackwener/opencli/issues/891), [#894](https://github.com/jackwener/opencli/issues/894))

### Upgrade Guide

1. **Update Node.js** to v21 or later (v22 LTS recommended).
2. **Run `npm install -g @jackwener/opencli@latest`** — the preuninstall hook gracefully stops the old daemon; the first browser command after upgrade auto-restarts it.
3. **If you have custom `.ts` adapters** in `~/.opencli/clis/`, rename or compile them to `.js`. A warning will be printed on startup if stale `.ts` files are detected.
4. **If you have custom `.yaml` adapters**, convert them to JS using the `cli()` API (see `skills/opencli-adapter-author/references/adapter-template.md`).
5. **If you parse error output from stdout**, switch to stderr. Errors are now structured YAML envelopes with typed exit codes.


## [1.6.1](https://github.com/jackwener/opencli/compare/v1.6.0...v1.6.1) (2026-04-02)


### Bug Fixes

* sync package-lock.json version with package.json ([#698](https://github.com/jackwener/opencli/issues/698))


## [1.6.0](https://github.com/jackwener/opencli/compare/v1.5.9...v1.6.0) (2026-04-02)


### Features

* **opencli-browser:** add browser control commands for Claude Code skill ([#614](https://github.com/jackwener/opencli/issues/614))
* **docs:** add tab completion to getting started guides ([#658](https://github.com/jackwener/opencli/issues/658))


### Bug Fixes

* **twitter:** resolve article ID to tweet ID before GraphQL query ([#688](https://github.com/jackwener/opencli/issues/688))
* **xiaohongshu:** clarify empty note shell hint ([#686](https://github.com/jackwener/opencli/issues/686))
* **skills:** add YAML frontmatter for discovery and improve descriptions ([#694](https://github.com/jackwener/opencli/issues/694))


### Refactoring

* centralize daemon transport client ([#692](https://github.com/jackwener/opencli/issues/692))


## [1.5.9](https://github.com/jackwener/opencli/compare/v1.5.8...v1.5.9) (2026-04-02)


### Features

* **amazon:** add browser adapter — bestsellers, search, product, offer, discussion ([#659](https://github.com/jackwener/opencli/issues/659))
* **skills:** create skills/ directory structure with opencli-usage, opencli-explorer, opencli-oneshot ([#670](https://github.com/jackwener/opencli/issues/670))
* **record:** add minimal record write candidates ([#665](https://github.com/jackwener/opencli/issues/665))


### Refactoring

* src cleanup — deduplicate errors, cache VM, extract BasePage, remove Playwright MCP legacy ([#667](https://github.com/jackwener/opencli/issues/667))
* remove bind-current, restore owned-only browser automation model ([#664](https://github.com/jackwener/opencli/issues/664))


### Chores

* remove .agents directory ([#668](https://github.com/jackwener/opencli/issues/668))


## [1.5.8](https://github.com/jackwener/opencli/compare/v1.5.7...v1.5.8) (2026-04-01)


### Bug Fixes

* **extension:** avoid mutating healthy tabs before debugger attach and add regression coverage ([#662](https://github.com/jackwener/opencli/issues/662))


## [1.5.7](https://github.com/jackwener/opencli/compare/v1.5.6...v1.5.7) (2026-04-01)


### Features

* **daemon:** replace 5min idle timeout with long-lived daemon model (4h default, dual-condition exit) ([#641](https://github.com/jackwener/opencli/issues/641))
* **daemon:** add `opencli daemon status/stop/restart` CLI commands ([#641](https://github.com/jackwener/opencli/issues/641))
* **youtube:** add search filters — `--type` shorts/video/channel, `--upload`, `--sort` ([#616](https://github.com/jackwener/opencli/issues/616))
* **notebooklm:** add read commands and compatibility layer ([#622](https://github.com/jackwener/opencli/issues/622))
* **instagram:** add media download command ([#623](https://github.com/jackwener/opencli/issues/623))
* **stealth:** harden CDP debugger detection countermeasures ([#644](https://github.com/jackwener/opencli/issues/644))
* **v2ex:** add id, node, url, content, member fields to topic output ([#646](https://github.com/jackwener/opencli/issues/646), [#648](https://github.com/jackwener/opencli/issues/648))
* **electron:** auto-launcher — zero-config CDP connection ([#653](https://github.com/jackwener/opencli/issues/653))


### Bug Fixes

* **douyin:** repair creator draft flow — switch from broken API pipeline to UI-driven approach ([#640](https://github.com/jackwener/opencli/issues/640))
* **douyin:** support current creator API response shapes for activities, profile, collections, hashtag, videos ([#618](https://github.com/jackwener/opencli/issues/618))
* **bilibili:** distinguish login-gated subtitles from empty results ([#645](https://github.com/jackwener/opencli/issues/645))
* **facebook:** avoid in-page redirect in search — use navigate step instead of window.location.href ([#642](https://github.com/jackwener/opencli/issues/642))
* **substack:** update selectors for DOM redesign ([#624](https://github.com/jackwener/opencli/issues/624))
* **weread:** recover book details from cached shelf fallback ([#628](https://github.com/jackwener/opencli/issues/628))
* **docs:** use relative links in adapter index ([#629](https://github.com/jackwener/opencli/issues/629))


## [1.4.1](https://github.com/jackwener/opencli/compare/v1.4.0...v1.4.1) (2026-03-25)


### Features

* **douyin:** add Douyin creator center adapter — 14 commands, 8-phase publish pipeline ([#416](https://github.com/jackwener/opencli/issues/416))
* **weibo,youtube:** add Weibo commands and YouTube channel/comments ([#418](https://github.com/jackwener/opencli/issues/418))
* **twitter:** add filter option for search ([#410](https://github.com/jackwener/opencli/issues/410))
* **extension:** add popup UI, privacy policy, and CSP for Chrome Web Store ([#415](https://github.com/jackwener/opencli/issues/415))
* add url field to 9 search adapters (67% -> 97% coverage) ([#414](https://github.com/jackwener/opencli/issues/414))


### Bug Fixes

* **extension:** improve UX when daemon is not running — show hint in popup, reduce reconnect noise ([#424](https://github.com/jackwener/opencli/issues/424))
* remove incorrect gws and readwise external CLI entries ([#419](https://github.com/jackwener/opencli/issues/419), [#420](https://github.com/jackwener/opencli/issues/420))


### CI

* limit default e2e to bilibili/zhihu/v2ex, gate extended browser tests ([#421](https://github.com/jackwener/opencli/issues/421), [#423](https://github.com/jackwener/opencli/issues/423))


## [1.4.0](https://github.com/jackwener/opencli/compare/v1.3.3...v1.4.0) (2026-03-25)


### Features

* **pixiv:** add Pixiv adapter — ranking, search, user illusts, detail, download ([#403](https://github.com/jackwener/opencli/issues/403))
* **plugin:** add lifecycle hooks API — onStartup, onBeforeExecute, onAfterExecute ([#376](https://github.com/jackwener/opencli/issues/376))
* **plugin:** validate plugin structure on install and update ([#364](https://github.com/jackwener/opencli/issues/364))
* **xueqiu:** add Danjuan fund account commands — fund-holdings, fund-snapshot ([#391](https://github.com/jackwener/opencli/issues/391))
* **tiktok:** add video URL to search results ([#404](https://github.com/jackwener/opencli/issues/404))
* **linkedin:** add timeline feed command ([#342](https://github.com/jackwener/opencli/issues/342))
* **jd:** add JD.com product details adapter ([#344](https://github.com/jackwener/opencli/issues/344))
* **web:** add generic `web read` command for any URL → Markdown ([#343](https://github.com/jackwener/opencli/issues/343))
* **dictionary:** add dictionary search, synonyms, and examples adapters ([#241](https://github.com/jackwener/opencli/issues/241))


### Bug Fixes

* **analysis:** fix hasLimit using wrong Set (SEARCH_PARAMS → LIMIT_PARAMS) ([#412](https://github.com/jackwener/opencli/issues/412))
* **pipeline:** remove phantom scroll step — declared but never registered ([#412](https://github.com/jackwener/opencli/issues/412))
* **validate:** add missing download step to KNOWN_STEP_NAMES ([#412](https://github.com/jackwener/opencli/issues/412))
* **extension:** security hardening — tab isolation, URL validation, cookie scope ([#409](https://github.com/jackwener/opencli/issues/409))
* **sort:** use localeCompare with natural numeric sort by default ([#306](https://github.com/jackwener/opencli/issues/306))
* **pipeline:** evaluate chained || in template engine ([#305](https://github.com/jackwener/opencli/issues/305))
* **pipeline:** check HTTP status in fetch step ([#384](https://github.com/jackwener/opencli/issues/384))
* **plugin:** resolve Windows path and symlink issues ([#400](https://github.com/jackwener/opencli/issues/400))
* **download:** scope cookies to target domain ([#385](https://github.com/jackwener/opencli/issues/385))
* **extension:** fix same-url navigation timeout ([#380](https://github.com/jackwener/opencli/issues/380))
* fix ChatWise Windows connect ([#405](https://github.com/jackwener/opencli/issues/405))
* resolve 6 critical + 11 important bugs from deep code review ([#337](https://github.com/jackwener/opencli/issues/337), [#340](https://github.com/jackwener/opencli/issues/340))
* harden security-sensitive execution paths ([#335](https://github.com/jackwener/opencli/issues/335))
* **stealth:** harden anti-detection against advanced fingerprinting ([#357](https://github.com/jackwener/opencli/issues/357))


### Code Quality

* replace all `catch (err: any)` with typed `getErrorMessage()` across 13 files ([#412](https://github.com/jackwener/opencli/issues/412))
* adopt CliError subclasses in social and desktop adapters ([#367](https://github.com/jackwener/opencli/issues/367), [#372](https://github.com/jackwener/opencli/issues/372), [#375](https://github.com/jackwener/opencli/issues/375))
* simplify codebase with type dedup, shared analysis module, and consistent naming ([#373](https://github.com/jackwener/opencli/issues/373))
* **ci:** add cross-platform CI matrix (Linux/macOS/Windows) ([#402](https://github.com/jackwener/opencli/issues/402))


## [1.3.3](https://github.com/jackwener/opencli/compare/v1.3.2...v1.3.3) (2026-03-25)


### Features

* **browser:** add stealth anti-detection for CDP and daemon modes ([#319](https://github.com/jackwener/opencli/issues/319))


### Bug Fixes

* **stealth:** review fixes — guard plugins, rewrite stack trace cleanup ([#320](https://github.com/jackwener/opencli/issues/320))


## [1.3.2](https://github.com/jackwener/opencli/compare/v1.3.1...v1.3.2) (2026-03-24)


### Features

* **error-handling:** refine error handling with semantic error types and emoji-coded output ([#312](https://github.com/jackwener/opencli/issues/312)) ([b4d64ca](https://github.com/jackwener/opencli/commit/b4d64ca))


### Bug Fixes

* **security:** replace execSync with execFileSync to prevent command injection ([#309](https://github.com/jackwener/opencli/issues/309)) ([41aedf6](https://github.com/jackwener/opencli/commit/41aedf6))
* remove duplicate getErrorMessage import in discovery.ts ([#315](https://github.com/jackwener/opencli/issues/315)) ([75f4237](https://github.com/jackwener/opencli/commit/75f4237))
* **e2e:** broaden xiaoyuzhou skip logic for overseas CI runners ([#316](https://github.com/jackwener/opencli/issues/316)) ([a170873](https://github.com/jackwener/opencli/commit/a170873))


### Documentation

* **SKILL.md:** sync command reference — add missing sites and desktop adapters ([#314](https://github.com/jackwener/opencli/issues/314)) ([8bf750c](https://github.com/jackwener/opencli/commit/8bf750c))


### Chores

* pre-release cleanup — fix dependencies, sync docs, reduce code duplication ([#311](https://github.com/jackwener/opencli/issues/311)) ([c9b3568](https://github.com/jackwener/opencli/commit/c9b3568))


## [1.3.1](https://github.com/jackwener/opencli/compare/v1.3.0...v1.3.1) (2026-03-22)


### Features

* **plugin:** add update command, hot reload after install, README section ([#307](https://github.com/jackwener/opencli/issues/307)) ([966f6e5](https://github.com/jackwener/opencli/commit/966f6e5))
* **yollomi:** add new commands and update documentation ([#235](https://github.com/jackwener/opencli/issues/235)) ([ea83242](https://github.com/jackwener/opencli/commit/ea83242))
* **record:** add live recording command for API capture ([#300](https://github.com/jackwener/opencli/issues/300)) ([dff0fe5](https://github.com/jackwener/opencli/commit/dff0fe5))
* **weibo:** add weibo search command ([#299](https://github.com/jackwener/opencli/issues/299)) ([c7895ea](https://github.com/jackwener/opencli/commit/c7895ea))
* **v2ex:** add node, user, member, replies, nodes commands ([#282](https://github.com/jackwener/opencli/issues/282)) ([a83027d](https://github.com/jackwener/opencli/commit/a83027d))
* **hackernews:** add new, best, ask, show, jobs, search, user commands ([#290](https://github.com/jackwener/opencli/issues/290)) ([127a974](https://github.com/jackwener/opencli/commit/127a974))
* **doubao-app:** add Doubao AI desktop app CLI adapter ([#289](https://github.com/jackwener/opencli/issues/289)) ([66c4b84](https://github.com/jackwener/opencli/commit/66c4b84))
* **doubao:** add doubao browser adapter ([#277](https://github.com/jackwener/opencli/issues/277)) ([9cdc127](https://github.com/jackwener/opencli/commit/9cdc127))
* **xiaohongshu:** add publish command for 图文 note automation ([#276](https://github.com/jackwener/opencli/issues/276)) ([a6d993f](https://github.com/jackwener/opencli/commit/a6d993f))
* **weixin:** add weixin article download adapter & abstract download helpers ([#280](https://github.com/jackwener/opencli/issues/280)) ([b7c6c02](https://github.com/jackwener/opencli/commit/b7c6c02))


### Bug Fixes

* **tests:** use positional arg syntax in browser search tests ([#302](https://github.com/jackwener/opencli/issues/302)) ([4343ec0](https://github.com/jackwener/opencli/commit/4343ec0))
* **xiaohongshu:** improve search login-wall handling and detail output ([#298](https://github.com/jackwener/opencli/issues/298)) ([f8bf663](https://github.com/jackwener/opencli/commit/f8bf663))
* ensure standard PATH is available for external CLIs ([#285](https://github.com/jackwener/opencli/issues/285)) ([22f5c7a](https://github.com/jackwener/opencli/commit/22f5c7a))
* **xiaohongshu:** scope image selector to avoid downloading avatars ([#293](https://github.com/jackwener/opencli/issues/293)) ([3a21be6](https://github.com/jackwener/opencli/commit/3a21be6))
* add turndown dependency to package.json ([#288](https://github.com/jackwener/opencli/issues/288)) ([2a52906](https://github.com/jackwener/opencli/commit/2a52906))


## [1.3.0](https://github.com/jackwener/opencli/compare/v1.2.3...v1.3.0) (2026-03-21)


### Features

* **daemon:** harden security against browser CSRF attacks ([#268](https://github.com/jackwener/opencli/issues/268)) ([40bd11d](https://github.com/jackwener/opencli/commit/40bd11d))


### Performance

* smart page settle via DOM stability detection ([#271](https://github.com/jackwener/opencli/issues/271)) ([4b976da](https://github.com/jackwener/opencli/commit/4b976da))


### Refactoring

* doctor defaults to live mode, remove setup command entirely ([#263](https://github.com/jackwener/opencli/issues/263)) ([b4a8089](https://github.com/jackwener/opencli/commit/b4a8089))


## [1.2.3](https://github.com/jackwener/opencli/compare/v1.2.2...v1.2.3) (2026-03-21)


### Bug Fixes

* replace all about:blank with data: URI to prevent New Tab Override interception ([#257](https://github.com/jackwener/opencli/issues/257)) ([3e91876](https://github.com/jackwener/opencli/commit/3e91876))
* harden resolveTabId against New Tab Override extension interception ([#255](https://github.com/jackwener/opencli/issues/255)) ([112fdef](https://github.com/jackwener/opencli/commit/112fdef))


## [1.2.2](https://github.com/jackwener/opencli/compare/v1.2.1...v1.2.2) (2026-03-21)


### Bug Fixes

* harden browser automation pipeline (resolves [#249](https://github.com/jackwener/opencli/issues/249)) ([#251](https://github.com/jackwener/opencli/issues/251)) ([71b2c39](https://github.com/jackwener/opencli/commit/71b2c39))


## [1.2.1](https://github.com/jackwener/opencli/compare/v1.2.0...v1.2.1) (2026-03-21)


### Bug Fixes

* **twitter:** harden timeline review findings ([#236](https://github.com/jackwener/opencli/issues/236)) ([4cd0409](https://github.com/jackwener/opencli/commit/4cd0409))
* **wikipedia:** fix search arg name + add random and trending commands ([#231](https://github.com/jackwener/opencli/issues/231)) ([1d56dd7](https://github.com/jackwener/opencli/commit/1d56dd7))
* resolve inconsistent doctor --live report (fix [#121](https://github.com/jackwener/opencli/issues/121)) ([#224](https://github.com/jackwener/opencli/issues/224)) ([387aa0d](https://github.com/jackwener/opencli/commit/387aa0d))


## [1.2.0](https://github.com/jackwener/opencli/compare/v1.1.0...v1.2.0) (2026-03-21)


### Features

* **douban:** add movie adapter with search, top250, subject, marks, reviews commands ([#239](https://github.com/jackwener/opencli/issues/239)) ([70651d3](https://github.com/jackwener/opencli/commit/70651d3))
* **devto:** add devto adapter ([#234](https://github.com/jackwener/opencli/issues/234)) ([ea113a6](https://github.com/jackwener/opencli/commit/ea113a6))
* **twitter:** add --type flag to timeline command ([#83](https://github.com/jackwener/opencli/issues/83)) ([e98cf75](https://github.com/jackwener/opencli/commit/e98cf75))
* **google:** add search, suggest, news, and trends adapters ([#184](https://github.com/jackwener/opencli/issues/184)) ([4e32599](https://github.com/jackwener/opencli/commit/4e32599))
* add douban, sinablog, substack adapters; upgrade medium to TS ([#185](https://github.com/jackwener/opencli/issues/185)) ([bdf5967](https://github.com/jackwener/opencli/commit/bdf5967))
* **xueqiu:** add earnings-date command ([#211](https://github.com/jackwener/opencli/issues/211)) ([fae1dce](https://github.com/jackwener/opencli/commit/fae1dce))
* **browser:** advanced DOM snapshot engine with 13-layer pruning pipeline ([#210](https://github.com/jackwener/opencli/issues/210)) ([d831b04](https://github.com/jackwener/opencli/commit/d831b04))
* **instagram,facebook:** add write actions and extended commands ([#201](https://github.com/jackwener/opencli/issues/201)) ([eb0ccaf](https://github.com/jackwener/opencli/commit/eb0ccaf))
* **grok:** add opt-in --web flow for grok ask ([#193](https://github.com/jackwener/opencli/issues/193)) ([fcff2e4](https://github.com/jackwener/opencli/commit/fcff2e4))
* **tiktok:** add TikTok adapter with 15 commands ([#202](https://github.com/jackwener/opencli/issues/202)) ([4391ccf](https://github.com/jackwener/opencli/commit/4391ccf))
* add Lobste.rs, Instagram, and Facebook adapters ([#199](https://github.com/jackwener/opencli/issues/199)) ([ce484c2](https://github.com/jackwener/opencli/commit/ce484c2))
* **medium:** add medium adapter ([#190](https://github.com/jackwener/opencli/issues/190)) ([06c902a](https://github.com/jackwener/opencli/commit/06c902a))
* plugin system (Stage 0-2) ([1d39295](https://github.com/jackwener/opencli/commit/1d39295))
* make primary args positional across all CLIs ([#242](https://github.com/jackwener/opencli/issues/242)) ([9696db9](https://github.com/jackwener/opencli/commit/9696db9))
* **xueqiu:** make primary args positional ([#213](https://github.com/jackwener/opencli/issues/213)) ([fb2a145](https://github.com/jackwener/opencli/commit/fb2a145))


### Refactoring

* replace hardcoded skipPreNav with declarative navigateBefore field ([#208](https://github.com/jackwener/opencli/issues/208)) ([a228758](https://github.com/jackwener/opencli/commit/a228758))
* **boss:** extract common.ts utilities, fix missing login detection ([#200](https://github.com/jackwener/opencli/issues/200)) ([ae30763](https://github.com/jackwener/opencli/commit/ae30763))
* type discovery core ([#219](https://github.com/jackwener/opencli/issues/219)) ([bd274ce](https://github.com/jackwener/opencli/commit/bd274ce))
* type browser core ([#218](https://github.com/jackwener/opencli/issues/218)) ([28c393e](https://github.com/jackwener/opencli/commit/28c393e))
* type pipeline core ([#217](https://github.com/jackwener/opencli/issues/217)) ([8a4ea41](https://github.com/jackwener/opencli/commit/8a4ea41))
* reduce core any usage ([#216](https://github.com/jackwener/opencli/issues/216)) ([45cee57](https://github.com/jackwener/opencli/commit/45cee57))
* fail fast on invalid pipeline steps ([#237](https://github.com/jackwener/opencli/issues/237)) ([c76f86c](https://github.com/jackwener/opencli/commit/c76f86c))

## [1.1.0](https://github.com/jackwener/opencli/compare/v1.0.6...v1.1.0) (2026-03-20)


### Features

* add antigravity serve command — Anthropic API proxy ([35a0fed](https://github.com/jackwener/opencli/commit/35a0fed8a0c1cb714298f672c19f017bbc9a9630))
* add arxiv and wikipedia adapters ([#132](https://github.com/jackwener/opencli/issues/132)) ([3cda14a](https://github.com/jackwener/opencli/commit/3cda14a2ab502e3bebfba6cdd9842c35b2b66b41))
* add external CLI hub for discovery, auto-installation, and execution of external tools. ([b3e32d8](https://github.com/jackwener/opencli/commit/b3e32d8a05744c9bcdfef96f5ff3085ac72bd353))
* add sinafinance 7x24 news adapter ([#131](https://github.com/jackwener/opencli/issues/131)) ([02793e9](https://github.com/jackwener/opencli/commit/02793e990ef4bdfdde9d7a748960b8a9ed6ea988))
* **boss:** add 8 new recruitment management commands ([#133](https://github.com/jackwener/opencli/issues/133)) ([7e973ca](https://github.com/jackwener/opencli/commit/7e973ca59270029f33021a483ca4974dc3975d36))
* **serve:** implement auto new conv, model mapping, and precise completion detection ([0e8c96b](https://github.com/jackwener/opencli/commit/0e8c96b6d9baebad5deb90b9e0620af5570b259d))
* **serve:** use CDP mouse click + Input.insertText for reliable message injection ([c63af6d](https://github.com/jackwener/opencli/commit/c63af6d41808dddf6f0f76789aa6c042f391f0b0))
* xiaohongshu creator flows migration ([#124](https://github.com/jackwener/opencli/issues/124)) ([8f17259](https://github.com/jackwener/opencli/commit/8f1725982ec06d121d7c15b5cf3cda2f5941c32a))


### Bug Fixes

* **docs:** use base '/' for custom domain and add CNAME file ([#129](https://github.com/jackwener/opencli/issues/129)) ([2876750](https://github.com/jackwener/opencli/commit/2876750891bc8a66be577b06ead4db61852c8e81))
* **serve:** update model mappings to match actual Antigravity UI ([36bc57a](https://github.com/jackwener/opencli/commit/36bc57a9624cdfaa50ffb2c1ad7f9c518c5e6c55))
* type safety for wikiFetch and arxiv abstract truncation ([4600b9d](https://github.com/jackwener/opencli/commit/4600b9d46dc7b56ff564c5f100c3a94c6a792c06))
* use UTC+8 for XHS timestamp formatting (CI timezone fix) ([03f067d](https://github.com/jackwener/opencli/commit/03f067d90764487f0439705df36e1a5c969a7f98))
* **xiaohongshu:** use fixed UTC+8 offset in trend timestamp formatting (CI timezone fix) ([593436e](https://github.com/jackwener/opencli/commit/593436e4cb5852f396fbaaa9f87ef1a0b518e76d))

## [1.0.6](https://github.com/jackwener/opencli/compare/v1.0.5...v1.0.6) (2026-03-20)


### Bug Fixes

* use %20 instead of + for spaces in Bilibili WBI signed requests ([#126](https://github.com/jackwener/opencli/issues/126)) ([4cabca1](https://github.com/jackwener/opencli/commit/4cabca12dfa6ca027b938b80ee6b940b5e89ea5c)), closes [#125](https://github.com/jackwener/opencli/issues/125)
