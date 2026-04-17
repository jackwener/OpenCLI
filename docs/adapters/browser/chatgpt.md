# ChatGPT Web

**Mode**: 🔐 Browser · **Domain**: `chatgpt.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli chatgpt image <prompt>` | Generate images in ChatGPT web and optionally save them locally |

## Usage Examples

```bash
# Generate an image and save it to the default directory
opencli chatgpt image "a cyberpunk city at night"

# Save to a custom output directory
opencli chatgpt image "a robot sketching on paper" --op ~/Downloads/chatgpt-images

# Only generate in ChatGPT and print the conversation link
opencli chatgpt image "a tiny watercolor fox" --sd true
```

## Options

| Option | Description |
|--------|-------------|
| `prompt` | Image prompt to send (required positional argument) |
| `--op` | Output directory for downloaded images (default: `~/Pictures/chatgpt`) |
| `--sd` | Skip download and only print the ChatGPT conversation link |

## Behavior

- The command opens a fresh `chatgpt.com/new` page before sending the prompt.
- Output is plain `status / file / link`, not a markdown table.
- When `--sd` is enabled, the command does not download files and only prints the ChatGPT link.
- Downloaded files are named with a timestamp to avoid overwriting prior runs.

## Prerequisites

- Chrome is running
- You are already logged into `chatgpt.com`
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Caveats

- This adapter targets the ChatGPT web UI, not the macOS desktop app.
- It depends on the current browser session and can fail if ChatGPT shows login, challenge, quota, or other gating UI.
- DOM or product changes on ChatGPT can break composer detection, image detection, or export behavior.
