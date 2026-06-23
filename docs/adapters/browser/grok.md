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
| `opencli grok export` | Export visible conversation history metadata from the history dialog | read |
| `opencli grok export-all` | Export conversation metadata plus per-conversation transcript JSON | read |
| `opencli grok ask <prompt>` | Send a prompt and wait for the assistant reply | write |
| `opencli grok send <prompt>` | Fire-and-forget: send a prompt without waiting | write |
| `opencli grok new` | Start a fresh conversation | write |
| `opencli grok image <prompt>` | Generate images via Grok and return their URLs | write |
| `opencli grok pin <id>` | Pin a conversation from the sidebar context menu | write |
| `opencli grok unpin <id>` | Unpin a conversation from the sidebar context menu | write |
| `opencli grok delete <id> --yes` | Delete a sidebar conversation after an explicit `--yes` confirmation | write |

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

# Export loaded history metadata, then export transcripts from that manifest
opencli grok export --limit 25 -f json > grok-history.json
opencli grok export-all --manifestPath grok-history.json --limit 25 -f json > grok-transcripts.json

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

# Pin or unpin a conversation by ID (or full https://grok.com/c/<id> URL)
opencli grok pin 7c4197f2-10a1-4ebb-a84a-fea89f4f1d06
opencli grok unpin https://grok.com/c/7c4197f2-10a1-4ebb-a84a-fea89f4f1d06

# Preview then explicitly delete a conversation
opencli grok delete 7c4197f2-10a1-4ebb-a84a-fea89f4f1d06
opencli grok delete 7c4197f2-10a1-4ebb-a84a-fea89f4f1d06 --yes true
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

### `export`

| Option | Description |
|--------|-------------|
| `--limit` | Max conversations to export; `0` means all loaded history (default: `0`) |
| `--maxScrolls` | Max history-dialog scroll rounds (default: `80`, max `500`) |

### `export-all`

| Option | Description |
|--------|-------------|
| `--limit` | Max conversations to export; `0` means all loaded history or all manifest rows after offset |
| `--offset` | Skip this many conversations before exporting (default: `0`) |
| `--manifestPath` | Optional JSON output from `grok export`; when present, skips history discovery and visits listed `/c/<id>` pages |
| `--maxScrolls` | Max history-dialog scroll rounds when no manifest is provided (default: `80`, max `500`) |
| `--pageScrolls` | Max per-conversation scroll-to-bottom rounds (default: `30`, max `200`) |
| `--pageTimeoutMs` | Max wait for each conversation page to show messages (default: `30000`) |
| `--delayMinMs` | Minimum polite delay after a conversation page loads (default: `0`) |
| `--delayMaxMs` | Maximum polite delay after a conversation page loads (default: `5000`) |

### `pin` / `unpin` / `delete`

| Option | Description |
|--------|-------------|
| `id` | Session ID (UUID) or full `https://grok.com/c/<id>` URL (required positional) |
| `--yes` | (`delete` only) Actually delete the conversation; without it the command returns a dry-run row |

## Output Columns

| Command | Columns |
|---------|---------|
| `status` | `Status, Login, Model, SessionId, Url` |
| `history` | `Index, Title, Url` |
| `read` | `Role, Text` |
| `detail` | `Role, Text` |
| `export` | `index, id, title, date, url` |
| `export-all` | `index, id, title, date, url, status, messageCount, error, messagesJson` |
| `ask` | `response` |
| `send` | `Status, Prompt` |
| `new` | `Status` |
| `pin` | `status, id` |
| `unpin` | `status, id` |
| `delete` | `status, id` |

## Prerequisites

- Chrome is running
- You are already signed into [grok.com](https://grok.com)
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- `read` works in the current tab even without an explicit ID; pair it with `status` to discover the active session ID first.
- Grok commands default to persistent site sessions, so consecutive `grok ask` / `grok read` / `grok detail` invocations continue in the same Grok page. Pass `--site-session ephemeral` for a one-shot tab.
- `ask` waits for the streaming reply to stabilize; `send` returns immediately after submission.
- `history` reads the visible sidebar — if Grok lazy-loads older conversations, scroll the sidebar in your browser before re-running, or use `detail <id>` directly.
- `export` opens the full history dialog and scrolls it to collect real `https://grok.com/c/<id>` conversation URLs. Malformed history rows are treated as selector drift, not silently dropped.
- `export-all` visits each conversation URL and records per-conversation `status`. A page with no visible transcript produces an `empty` row with an `error` message; malformed transcript rows produce a `failed` row; malformed history or manifest identity fails before export.
- `pin`, `unpin`, and `delete` operate on conversations visible in the sidebar. `pin` / `unpin` verify the post-action context-menu state; `delete --yes` verifies the sidebar entry disappears before returning success.
- `status` returns `Model` / `SessionId` as `null` when they cannot be detected (e.g. page still loading) rather than a string sentinel — branch on `null` in agent code.
- DOM or product changes on Grok can break composer detection — `opencli grok status` is the quickest sanity check.
- `limit` is validated and rejected with `ArgumentError` if non-positive or above the documented max (`history` max 100); no silent clamp.
