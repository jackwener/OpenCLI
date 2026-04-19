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

## Usage Examples

```bash
# Ask a question
opencli deepseek ask "explain quicksort in 3 sentences"

# Start a new chat before asking
opencli deepseek ask "hello" --new

# Use Expert model instead of Instant
opencli deepseek ask "prove that sqrt(2) is irrational" --model expert

# Enable DeepThink mode
opencli deepseek ask "prove that sqrt(2) is irrational" --think

# Enable web search
opencli deepseek ask "latest news about AI" --search

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
```

### Options (ask)

| Option | Description |
|--------|-------------|
| `<prompt>` | The message to send (required, positional) |
| `--timeout` | Wait timeout in seconds (default: 120) |
| `--new` | Start a new chat before sending (default: false) |
| `--model` | Model to use: `instant` or `expert` (default: instant) |
| `--think` | Enable DeepThink mode (default: false) |
| `--search` | Enable web search (default: false) |

## Prerequisites

- Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed
- Logged in to [chat.deepseek.com](https://chat.deepseek.com)

## Caveats

- This adapter drives the DeepSeek web UI in the browser, not an API
- DeepThink and Search are toggle buttons; `--think` and `--search` enable them if not already active
- Long responses (code, essays) may need a higher `--timeout`
- File upload is not yet supported
