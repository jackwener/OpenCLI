---
schema_version: 1.1
page_id: note
url_patterns:
  - https://www.xiaohongshu.com/explore/*?xsec_token=*
  - https://www.xiaohongshu.com/discovery/item/*?xsec_token=*
purpose: note detail page — title / body / author / tags / interaction counts + comments section
last_verified: 2026-06-04
source: global
---

## Visual anchors

- a11y: 无明显 role；靠 selector / scoped container
- pattern: title `#detail-title, .title`；body `#detail-desc, .desc, .note-text`；author `.username, .author-wrapper .name`
- testid: 无
- selector_pattern: 互动计数必须 scoped 到 `.interact-container`（page-level `.like-wrapper .count` 会命中评论区第一条评论的 like 数，不是 post 自己）
- text: login wall `登录后查看` / `请登录`；page 404 `页面不见了` / `笔记不存在` / `无法浏览`；security `安全限制` / `访问链接异常`

## Actions

```yaml
### action:read_note_content
pre: on /explore/<note_id>?xsec_token=..., logged_in
do: opencli xiaohongshu note <url> --max-content 0
post: 输出 {title, body, author, like_count, collect_count, comment_count, tags}
fail: AuthRequiredError | EmptyResultError | CommandExecutionError | security_block
recover: AuthRequired -> opencli xiaohongshu login（# pending: codex task #276）；Empty -> note 已删除/私密 跳过；CommandExecution -> adapter_health suspect 走 Fallback
evidence: opencli xiaohongshu note
```

```yaml
### action:read_comments
pre: on /explore/<note_id>?xsec_token=..., logged_in
do: opencli xiaohongshu comments <url>
post: 输出评论列表 + 子评论
fail: AuthRequired | Empty (无评论或全删) | CommandExecution
recover: 同 read_note_content；Empty 是合法状态（笔记没评论）
evidence: opencli xiaohongshu comments
```

```yaml
### action:post_comment
pre: on /explore/<note_id>?xsec_token=..., logged_in, 评论框 visible (.comment-input || textarea[placeholder*="评论"])
do: focus 评论 textarea + type "<text>" + click "发布" button
post: 评论区顶部出现自己 username + 内容 within 3s
fail: textarea 不 focus | submit button 不 enable | 安全验证 modal 弹
recover: 触发安全验证 modal 时停手报 user（"human authenticates"），不要尝试解滑块；session 失效 -> AuthRequired
evidence: opencli browser click + opencli xiaohongshu comments (verify new comment)
```

## Page pitfalls

- URL 不带 `xsec_token` 必 403 — `pitfall:note_url_requires_xsec_token`
- 互动计数 selector **必须 scoped 到 `.interact-container`**，否则拿到评论的计数（adapter 已 scoped，DOM fallback 写时务必注意）
- 高频访问同 URL 触发 `pitfall:security_block_on_repeated_access`
- `--max-content N` 是 opt-in 截断（default 0 = 不截断），不要假定默认截断
