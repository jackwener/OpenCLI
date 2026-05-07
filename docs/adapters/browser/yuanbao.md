# Yuanbao

**Mode**: 🔐 Browser · **Domain**: `yuanbao.tencent.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli yuanbao new` | Start a new Yuanbao conversation |
| `opencli yuanbao ask <prompt>` | Send a prompt to Yuanbao web chat and wait for the reply |

## Usage Examples

```bash
# Start a fresh chat
opencli yuanbao new

# Basic ask (internet search on by default, deep thinking off by default)
opencli yuanbao ask "你好"

# Wait longer for a longer answer
opencli yuanbao ask "帮我总结这篇文章" --timeout 90

# Disable internet search explicitly
opencli yuanbao ask "你好" --search false

# Enable deep thinking explicitly
opencli yuanbao ask "你好" --think true
```

## Options

### `new`

- No options

### `ask`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional argument) |
| `--timeout` | Max seconds to wait for a reply (default: `60`) |
| `--search` | Enable internet search before sending (default: `true`) |
| `--think` | Enable deep thinking before sending (default: `false`) |

## Behavior

- The adapter targets the Yuanbao consumer web UI and sends the prompt through the visible Quill composer.
- `new` clicks the left-side Yuanbao new-chat trigger and falls back to reloading the Yuanbao homepage if needed.
- Before sending, it aligns the `联网搜索` and `深度思考` buttons to the requested `--search` / `--think` state.
- It waits for transcript changes to stabilize before returning the assistant reply.
- If Yuanbao opens a login gate instead of answering, the command returns a `[BLOCKED]` system message with a session hint.

## Prerequisites

- Chrome is running
- You are already logged into `yuanbao.tencent.com`
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Caveats

- This adapter drives the Yuanbao web UI, not a public API.
- Yuanbao commands default to site-level browser tab reuse, so consecutive `yuanbao ask` / `yuanbao new` invocations continue in the same Yuanbao page. Pass `--reuse none` for a one-shot tab.
- It depends on the current browser session and may fail if Yuanbao shows login, consent, challenge, or other gating UI.
- DOM or product changes on Yuanbao can break composer detection, submit behavior, or transcript extraction.
