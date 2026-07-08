---
schema_version: 1.1
last_verified: 2026-06-02
source: global
---

> **Scope**：本文件只列 **task-executing agent** 跑 sitemap workflow 时会撞的坑。adapter-author 实现层的坑（pinned_tweet TimelinePinEntry 跳过 / `unwrapBrowserResult` envelope / bigint id 精度 / queryId bundle 解析）放在 `~/.opencli/sites/twitter/notes.md`，与本文件互补。

## Site-specific pitfalls

### pitfall:login_wall_on_most_routes

- trigger: 未登录访问 `/home / /notifications / /i/bookmarks / /<handle>/followers` 等
- symptom: redirect 到 `/i/flow/login`，URL 含 `flow/login`
- workaround: 跑 workflow / adapter 前 `opencli browser state` 看 URL；命中 `/i/flow/login` 抛 AuthRequired，不要尝试 click 登录（cookie 应预先注入 via `Strategy.COOKIE`）
- verified_at: 2026-06-02

### pitfall:wrong_dom_when_ua_mobile

- trigger: 我的 browser session 用了 mobile UA（含 `Mobile|iPhone|Android`）
- symptom: 落地 `mobile.twitter.com`，sitemap 描述的 selector / a11y 全错
- workaround: opencli browser 默认桌面 UA，自定义时不要带 mobile 关键字；命中 mobile DOM 时切回默认 UA 再 retry
- verified_at: 2026-06-02

### pitfall:adapter_returns_empty_after_api_drift

- trigger: 走 workflow Best path 跑 adapter，adapter 抛 EmptyResultError / 返 `data:{}` 空 / 抛 typed error
- symptom: 任务"应该有数据"但 adapter 没数据；或 adapter 抛 `queryId expired` 类内部错
- workaround: 把 workflow `adapter_health` 标 `suspect`，走 Fallback path (browser DOM)。endpoint 修是 adapter-author 的事，task agent 不要去解 queryId / 改 endpoint code
- verified_at: 2026-06-02
- notes: 实现层根因是 GraphQL queryId rotation（step 3 数据：twitter COOKIE_API adapter 30 天 9 fixes，主因即此），但 task agent 不需要知道这层，只需"切 Fallback"。internal-unstable contract 的代表 pitfall，PoC v1 workflows 的 Fallback path 全部预留 browser DOM 兜底

### pitfall:reply_silent_fails_on_rich_content

- trigger: 我的 reply 内容含多段 / bullet list / 反引号 / `→` arrow / `<url>` 角括号占位
- symptom: silent `Could not verify reply text in the composer`，同内容用 post composer 能通
- workaround: 单段纯文字 / `/` 替代 bullet / "any URL" 替代 `<url>` 占位 / 500 char + 链接收尾；多段长 reply 改走 post + quote
- verified_at: 2026-05-15

### pitfall:rtl_text_breaks_compose_verify

- trigger: 我要发 / 回复包含 RTL 文字（阿拉伯 / 希伯来 / 波斯）的内容
- symptom: caret 跳行首 / verify text 失败 / submit button 不 enable
- workaround: 分段输入 + 每段后 200ms wait + verify 多次 retry
- verified_at: 2026-05-15

### pitfall:button_not_found_in_non_english_locale

- trigger: 我的 session locale 非 English，sitemap 写 `text: "Post"` 类 visible text selector
- symptom: button_not_found，但页面上确实有等价按钮
- workaround: 改用 a11y role + `data-testid`。Twitter 内部 testid (`tweetButtonInline` / `reply` / `like` / `bookmark`) 跨 locale 稳定
- verified_at: 2026-06-02
