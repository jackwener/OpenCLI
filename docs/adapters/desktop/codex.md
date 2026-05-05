# Codex

Control the **OpenAI Codex Desktop App** headless or headfully via Chrome DevTools Protocol (CDP). Because Codex is built on Electron, OpenCLI can directly drive its internal UI, automate slash commands, and manipulate its AI agent threads.

## Prerequisites

1. You must have the official OpenAI Codex app installed.
2. Launch it via the terminal and expose the remote debugging port:
   ```bash
   # macOS
   /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9222
   ```

## Setup

```bash
opencli config set browser.cdp_endpoint http://127.0.0.1:9222
```

## Commands

### Diagnostics
- `opencli codex status`: Checks connection and reads the current active window URL/title.
- `opencli codex dump`: Dumps the full UI DOM and Accessibility tree into `/tmp`.
- `opencli codex screenshot`: Captures DOM + snapshot artifacts of the current window.

### Agent Manipulation
- `opencli codex new`: Simulates `Cmd+N` to start a completely fresh and isolated Git Worktree thread context.
- `opencli codex send "message"`: Robustly finds the active Thread Composer and injects your text.
  - *Pro-tip*: You can trigger internal shortcuts, e.g., `opencli codex send "/review"`.
- `opencli codex ask "message"`: Send + wait + read in one shot.
- `opencli codex read`: Extracts the entire current thread history and AI reasoning logs.
- `opencli codex extract-diff`: Automatically scrapes any visual Patch chunks and Code Diffs.
- `opencli codex model`: Get the currently active AI model.
- `opencli codex history`: List recent conversation threads from the sidebar.
- `opencli codex export`: Export the current conversation as Markdown.
