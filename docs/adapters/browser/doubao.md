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

## Prerequisites

- Chrome is running
- You are already logged into [doubao.com](https://www.doubao.com/)
- Playwright MCP Bridge / browser bridge is configured for OpenCLI

## Examples

```bash
opencli doubao status
opencli doubao new
opencli doubao send "帮我总结这段文档"
opencli doubao read
opencli doubao ask "请写一个 Python 快速排序示例" --timeout 90
```

## Notes

- The adapter targets the web chat page at `https://www.doubao.com/chat`
- `new` first tries the visible "New Chat / 新对话" button, then falls back to the new-thread route
- `ask` uses DOM polling, so very long generations may need a larger `--timeout`
