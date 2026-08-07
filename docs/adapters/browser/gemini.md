# Gemini

**Mode**: 🔐 Browser · **Domain**: `gemini.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli gemini new` | Start a new Gemini web chat |
| `opencli gemini ask <prompt> [--model <value>] [--thinking <level>]` | Send a prompt and return only the assistant reply |
| `opencli gemini image <prompt>` | Generate images in Gemini and optionally save them locally |
| `opencli gemini models` | List available Gemini models |
| `opencli gemini deep-research <prompt>` | Start a Gemini Deep Research run and confirm it |
| `opencli gemini deep-research-result <query>` | Export Deep Research report URL from a Gemini conversation |
| `opencli gemini status` | Check Gemini web page availability and login state |
| `opencli gemini history [--limit N]` | List visible Gemini conversation history from the sidebar |
| `opencli gemini detail <id>` | Open a Gemini conversation by id, URL, or sidebar title and read its turns |
| `opencli gemini read` | Read the turns visible in the current Gemini web conversation |

## Usage Examples

```bash
# Start a fresh chat
opencli gemini new

# Ask Gemini and return minimal plain-text output
opencli gemini ask "Reply with exactly: HELLO"

# Ask with a specific model selected
opencli gemini ask "Explain quantum computing in one sentence" --model 2.5-flash

# Ask in a new chat and wait longer
opencli gemini ask "Summarize this design in 3 bullets" --new true --timeout 90

# Ask with extended thinking
opencli gemini ask "Explain quantum computing" --thinking extended

# Ask with standard thinking in a fresh chat
opencli gemini ask "Hello" --new true --thinking standard

# Ask with a specific model and thinking level combined
opencli gemini ask "Explain quantum computing in one sentence" --model 2.5-pro --thinking extended

# Ask in a new chat with a specific model and thinking level
opencli gemini ask "Summarize this design in 3 bullets" --new true --model 2.5-flash --thinking standard

# Generate an icon image with short flags
opencli gemini image "Generate a tiny cyan moon icon" --rt 1:1 --st icon

# Only generate in Gemini and print the page link without downloading files
opencli gemini image "A watercolor sunset over a lake" --sd true

# Save generated images to a custom directory
opencli gemini image "A flat illustration of a robot" --op ~/tmp/gemini-images

# List available models
opencli gemini models

# List models as JSON for scripting
opencli gemini models -f json
```

## Options

### `ask`

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required positional argument) |
| `--model` | Gemini model to use (e.g. `2.5-flash`, `2.5-pro`). Use `opencli gemini models` to list available values. |
| `--timeout` | Max seconds to wait for a reply (default: `60`) |
| `--new` | Start a new chat before sending (default: `false`) |
| `--thinking` | Thinking level: `standard` or `extended` (omitted = leave unchanged) |

### `image`

| Option | Description |
|--------|-------------|
| `prompt` | Image prompt to send (required positional argument) |
| `--rt` | Aspect ratio shorthand: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3` |
| `--st` | Optional style shorthand, e.g. `icon`, `anime`, `watercolor` |
| `--op` | Output directory for downloaded images (default: `~/tmp/gemini-images`) |
| `--sd` | Skip download and only print the Gemini page link |

### `models`

| Column | Description |
|--------|-------------|
| `model` | Canonical model ID (e.g. `2.5-flash`, `2.5-pro`, `2.5-flash-lite`) |
| `thinkingValues` | Per-model thinking levels only when Gemini exposes them directly on the model entry; otherwise `[]`. The current Gemini UI usually exposes thinking controls for the active model, so this command does not infer support for every model. |

- `models` discovers available models from the visible Gemini web UI model picker.
- The command is read-only: it does not select a model, change a thinking level, start a new chat, or submit a prompt.
- Model IDs match the canonical format used by later `gemini ask` model selection.
- Throws a command error when the model picker cannot be opened, which helps surface Gemini Web UI changes. Returns an empty list only when the picker opens but no model entries are available.

## Behavior

- When `--new true` is combined with `--model` and/or `--thinking`, the new chat is created first, then the model and thinking level are selected, then the snapshot is read, and finally the prompt is submitted.
- `ask --model <value>` selects the requested model before reading the page state and sending the prompt. The selected model remains visible in the Gemini web UI after the command completes. Short aliases like `pro` or `flash` are rejected—use canonical model IDs from `opencli gemini models`.
- When `--model` is omitted, `ask` does not change the current model.
- All other Gemini commands (`image`, `deep-research`, etc.) are unaffected and do not accept `--model`.
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
- Gemini commands default to persistent site sessions, so consecutive `gemini ask` / `gemini image` / `gemini deep-research-result` invocations continue in the same Gemini page. Pass `--site-session ephemeral` for a one-shot tab.
- It depends on the current browser session and may fail if Gemini shows login, consent, challenge, quota, or other gating UI.
- DOM or product changes on Gemini can break composer detection, new-chat handling, or image export behavior.
