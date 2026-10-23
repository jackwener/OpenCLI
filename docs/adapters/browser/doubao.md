# doubao

Browser adapter for [Doubao Chat](https://www.doubao.com/chat).

## Commands

| Command | Description |
|---------|-------------|
| `opencli doubao status` | Check whether the page is reachable and whether Doubao appears logged in |
| `opencli doubao new` | Start a new Doubao conversation |
| `opencli doubao send "..."` | Send a message to the current Doubao chat |
| `opencli doubao read` | Read the visible Doubao conversation |
| `opencli doubao ask "..."` | Send a prompt and wait for a reply |
| `opencli doubao detail <id>` | 对话详情 |
| `opencli doubao history` | 历史对话列表 |
| `opencli doubao meeting-summary <id>` | 会议总结 |
| `opencli doubao meeting-transcript <id>` | 会议记录 |

## Prerequisites

- Chrome is running
- You are already logged into [doubao.com](https://www.doubao.com/)
- Browser Bridge extension is installed and enabled for OpenCLI

## Examples

```bash
opencli doubao status
opencli doubao new
opencli doubao send "帮我总结这段文档"
opencli doubao read
opencli doubao ask "请写一个 Python 快速排序示例" --timeout 90
opencli doubao ask "请用一句话解释二分查找" --mode fast
opencli doubao ask "请分析这个算法的边界条件" --mode expert --timeout 180
```

## Mode selection (`ask`)

`--mode current` (the default) keeps the mode selected in the page. Use `--mode fast`
or `--mode expert` to select a mode through Doubao's visible menu before sending.
The expert choice is identified by its `专家` / `專家` badge, rather than a fixed
model version. Available modes depend on the account and current web UI. Selection
must be confirmed in the page; an unavailable or unconfirmed mode fails before
the prompt is sent. A selected mode is left in place after the command.

`ask` defaults to a foreground window and a 120-second response wait. An explicit
`--window` option still takes precedence. Longer expert responses may need a larger
`--timeout`. The `--mode` option applies only to `ask`.

## Notes

- The adapter targets the web chat page at `https://www.doubao.com/chat`
- Doubao commands default to persistent site sessions, so consecutive `doubao ask` / `doubao read` / `doubao detail` invocations continue in the same Doubao page. Pass `--site-session ephemeral` for a one-shot tab.
- `new` first tries the visible "New Chat / 新对话" button, then falls back to the new-thread route
- `ask` uses DOM polling, so very long generations may need a larger `--timeout`
- `ask` leaves an existing unsent draft untouched and refuses to overwrite it. It
  submits once, confirms a new user message, and returns only a new, completed
  assistant reply. Homepage suggestions and sidebar text are not answer fallbacks.
- If submission or completion cannot be confirmed, inspect the conversation before
  retrying; the prompt may already have been sent. There is no automatic resend.
  Use `--trace retain-on-failure` to retain local diagnostic evidence. Review traces
  for private information before sharing them.
- Verification challenges require human action in Chrome. The adapter does not
  bypass them. Extracted source links and answer content still require independent
  verification.
