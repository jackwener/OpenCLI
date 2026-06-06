---
schema_version: 1.1
workflow_id: publish
intent: publish an image note (title + body + 1-9 images, optional topics)
last_verified: 2026-06-04
source: global
---

## Goal

发一篇 **图文笔记**：标题（≤20 字）+ 正文 + 1-9 张本地图片，可选 topic 话题。

- 视频笔记 / 长文 / 私密 / 定时发布 / @用户 / 位置 **不在** v1 PoC scope
- 草稿保存走同 page action:save_draft，走 `--draft` flag，不算 publish 完成

## State signature

- entry: 任意 page，logged_in，本地图片路径 ready，标题 / 正文 string ready
- success: `opencli xiaohongshu creator-notes` 列表里出现新笔记（title 匹配），或 publish toast `发布成功`

## Best path

```yaml
adapter: opencli xiaohongshu publish
adapter_health: healthy
preconditions:
  - logged_in (creator.xiaohongshu.com 同 cookie 共享)
  - title <= 20 chars
  - 1-9 local image paths (jpg/png/webp, <10MB each)
  - body text ready
estimated_turns: 1
```

直接 `opencli xiaohongshu publish --title "<title>" "<body>" --images /path/a.jpg,/path/b.jpg [--topics 生活,旅行]`。adapter 内部 navigate creator host + CDP file upload + shadow DOM submit。

## Fallback path

当 adapter 抛 typed error（AuthRequiredError / CommandExecutionError）或卡死 > 60s：

```yaml
on_adapter_fail:
  - adapter_health_update: opencli xiaohongshu publish -> suspect
  - if AuthRequiredError:
    - recovery: opencli xiaohongshu login  # pending: codex task #276
    - 登录后 retry adapter 一次
  - opencli browser state (verify host + URL)
  - if host != creator.xiaohongshu.com: goto https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image
  - action:upload_images in pages/compose.md (CDP DOM.setFileInputFiles)
  - wait 3s for upload settle
  - action:fill_text in pages/compose.md (title visible filter + body contenteditable)
  - 如果 topics 非空: action:add_topics in pages/compose.md
  - action:submit_publish in pages/compose.md
  - **注意**: publish button 是 closed shadow DOM, host-level click 不响应 -> 必须 evaluate 实例方法 `_onPublish` / `onPublish` / `_onSubmit` / `_handlePublish`
  - verify URL redirect 到 /creator/notes 或 toast "发布成功"
  - cross-verify: opencli xiaohongshu creator-notes --limit 1 看顶部是否是新发的
estimated_turns: 8
```

## Avoid

- 不要在 `www.xiaohongshu.com` 找发布入口 — `pitfall:creator_center_is_different_host`
- 不要 host-level `.click()` `<xhs-publish-btn>` — `pitfall:publish_button_shadow_dom`
- 不要 page-level selector 找 title input — `pitfall:title_input_has_hidden_decoy`，要加 visible filter (`offsetWidth > 50`)
- 安全验证 modal（CAPTCHA / 滑块 / 短信 2FA）弹出停手报 user，不要尝试自动解
- 不要 publish 失败后立刻 retry 5 次 — 触发 security_block 概率高
- 不要把 `--draft` 当 fallback — 草稿 != 已发布，不算 workflow 成功

## Re-entry checkpoints

agent 中断后醒来按 `opencli browser state` URL + creator-notes 比对判断：

- on 非 creator host → 重新走 Best path
- on `creator.xiaohongshu.com/publish/publish?...`, 图片已上传但 title/body 未填 → Fallback step "fill_text" 起
- on `/creator/notes` 或 toast `发布成功` 已显示 → 已完成，cross-verify `creator-notes` 顶部
- 安全验证 modal visible → 停手报 user

## State validation

- `opencli xiaohongshu creator-notes --limit 5` 顶部出现 title 匹配新 row，或
- `creator.xiaohongshu.com/creator/notes` URL 上看到新笔记 card（visible text 匹配）
- publish toast `发布成功` 出现过

## Stale markers

- shadow DOM publish button instance method 名变化（`_onPublish` family） → adapter 内部 fallback 链全 miss，task agent 在 Fallback step 卡住，标 adapter_health suspect
- title input class 漂 / hidden decoy 结构换 → visible filter 阈值需调整
- creator center URL `from=` `target=` query 变化 → goto URL 需更新
