# Dory

Control the **Dory Desktop App** headless or headfully via Chrome DevTools Protocol (CDP). Because Dory is built on Electron, OpenCLI can directly drive its internal UI, send messages to the AI chat, read responses, and manage sessions.

## Prerequisites

1. You must have the official Dory app installed.
2. Launch it via the terminal and expose the remote debugging port:
   ```bash
   # macOS
   /Applications/Dory.app/Contents/MacOS/Dory --remote-debugging-port=9300
   ```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9300"
```

## Commands

### Diagnostics
- `opencli dory status` — Check CDP connection, current URL and page title.
- `opencli dory dump` — Dump the full DOM and accessibility tree to `/tmp/dory-dom.html` and `/tmp/dory-snapshot.json`.
- `opencli dory screenshot` — Capture DOM + accessibility snapshot to `/tmp/dory-snapshot-dom.html` and `/tmp/dory-snapshot-a11y.txt`.

### Chat
- `opencli dory send "message"` — Inject text into the active chat composer and submit.
- `opencli dory ask "message"` — Send a message, wait for the AI response, and print it.
  - Optional: `--timeout 120` to wait up to 120 seconds (default: 60).
- `opencli dory read` — Extract the full conversation thread (user + assistant messages) from the active page.
- `opencli dory export` — Export the current conversation to a Markdown file.
  - Optional: `--output /path/to/file.md` (default: `/tmp/dory-export.md`).

### Session Management
- `opencli dory new` — Create a new chat session by clicking the sidebar "New" button.
- `opencli dory sessions` — List recent chat sessions shown in the sidebar.

## Example Workflow

```bash
# 1. Verify connection
opencli dory status

# 2. Ask a question and get the response inline
opencli dory ask "What tables are available in the active database?"

# 3. Read the full conversation so far
opencli dory read

# 4. Export to Markdown for sharing
opencli dory export --output ~/dory-session.md

# 5. Start a fresh session
opencli dory new
```

## Notes

- Dory uses React-controlled form elements. The `send` and `ask` commands use the native `HTMLTextAreaElement` value setter to properly trigger React's synthetic event system.
- The `ask` command polls every 2 seconds and considers the response complete once the text stabilises across two consecutive polls.
- If the sidebar is not visible, `sessions` and `new` may fall back to keyboard shortcuts or return empty results.
