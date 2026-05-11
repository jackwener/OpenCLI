# Grok

Drive **Grok** (grok.com) chat from the terminal. All commands run through your existing browser session — no API key needed.

**Mode**: 🔐 Browser · **Domain**: `grok.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli grok status` | Page availability, login state, current model and session | read |
| `opencli grok history` | List recent conversations from the sidebar (requires login) | read |
| `opencli grok read` | Read messages in the current conversation | read |
| `opencli grok detail <id>` | Open a conversation by ID and read its messages | read |
| `opencli grok ask <prompt>` | Send a prompt and wait for the assistant reply | write |
| `opencli grok send <prompt>` | Fire-and-forget: send a prompt without waiting | write |
| `opencli grok new` | Start a fresh conversation | write |
| `opencli grok image <prompt>` | Generate images via Grok and return their URLs | write |

## Usage Examples

```bash
# Sanity check
opencli grok status

# Recent conversations
opencli grok history --limit 10

# Read the active conversation as markdown
opencli grok read --markdown true

# Read a specific historical conversation by ID (or full URL)
opencli grok detail 7c4197f2-10a1-4ebb-a84a-fea89f4f1d06
opencli grok detail https://grok.com/c/7c4197f2-10a1-4ebb-a84a-fea89f4f1d06 --markdown true

# Ask a question and wait for the reply
opencli grok ask "Explain quantum computing in simple terms"

# Ask in a brand-new chat
opencli grok ask "Hello" --new true

# Fire-and-forget (don't wait for the reply)
opencli grok send "continue the previous answer"

# Start a new conversation
opencli grok new

# Generate an image
opencli grok image "a cyberpunk mechanical owl, neon purple and blue" --new true
```

## Options

### `ask` / `send`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional) |
| `--new` | Start a new chat before sending (default: `false`) |
| `--timeout` | (`ask` only) Max seconds to wait for the reply (default: `120`) |

### `read`

| Option | Description |
|--------|-------------|
| `--markdown` | Emit assistant replies as markdown (default: `false`) |

### `detail`

| Option | Description |
|--------|-------------|
| `id` | Session ID (UUID) or full `https://grok.com/c/<id>` URL (required positional) |
| `--markdown` | Emit assistant replies as markdown (default: `false`) |

### `history`

| Option | Description |
|--------|-------------|
| `--limit` | Max conversations to list (default: `20`, max `100`) |

## Output Columns

| Command | Columns |
|---------|---------|
| `status` | `Status, Login, Model, SessionId, Url` |
| `history` | `Index, Title, Url` |
| `read` | `Role, Text` |
| `detail` | `Role, Text` |
| `ask` | `response` |
| `send` | `Status, Prompt` |
| `new` | `Status` |

## Prerequisites

- Chrome is running
- You are already signed into [grok.com](https://grok.com)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- `read` works in the current tab even without an explicit ID; pair it with `status` to discover the active session ID first.
- Grok commands default to persistent site sessions, so consecutive `grok ask` / `grok read` / `grok detail` invocations continue in the same Grok page. Pass `--site-session ephemeral` for a one-shot tab.
- `ask` waits for the streaming reply to stabilize; `send` returns immediately after submission.
- `history` reads the visible sidebar — if Grok lazy-loads older conversations, scroll the sidebar in your browser before re-running, or use `detail <id>` directly.
- `status` returns `Model` / `SessionId` as `null` when they cannot be detected (e.g. page still loading) rather than a string sentinel — branch on `null` in agent code.
- DOM or product changes on Grok can break composer detection — `opencli grok status` is the quickest sanity check.
- `limit` is validated and rejected with `ArgumentError` if non-positive or above the documented max (`history` max 100); no silent clamp.
