# Cursor

Control the **Cursor IDE** from the terminal via Chrome DevTools Protocol (CDP). Since Cursor is built on Electron (VS Code fork), OpenCLI can drive its internal UI, automate Composer interactions, and manipulate chat sessions.

## Prerequisites

1. Install [Cursor](https://cursor.sh/).
2. Launch it with the remote debugging port:
   ```bash
   /Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=9226
   ```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9226"
```

## Commands

### Diagnostics
- `opencli cursor status`: Check CDP connection status.
- `opencli cursor dump`: Dump the full DOM and Accessibility snapshot to `/tmp/cursor-dom.html` and `/tmp/cursor-snapshot.json`.

### Chat Manipulation
- `opencli cursor new`: Press `Cmd+N` to start a new file/tab.
- `opencli cursor send "message"`: Inject text into the active Composer/Chat input and submit.
- `opencli cursor read`: Extract the full conversation history from the active chat panel.

### AI Features
- `opencli cursor composer "prompt"`: Open the Composer panel (`Cmd+I`) and send a prompt for inline AI editing.
- `opencli cursor model`: Get the currently active AI model (e.g., `claude-4.5-sonnet`).
- `opencli cursor extract-code`: Extract all code blocks from the current conversation.
