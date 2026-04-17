# Changelog

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
4. **If you have custom `.yaml` adapters**, convert them to JS using the `cli()` API (see `skills/opencli-explorer/references/adapter-templates.md`).
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
