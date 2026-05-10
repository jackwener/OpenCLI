# DeepSeek

**Mode**: Browser · **Domain**: `chat.deepseek.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli deepseek ask <prompt>` | Send a prompt and get the response |
| `opencli deepseek new` | Start a new conversation |
| `opencli deepseek status` | Check login state and page availability |
| `opencli deepseek read` | Read the current conversation |
| `opencli deepseek history` | List conversation history from sidebar |
| `opencli deepseek detail <id>` | Read a specific conversation by ID or URL |
| `opencli deepseek send <id> <prompt>` | Send a prompt to a specific conversation without waiting for a response |

## Usage Examples

```bash
# Ask a question
opencli deepseek ask "explain quicksort in 3 sentences"

# Start a new chat before asking
opencli deepseek ask "hello" --new

# Use Expert model instead of Instant
opencli deepseek ask "prove that sqrt(2) is irrational" --model expert

# Use Vision model with an image
opencli deepseek ask "describe this image" --model vision --file ./image.png

# Enable DeepThink mode
opencli deepseek ask "prove that sqrt(2) is irrational" --think

# Enable web search
opencli deepseek ask "latest news about AI" --search

# Attach a file
opencli deepseek ask "summarize this document" --file ./report.pdf

# Combine modes
opencli deepseek ask "what happened today?" --model expert --think --search --new

# Custom timeout (default: 120s)
opencli deepseek ask "write a long essay" --timeout 180

# JSON output
opencli deepseek ask "hello" -f json

# Check login status
opencli deepseek status

# Start a fresh conversation
opencli deepseek new

# Read current conversation
opencli deepseek read

# List recent conversations
opencli deepseek history --limit 10

# Read a specific conversation by UUID or /a/chat/s/<id> URL
opencli deepseek detail 749e6bbd-6a45-4440-beaa-ae5238bf06d8

# Send to a specific existing conversation
opencli deepseek send 749e6bbd-6a45-4440-beaa-ae5238bf06d8 "continue from the last answer"
```

### Options (ask)

| Option | Description |
|--------|-------------|
| `<prompt>` | The message to send (required, positional) |
| `--timeout` | Wait timeout in seconds (default: 120) |
| `--new` | Start a new chat before sending (default: false) |
| `--model` | Model to use: `instant`, `expert`, or `vision` (default: instant) |
| `--think` | Enable DeepThink mode (default: false) |
| `--search` | Enable web search (default: false) |
| `--file` | Attach a file (PDF, image, text) with the prompt (max 100 MB) |

### Options (detail)

| Option | Description |
|--------|-------------|
| `<id>` | DeepSeek conversation UUID or full `/a/chat/s/<id>` URL |

### Options (send)

| Option | Description |
|--------|-------------|
| `<id>` | DeepSeek conversation UUID or full `/a/chat/s/<id>` URL |
| `<prompt>` | The message to send (required, positional) |

## Prerequisites

- Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed
- Logged in to [chat.deepseek.com](https://chat.deepseek.com)

## Caveats

- This adapter drives the DeepSeek web UI in the browser, not an API
- DeepSeek commands default to site-level browser tab reuse, so consecutive `deepseek ask` / `deepseek read` / `deepseek detail` invocations continue in the same DeepSeek page. Pass `--reuse none` for a one-shot tab.
- Default mode is Instant with DeepThink and Search disabled; each flag (`--model`, `--think`, `--search`) is synced on every invocation so omitting a flag resets it
- Vision mode does not support `--search`; use `--model instant` or `--model expert` for web search
- `send` requires an explicit conversation ID; use `history` to find a conversation URL or ID first
- Long responses (code, essays) may need a higher `--timeout`
- File upload prefers the browser file-input path, falls back to base64 injection when needed, and rejects files over 100 MB
