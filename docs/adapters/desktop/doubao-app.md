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

## Commands

| Command | Description |
|---------|-------------|
| `opencli doubao-app status` | Check CDP connection status |
| `opencli doubao-app new` | Start a new conversation |
| `opencli doubao-app send "message"` | Send a message to the current chat |
| `opencli doubao-app read` | Read the latest assistant reply |
| `opencli doubao-app ask "message"` | Send a prompt and wait for the reply |
| `opencli doubao-app screenshot` | Capture a screenshot of the app window |
| `opencli doubao-app dump` | Export DOM and snapshot debug info |

## How It Works

Connects to the Doubao Electron app via CDP, injecting JavaScript into the renderer process to control the chat UI — sending messages, reading replies, and capturing screenshots.

## Limitations

- Requires Doubao Desktop to be launched with `--remote-debugging-port`
- macOS / Linux / Windows (Electron-based, platform independent)
