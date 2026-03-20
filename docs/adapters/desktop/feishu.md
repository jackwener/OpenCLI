# Feishu (飞书/Lark)

Control **Feishu/Lark Desktop** from the terminal via AppleScript.

> **Note:** Feishu uses a custom `Lark Framework` (Chromium-based but NOT Electron). CDP is not available, so this adapter uses AppleScript + clipboard.

## Prerequisites

1. Feishu/Lark must be running and logged in
2. Terminal must have **Accessibility permission**

## Commands

| Command | Description |
|---------|-------------|
| `opencli feishu status` | Check if Feishu/Lark is running |
| `opencli feishu send "msg"` | Send message in active chat (paste + Enter) |
| `opencli feishu read` | Read current chat (Cmd+A → Cmd+C) |
| `opencli feishu search "query"` | Global search (Cmd+K) |
| `opencli feishu new` | New message/document (Cmd+N) |
