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
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
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
- `opencli codex projects`: List visible sidebar projects and conversations.
- `opencli codex history`: List visible conversation threads grouped by project.
- `opencli codex extract-diff`: Automatically scrapes any visual Patch chunks and Code Diffs.
- `opencli codex model`: Get the currently active AI model.
- `opencli codex export`: Export the current conversation as Markdown.

### Selecting a Project Conversation

`send`, `ask`, and `read` can select a visible sidebar conversation before acting:

```bash
opencli codex projects
opencli codex send "Sync the repo and report blockers" --project stock --conversation "同步各仓库最新代码"
opencli codex ask "Summarize current status" --project opencli --index 2 --timeout 120
opencli codex read --project /Users/youngcan/stock --thread-id local:019df125-bf8b-77f0-ade5-de44670db82d
```

Project selection matches either the project label or path. Conversation selection accepts `--conversation`, `--index`, or `--thread-id`.
