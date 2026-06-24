# ChatGPT Web

**Mode**: 🔐 Browser · **Domain**: `chatgpt.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli chatgpt ask <prompt>` | Send a prompt and wait for the visible response |
| `opencli chatgpt send <prompt>` | Send a prompt without waiting |
| `opencli chatgpt read` | Read the current conversation |
| `opencli chatgpt history` | List visible conversation history links from the sidebar |
| `opencli chatgpt detail <id-or-url>` | Open a conversation by `/c/<id>` and read it |
| `opencli chatgpt deep-research-result <id-or-url>` | Read a completed Deep Research report from a conversation |
| `opencli chatgpt new` | Start a new conversation |
| `opencli chatgpt status` | Check page and login state |
| `opencli chatgpt image <prompt>` | Generate images in ChatGPT web and optionally save them locally |
| `opencli chatgpt model <level>` | Switch the ChatGPT web intelligence level |

## Usage Examples

```bash
# Ask and wait for the answer
opencli chatgpt ask "Summarize the tradeoffs of browser session reuse"

# Continue the same ChatGPT tab but do not wait for the answer
opencli chatgpt send "Now turn that into a checklist"

# Read the current conversation
opencli chatgpt read --markdown true

# List recent visible conversations and read one by id or URL
opencli chatgpt history --limit 10
opencli chatgpt detail "https://chatgpt.com/c/<conversation-id>"

# Extract a completed Deep Research report
opencli chatgpt deep-research-result "https://chatgpt.com/c/<conversation-id>" --wait true --timeout 600

# Start a fresh chat
opencli chatgpt new

# Generate an image and save it to the default directory
opencli chatgpt image "a cyberpunk city at night"

# Switch ChatGPT's intelligence level
opencli chatgpt model fast
opencli chatgpt model balanced
opencli chatgpt model advanced
opencli chatgpt model very-high
opencli chatgpt model pro

# Upload a local image, ask ChatGPT to edit it, and save the result
opencli chatgpt image "make the background blue" --image ./cat.png

# Upload multiple local images for a combined edit
opencli chatgpt image "combine these into a poster" --image ./cat.png,./logo.png

# Save to a custom output directory
opencli chatgpt image "a robot sketching on paper" --op ~/Downloads/chatgpt-images

# Only generate in ChatGPT and print the conversation link
opencli chatgpt image "a tiny watercolor fox" --sd true
```

## Options

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send (required for `ask`, `send`, and `image`) |
| `--timeout` | Max seconds for `ask` to wait for a response (default: `120`) |
| `--wait` | For `deep-research-result`, wait until a Deep Research report completes or becomes extractable |
| `--stable` | For `deep-research-result`, seconds the report text must remain unchanged when waiting (default: `6`) |
| `--new` | Start a new conversation before `ask` / `send` |
| `--markdown` | Convert assistant message HTML to Markdown for `read` / `detail` |
| `--limit` | Max visible history conversations to return (default: `20`) |
| `--image` | Local image path to attach before prompting; comma-separated paths are supported |
| `--op` | Output directory for downloaded images (default: `~/Pictures/chatgpt`) |
| `--sd` | Skip download and only print the ChatGPT conversation link |
| `model` | ChatGPT intelligence level for `model`: `fast`, `balanced`, `advanced`, `very-high`, or `pro`; aliases include `speed`/`instant`, `balance`/`medium`, `high`/`thinking`, `ultra`/`xhigh`/`x-high`/`extra-high`, `professional`, and the Chinese labels `极速`/`均衡`/`高级`/`超高`/`专业` |

## Behavior

- ChatGPT web commands use persistent site sessions by default, so consecutive `ask` / `send` / `read` / `detail` commands continue in the same ChatGPT tab. Use `--site-session ephemeral` for one-shot isolated tabs.
- `ask` waits for the first stable assistant response after sending. `send` submits only and returns immediately.
- `history` reads visible `/c/<id>` links from the ChatGPT sidebar; it does not use private backend APIs.
- `deep-research-result` opens the requested conversation and extracts completed Deep Research output from that conversation's `/backend-api/conversation/<id>` payload, especially `metadata.chatgpt_sdk.widget_state.report_message`. It does not return a success row when no completed report is present.
- `model` switches the visible ChatGPT web intelligence level. It recognizes the current English labels (`Fast`, `Balanced`, `Advanced`, `Very High`, `Pro`), legacy labels (`Instant`, `Medium`, `High`, `Extra High`), and Chinese labels (`极速`, `均衡`, `高级`, `超高`, `专业`). Advanced and Pro first try ChatGPT's authenticated backend model preference update, then the adapter falls back to the visible picker for UI-only levels. If labels are localized differently, it only falls back to option order after confirming the guarded five-option ChatGPT intelligence picker structure.
- `image` opens a fresh `chatgpt.com/new` page before sending the image prompt.
- When `--image` is provided, local images are uploaded first and the prompt is sent as an image edit request.
- `image` output is plain `status / file / link`, not a markdown table.
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
