---
schema_version: 1.1
page_id: compose
url_patterns:
  - https://creator.xiaohongshu.com/publish/publish?from=*&target=image
  - https://creator.xiaohongshu.com/publish/publish?from=*&target=video
purpose: creator center publish form — image / video note authoring (DIFFERENT host from main site)
last_verified: 2026-06-04
source: global
---

> **host 警告**：本 page **不在** `www.xiaohongshu.com`，而是 `creator.xiaohongshu.com`。两 host 共享 SSO（同 `web_session` cookie），但 DOM / 路由 / shadow DOM 完全不同 — `pitfall:creator_center_is_different_host`

## Visual anchors

- a11y: 无统一 role；form 区块按 visible text 分
- pattern: file input `input[type="file"][accept*="image"]`；标题 `input[placeholder*="请输入标题"][offsetWidth>50]`（visible filter 排 4px hidden decoy）；正文 contenteditable `[contenteditable="true"]`；topic input 触发 visible text `#话题`；publish button `<xhs-publish-btn>` 自定义元素
- testid: 无
- selector_pattern: title input 有 visible / hidden 两套同 class，**必须** filter `offsetWidth > 50` — `pitfall:title_input_has_hidden_decoy`
- text: publish button visible text `发布`；save draft `存草稿`；image upload 区 `点击上传`

## Actions

```yaml
### action:upload_images
pre: on /publish/publish?target=image, logged_in, image files local paths ready
do: opencli xiaohongshu publish --title "..." "..." --images /path/a.jpg,/path/b.jpg ... (走 CDP DOM.setFileInputFiles)
post: image preview 区出现缩略图，3s 内 upload settle
fail: file input 找不到 | upload 卡住 | "上传失败" toast
recover: 检查图片格式 (jpg/png/webp <10MB)；最多 9 张 (MAX_IMAGES)；adapter 内置 base64 fallback；都 fail -> adapter_health suspect
evidence: opencli xiaohongshu publish
```

```yaml
### action:fill_text
pre: images uploaded, title input + body contenteditable visible
do: type "<title>" into title input (visible filter) + type "<body>" into body contenteditable
post: 标题 + 正文 v-model 同步，submit button 候选 enable
fail: 输入到 hidden decoy input (v-model 不 commit) | character limit 超 (title >20 / body >1000)
recover: 标题截到 20 字符内；body 截到 1000 内；fallback selector 加 `offsetWidth > 50` filter
evidence: opencli xiaohongshu publish
```

```yaml
### action:add_topics
pre: title + body filled, topic 输入位置 visible
do: opencli xiaohongshu publish --topics 生活,旅行 (adapter 内部处理 #话题 trigger + 选项 click)
post: 正文末尾出现 #话题 inline 链接
fail: 话题 popup 不弹 | 选项 click 不响应
recover: 跳过 topics 重试 publish（非必需）；persistent fail adapter_health suspect
evidence: opencli xiaohongshu publish
```

```yaml
### action:submit_publish
pre: title / images / body 都 ready
do: opencli xiaohongshu publish ... (adapter 内部走 shadow DOM instance method invocation: `_onPublish` / `onPublish` / `_onSubmit` / `_handlePublish`)
post: redirect 到 /creator/notes 或 toast "发布成功"
fail: shadow DOM method invocation 全 miss | "发布失败" toast | 安全验证 modal 弹
recover: 安全验证 modal -> 停手报 user；其他 fail -> adapter_health suspect 然后看 fallback (但 shadow DOM publish 没有 task-agent-能跑的 fallback，必须 adapter)
evidence: opencli xiaohongshu publish; opencli xiaohongshu creator-notes (verify new note)
```

```yaml
### action:save_draft
pre: 至少 title 或 images 之一存在
do: opencli xiaohongshu publish --draft ... (adapter 内部走 `_onSave` / `_onSaveDraft` / `_onDraft`)
post: redirect /creator/notes/drafts 或 toast "已保存草稿"；可通过 opencli xiaohongshu drafts 列出
fail: 同 submit_publish
recover: 同 submit_publish
evidence: opencli xiaohongshu publish --draft; opencli xiaohongshu drafts
```

## Page pitfalls

- 走 creator host，不要在 main site `www.xiaohongshu.com` 找发布入口 — `pitfall:creator_center_is_different_host`
- title input visible filter **必须** 加，否则输入丢到 4px hidden decoy — `pitfall:title_input_has_hidden_decoy`
- publish button 是 closed shadow DOM，host `.click()` 不触发，必须 instance method invocation — `pitfall:publish_button_shadow_dom`
- 安全验证 modal 是 human-only 红线（CAPTCHA / 滑块 / 短信 2FA），停手报 user
