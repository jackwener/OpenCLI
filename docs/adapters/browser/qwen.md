# Qwen (通义千问)

Drive **Qianwen / Qwen** chat from the terminal. All commands run through your existing browser session — no API key needed.

**Mode**: 🔐 Browser · **Domain**: `www.qianwen.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli qwen status` | Page availability, login state, current model and session | read |
| `opencli qwen history` | List recent conversations (requires login) | read |
| `opencli qwen read` | Read messages in the current conversation | read |
| `opencli qwen detail <id>` | Open a conversation by ID and read its messages | read |
| `opencli qwen ask <prompt>` | Send a prompt and wait for the assistant reply | write |
| `opencli qwen send <prompt>` | Fire-and-forget: send a prompt without waiting | write |
| `opencli qwen new` | Start a fresh conversation | write |
| `opencli qwen image <prompt>` | Generate images (AI 生图) and save them locally | write |

## Usage Examples

```bash
# Sanity check
opencli qwen status

# Recent conversations
opencli qwen history --limit 10

# Read the active conversation as markdown
opencli qwen read --markdown true

# Read a specific historical conversation by ID (or full URL)
opencli qwen detail abcd1234ef567890abcd1234ef567890
opencli qwen detail https://www.qianwen.com/chat/abcd1234ef567890abcd1234ef567890 --markdown true

# Ask a question and wait for the reply
opencli qwen ask "用一段话解释 transformer attention"

# Ask in a brand-new chat with DeepThink turned on
opencli qwen ask "推导 KL 散度的链式法则" --new true --think true

# Fire-and-forget (don't wait for the reply)
opencli qwen send "继续上面的推导" --think true

# Start a new conversation
opencli qwen new

# Generate an image and save it locally
opencli qwen image "a watercolor fox sketching on paper"

# Custom output directory
opencli qwen image "cyberpunk skyline" --op ~/Downloads/qwen-images

# Skip download — just print the share link
opencli qwen image "a tiny robot" --sd true
```

## Options

### `ask` / `send`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional) |
| `--new` | Start a new chat before sending (default: `false`) |
| `--think` | Enable 深度思考 (DeepThink) |
| `--research` | Enable 深度研究 (DeepResearch) |
| `--markdown` | (`ask` only) Emit assistant reply as markdown |
| `--timeout` | (`ask` only) Max seconds to wait for the reply (default: `120`) |

### `image`

| Option | Description |
|--------|-------------|
| `prompt` | Image prompt (required positional) |
| `--op` | Output directory (default: `~/Pictures/qianwen`) |
| `--new` | Start a new chat before generating (default: `true`) |
| `--sd` | Skip download; only print the conversation link |
| `--timeout` | Max seconds to wait for the image response (default: `180`) |

### `read`

| Option | Description |
|--------|-------------|
| `--markdown` | Emit assistant replies as markdown (default: `false`) |

### `detail`

| Option | Description |
|--------|-------------|
| `id` | Session ID (32-char hex) or full `https://www.qianwen.com/chat/<id>` URL (required positional) |
| `--markdown` | Emit assistant replies as markdown (default: `false`) |

### `history`

| Option | Description |
|--------|-------------|
| `--limit` | Max conversations to list (default: `20`, max `100`) |

## Output Columns

| Command | Columns |
|---------|---------|
| `status` | `Status, Login, Model, SessionId, Url` |
| `history` | `Index, Title, Updated, Url` |
| `read` | `Role, Text` |
| `detail` | `Role, Text` |
| `ask` | `Role, Text` |
| `send` | `Status, Prompt` |
| `new` | `Status` |
| `image` | `Status, File, Link` |

## Prerequisites

- Chrome is running
- You are already signed into `www.qianwen.com`
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- `read` works without login (guest mode), but `history` and most `write` flows require an authenticated session
- Qwen commands default to persistent site sessions, so consecutive `qwen ask` / `qwen read` / `qwen image` invocations continue in the same Qwen page. Pass `--site-session ephemeral` for a one-shot tab.
- `ask` waits for the streaming reply to finish; `send` returns immediately after submission
- DeepThink (`--think`) and DeepResearch (`--research`) toggle the corresponding composer chips before submitting
- Generated image files are timestamped to avoid overwriting prior runs
- `status` returns `Model` / `SessionId` as `null` when they cannot be detected (e.g. guest mode, page still loading) rather than a string sentinel — branch on `null` in agent code
- DOM or product changes on Qwen can break composer detection — `opencli qwen status` is the quickest sanity check
- `limit` is validated and rejected with `ArgumentError` if non-positive or above the documented max (e.g. `history` max 100); no silent clamp
