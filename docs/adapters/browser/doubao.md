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
| `opencli doubao edit-image "..."` | Generate images from a prompt, or edit an uploaded image with `--image`, then download the results |
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

# Text-to-image: downloads every generated candidate (2048px)
opencli doubao edit-image "画一张图：一只橘猫在月光下的屋顶弹钢琴，治愈系插画风格"

# Image edit: upload a source image and apply an instruction
opencli doubao edit-image "把这张人设图的背景改成樱花粉色渐变，人物保持完全不变" --image C:/images/persona.png --out C:/results
```

## Notes

- The adapter targets the web chat page at `https://www.doubao.com/chat`
- Doubao commands default to persistent site sessions, so consecutive `doubao ask` / `doubao read` / `doubao detail` invocations continue in the same Doubao page. Pass `--site-session ephemeral` for a one-shot tab.
- `new` first tries the visible "New Chat / 新对话" button, then falls back to the new-thread route
- `ask` uses DOM polling, so very long generations may need a larger `--timeout`
- `edit-image` starts a new conversation per invocation, downloads every generated candidate, and consumes Doubao's daily image-generation quota; results are saved under `--out` (default `~/Downloads/doubao-edit`)
