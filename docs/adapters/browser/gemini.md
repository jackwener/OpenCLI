# Gemini

**Mode**: 🔐 Browser · **Domain**: `gemini.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli gemini new` | Start a new Gemini web chat |
| `opencli gemini ask <prompt>` | Send a prompt and return only the assistant reply |
| `opencli gemini image <prompt>` | Generate images in Gemini and optionally save them locally |

## Usage Examples

```bash
# Start a fresh chat
opencli gemini new

# Ask Gemini and return minimal plain-text output
opencli gemini ask "Reply with exactly: HELLO"

# Ask in a new chat and wait longer
opencli gemini ask "Summarize this design in 3 bullets" --new true --timeout 90

# Generate an icon image with short flags
opencli gemini image "Generate a tiny cyan moon icon" --rt 1:1 --st icon

# Only generate in Gemini and print the page link without downloading files
opencli gemini image "A watercolor sunset over a lake" --sd true

# Save generated images to a custom directory
opencli gemini image "A flat illustration of a robot" --op ~/tmp/gemini-images
```

## Options

### `ask`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional argument) |
| `--timeout` | Max seconds to wait for a reply (default: `60`) |
| `--new` | Start a new chat before sending (default: `false`) |

### `image`

| Option | Description |
|--------|-------------|
| `prompt` | Image prompt to send (required positional argument) |
| `--rt` | Aspect ratio shorthand: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3` |
| `--st` | Optional style shorthand, e.g. `icon`, `anime`, `watercolor` |
| `--op` | Output directory for downloaded images (default: `~/tmp/gemini-images`) |
| `--sd` | Skip download and only print the Gemini page link |

## Behavior

- `ask` uses plain minimal output and returns only the assistant response text prefixed with `💬`.
- `image` also uses plain output and prints `status / file / link` instead of a table.
- `image` always starts from a fresh Gemini chat before sending the prompt.
- When `--sd` is enabled, `image` keeps the generation in Gemini and only prints the conversation link.

## Prerequisites

- Chrome is running
- You are already logged into `gemini.google.com`
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Caveats

- This adapter drives the Gemini consumer web UI, not a public API.
- It depends on the current browser session and may fail if Gemini shows login, consent, challenge, quota, or other gating UI.
- DOM or product changes on Gemini can break composer detection, new-chat handling, or image export behavior.
