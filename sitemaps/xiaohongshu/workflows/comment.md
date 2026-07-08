---
schema_version: 1.1
workflow_id: comment
intent: post a comment on a xiaohongshu note
last_verified: 2026-06-04
source: global
---

## Goal

在指定 note 下发一条 **文本评论**（无图片 / 无 @ 用户 / 无 emoji panel）。

- 回复别人的评论（reply to comment）**不在** v1 PoC scope（属于子评论 nested workflow）
- 评论带图 / @ 用户 / 表情 panel **不在** v1 PoC scope

## State signature

- entry: 任意 page，logged_in，note URL (含 `xsec_token`) ready，评论文本 ready
- success: 评论区顶部 / 自己 username 下出现刚发的文本，且 `opencli xiaohongshu comments <url>` 输出含该条

## Best path

xhs 现阶段 **没有 cookie-API 形 `opencli xiaohongshu comment` adapter**（comments adapter 只读不写）。直接走 browser DOM workflow：

```yaml
preconditions:
  - logged_in
  - note URL with valid xsec_token
  - comment text ready (<= 1000 chars, no special markup)
estimated_turns: 4
```

```yaml
flow:
  - goto <note_url>  # 必须含 xsec_token，否则 pitfall:note_url_requires_xsec_token
  - wait for action:read_comments precondition (评论区 rendered)
  - action:post_comment in pages/note.md
  - verify: opencli xiaohongshu comments <url> --limit 5 看顶部是否是新评论
```

> **Adapter follow-up candidate**：cookie-API 形 `opencli xiaohongshu comment <url> "<text>"` 是合理的下一发，发完 v1 sitemap 后开 issue 给 adapter-author。

## Fallback path

Best path 已经是 DOM-only。Fallback 主要处理 AuthRequired / security_block：

```yaml
on_action_fail:
  - if URL 含 /login OR overlay "请登录":
    - recovery: opencli xiaohongshu login  # pending: codex task #276
    - 登录后从 Best path step 1 重跑
  - if 安全验证 modal visible (CAPTCHA / 滑块 / 短信):
    - 停手报 user，不要尝试自动过验证
  - if 评论 textarea 找不到 (selector 漂):
    - 标记 page action `action:post_comment` stale，停手报 user
  - if submit button click 后评论未出现 > 5s:
    - 等 10s 后 cross-verify opencli xiaohongshu comments，可能是 server lag
    - 仍未出现 -> 评论被过滤（敏感词 / spam 检测），停手报 user 让其改文案
estimated_turns: +2
```

## Avoid

- 不要在不带 `xsec_token` 的 URL 上跑（403）— `pitfall:note_url_requires_xsec_token`
- 不要循环 retry 评论（spam 检测 / 触发 security_block）
- 不要尝试 click 表情 panel / @ 用户 / 上传图片 — out of scope
- 不要 click "发布" 后立刻关 page，server commit 有 1-3s lag，必须 cross-verify 后再退出

## Re-entry checkpoints

agent 中断后醒来按 `opencli browser state` URL + comments 比对判断：

- 非 `/explore/<note_id>?xsec_token=...` URL → 重新 goto
- on note page, textarea visible 但未输入 → step 3 起
- on note page, 评论已 submit 但未 cross-verify → cross-verify 一次
- on `/login` 或 login wall → 走 Recovery

## State validation

- `opencli xiaohongshu comments <url> --limit 5` 输出顶部 row 的 `author` 是 self（whoami 对比） 且 `content` 匹配（normalize whitespace + emoji NFC）
- 评论时间显示 `刚刚` / `1秒前` / `1分钟前`

## Stale markers

- 评论 textarea selector 漂（`.comment-input` / `textarea[placeholder*="评论"]` 都 miss） → action:post_comment 需更新
- xhs 引入 cookie-API `comment` adapter 后，Best path 切 adapter，本 workflow 改 Fallback
