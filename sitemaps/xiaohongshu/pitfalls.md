---
schema_version: 1.1
last_verified: 2026-06-04
source: global
---

> **Scope**：本文件只列 **task-executing agent** 跑 sitemap workflow 时会撞的坑。adapter-author 实现层的坑（Pinia store SSR vs XHR 形状差异 / creator-center shadow-DOM publish button / `xsec_token` signed URL 起源）放在 `~/.opencli/sites/xiaohongshu/notes.md`，与本文件互补。

## Site-specific pitfalls

### pitfall:login_wall_on_most_routes

- trigger: 未登录访问 `/` `/explore` `/search_result/...` `/user/profile/<id>` `/notifications` 等几乎全部 route
- symptom: 页面文案 `登录后查看搜索结果` / `请登录` / redirect 到 `/login`，或 search adapter 抛 `AuthRequiredError`
- workaround: 跑 workflow / adapter 前先 `opencli xiaohongshu whoami` 验登录态（# pending: login command MVP, codex task #276）；未登录 → `opencli xiaohongshu login`；不要尝试自动填用户名密码（CAPTCHA / 短信 2FA / 滑块 全踩，"human authenticates, machine verifies"）
- verified_at: 2026-06-04

### pitfall:note_url_requires_xsec_token

- trigger: agent 手拼 `/explore/<note_id>` 裸路径，没带 `xsec_token` query
- symptom: 页面 403 / `error_code=300017` / `error_code=300031` / `website-login/error` redirect
- workaround: note URL 必须来自 feed / search / user adapter 输出，那些 adapter 已经把 signed URL 完整带出；不要自己从 note_id 重建 URL；如果只有 note_id，先跑 `opencli xiaohongshu search` / `feed` 拿到 signed URL 再 drill down
- verified_at: 2026-06-04

### pitfall:search_api_returns_empty

- trigger: 走 workflow Best path `opencli xiaohongshu search`，adapter 返 0 行或 EmptyResultError
- symptom: 关键词在网页搜得到结果但 adapter 输出空，或抛 typed error
- workaround: 把 workflow `adapter_health` 标 `suspect`，走 Fallback (browser DOM scrape on `/search_result/?keyword=...`)。根因是 `/api/sns/web/v1/search/notes` 返 `items:[]`（issue #10），adapter 已切 DOM scrape，但 DOM 也可能因 `section.note-item` class 漂动产生（PR #1507 兜底过一层）；task agent 不需要解 API 漂移，只需切 DOM Fallback
- verified_at: 2026-06-04

### pitfall:creator_center_is_different_host

- trigger: agent 想发笔记，停留在 `www.xiaohongshu.com` 上找发布入口
- symptom: 主站没有完整的发布入口（顶 nav 的"发布"按钮跳到 `creator.xiaohongshu.com/publish/publish?from=menu_left&target=image`），手 click 容易撞 popup / iframe / sso refresh 链
- workaround: 发笔记直接 `opencli xiaohongshu publish ...`，adapter 内部走 creator host；如果 fallback 需手操，先 `goto creator.xiaohongshu.com/publish/publish?from=menu_left&target=image` 再操作
- verified_at: 2026-06-04

### pitfall:publish_button_shadow_dom

- trigger: agent fallback 手 click creator center 的"发布"按钮 `<xhs-publish-btn>`
- symptom: 看似 click 成功但表单不提交，dev tools 看 host element `.click()` 没触发内部 handler
- workaround: 不要手 click；`opencli xiaohongshu publish` adapter 已用 instance method invocation (`_onPublish` / `onPublish` / `_onSubmit` / `_handlePublish`) 兜底（#1606）；如果 adapter broken 必须手动，用 `opencli browser evaluate` 调实例方法而不是 click
- verified_at: 2026-06-04

### pitfall:security_block_on_repeated_access

- trigger: 短时间高频访问同一 note URL / 高频 search
- symptom: 页面文案 `安全限制` / `访问链接异常`，URL 含 `website-login/error` 或 `error_code=300017|300031`
- workaround: 触发后 60s 内不重试同 URL；workflow 内用 1-2s wait 隔开连续请求；如果 sticky，换 session（清 cookie 重 login → 但这种已经超出 task agent 范围，应停手报给 user）
- verified_at: 2026-06-04

### pitfall:title_input_has_hidden_decoy

- trigger: publish workflow fallback 用 visible text selector 找 title 输入框
- symptom: 输入到一对 4px 宽的隐藏 scaffolding input，submit 时 v-model 不 commit，标题永远为空
- workaround: 优先用 `opencli xiaohongshu publish` adapter（已 prioritize visible title input）；fallback 时按 placeholder text `请输入标题` 加 visible filter (`offsetWidth > 50`) 选可见 input；不要按 nth-child / first match
- verified_at: 2026-06-04

### pitfall:home_feed_xhr_lacks_xsec_token

- trigger: agent 想拿 home feed 下一页，调内部 `/homefeed` XHR 取 items
- symptom: items 拿到但每条 `xsec_token` 缺，drill-down 到 note 详情时所有 URL 403
- workaround: 不要 fetch `/homefeed`；走 SSR Pinia store snapshot (`feed.js` adapter 已是这套)；first-screen 的 items 才有 `xsecToken`；如果一定要翻页，scroll + 重读 store
- verified_at: 2026-06-04
