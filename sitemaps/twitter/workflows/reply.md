---
schema_version: 1.1
workflow_id: reply
intent: reply to a specific tweet
last_verified: 2026-06-02
source: global
---

## Goal

对一条 known tweet URL 发 reply (text only)。

## State signature

- entry: 任意 page, 知道 target `https://x.com/<handle>/status/<id>`, logged_in
- success: 该 status detail page 下方 5s 内出现自己的 reply

## Best path

```yaml
adapter: opencli twitter reply
adapter_health: healthy
preconditions:
  - logged_in
  - target_status_url known
  - reply content satisfies pitfall:reply_silent_fails_on_rich_content constraints
estimated_turns: 1
```

直接 `opencli twitter reply --status-url <url> --text "<content>"`。

**强约束**：reply 含多段 / bullet / 反引号 / `→` / `<url>` 占位 → 多半 silent fail，**改写**或走 Fallback。详 `pitfall:reply_silent_fails_on_rich_content`。

## Fallback path

adapter 失败或 reply 内容过 rich 时：

```yaml
on_adapter_fail:
  - adapter_health_update: opencli twitter reply -> suspect
  - goto <status-url> (lands pages/status.md)
  - action:open_reply_composer_inline in pages/status.md
  - type content (RTL segmented, rich content per pitfall workaround)
  - action:submit_reply in pages/status.md
  - verify self reply within 5s under detail
estimated_turns: 4
```

## Avoid

- **不要用多段 bullet list reply** — silent fail 无 error 反馈；按 `pitfall:reply_silent_fails_on_rich_content` 改写
- 长 reply (>500 char) 改走 post + quote 模式 → `workflows/post.md` + quote_url 参数
- 不要 reply 后立刻发第二条 — Twitter 短时间内限流，间隔 ≥ 2s

## Re-entry checkpoints

- on /<handle>/status/<id>, reply composer 未浮现 → Fallback step 2 起
- on /<handle>/status/<id>, composer 浮现且 textarea 部分输入 → step 3 起
- detail 下方已出现 self reply → 完成

## State validation

- detail 下方 reply 列出现 self entry
- self reply text 完全匹配 submitted content（reply composer 不做 URL 自动转换，可 strict equality）
- 主 tweet 工具栏 reply 计数 +1

## Stale markers

- `reply composer can not be verified` 错误率上升 → silent fail 模式可能扩到更多 content 形态，pitfall workaround 需更新
- adapter `opencli twitter reply` 月度 fix 多 → adapter_health audit 标 suspect
