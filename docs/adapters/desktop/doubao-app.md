# Doubao App (豆包桌面版)

Control the **Doubao AI Desktop App** via Chrome DevTools Protocol (CDP).

## Prerequisites

1. Launch Doubao Desktop with remote debugging enabled:
   ```bash
   /Applications/Doubao.app/Contents/MacOS/Doubao --remote-debugging-port=9225
   ```
2. Set the CDP endpoint:
   ```bash
   export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9225"
   ```

OpenCLI automatically selects the `doubao-chat/chat` renderer when Doubao exposes multiple CDP targets. `OPENCLI_CDP_TARGET` is only needed to override that default for diagnostics.

## Commands

| Command | Description |
|---------|-------------|
| `opencli doubao-app status` | Check CDP connection status |
| `opencli doubao-app new` | Start a new conversation |
| `opencli doubao-app send "message"` | Send a message to the current chat |
| `opencli doubao-app read` | Read the currently rendered conversation turns |
| `opencli doubao-app ask "message"` | Send a prompt and wait for the reply |
| `opencli doubao-app screenshot` | Capture a screenshot of the app window |
| `opencli doubao-app dump` | Export DOM and snapshot debug info |

## How It Works

Connects to the Doubao Electron app via CDP, injecting JavaScript into the renderer process to control the chat UI — sending messages, reading replies, and capturing screenshots.

`send` confirms that the new user turn appeared. `ask` then follows the reply after that exact prompt and waits for the text to stabilize, so long chats with a virtualized message list do not depend on the total DOM message count increasing.

If submission or reply completion cannot be confirmed, inspect the conversation with `read` before retrying. The prompt may already have been sent.

## Limitations

- Requires Doubao Desktop to be launched with `--remote-debugging-port`
- macOS / Linux / Windows (Electron-based, platform independent)
- `read` returns only turns currently mounted by Doubao's virtualized renderer
