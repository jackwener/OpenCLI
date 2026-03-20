# WeChat (微信)

Control **WeChat Mac Desktop** from the terminal via AppleScript + Accessibility API.

> **Note:** WeChat is a native macOS app (not Electron), so CDP is not available. This adapter uses AppleScript keyboard simulation and clipboard operations.

## Prerequisites

1. WeChat must be running and logged in
2. Terminal must have **Accessibility permission** (System Settings → Privacy & Security → Accessibility)

## Commands

| Command | Description |
|---------|-------------|
| `opencli wechat status` | Check if WeChat is running |
| `opencli wechat send "msg"` | Send message in the active chat (clipboard paste + Enter) |
| `opencli wechat read` | Read current chat content (Cmd+A → Cmd+C) |
| `opencli wechat search "keyword"` | Open search and type a query (Cmd+F) |
| `opencli wechat chats` | Switch to Chats tab (Cmd+1) |
| `opencli wechat contacts` | Switch to Contacts tab (Cmd+2) |

## Limitations

- **No CDP support** — WeChat is native Cocoa, not Electron
- `send` requires the correct conversation to be already open
- `read` captures whatever is visible via select-all + copy
- `search` types the query but cannot programmatically click results
