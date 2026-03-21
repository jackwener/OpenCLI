# ChatGPT

Control the **ChatGPT Desktop App** from the terminal.

OpenCLI now keeps ChatGPT automation split by **target surface** so new Windows support stays additive and the long-standing macOS behavior stays intact.

## Surface 1: `macos-native` (default)

This is the original built-in path. If you run `opencli chatgpt ...` with no `--surface` flag, OpenCLI keeps using native macOS automation via AppleScript + Accessibility.

### Prerequisites
1. Install the official [ChatGPT desktop app](https://openai.com/chatgpt/download/).
2. Grant **Accessibility permissions** to your terminal app in **System Settings → Privacy & Security → Accessibility**.

### Commands on `macos-native`
- `opencli chatgpt status`
- `opencli chatgpt new`
- `opencli chatgpt send "message"`
- `opencli chatgpt read`
- `opencli chatgpt ask "message"`

### Notes
- `read` returns the **last visible message** from the focused ChatGPT window via the macOS Accessibility tree.
- `ask` remains the original **send + wait + read** macOS-only flow.

## Surface 2: `macos-cdp` (experimental)

This preserves the existing documented idea of a **ChatGPT mac CDP mode**, but makes it explicit instead of automatic.

Use it only on the commands that currently support the narrow CDP path:

- `opencli chatgpt status --surface macos-cdp`
- `opencli chatgpt read --surface macos-cdp`
- `opencli chatgpt send --surface macos-cdp "message"`

## Surface 3: `windows-cdp` (experimental)

This is the new additive surface for the **Windows ChatGPT desktop app**, including WSL workflows that control the Windows app over a local CDP endpoint.

Use it on the same narrow command subset:

- `opencli chatgpt status --surface windows-cdp`
- `opencli chatgpt read --surface windows-cdp`
- `opencli chatgpt send --surface windows-cdp "message"`

> **Important:** OpenCLI does **not** switch ChatGPT into CDP mode automatically just because `OPENCLI_CDP_ENDPOINT` is set. You must opt in per command with `--surface macos-cdp` or `--surface windows-cdp`.

## CDP setup

### macOS example

```bash
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --remote-debugging-port=9224

export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
# Optional but recommended when multiple targets exist:
export OPENCLI_CDP_TARGET="chatgpt"
```

### Windows / WSL example

Fully quit ChatGPT first, then launch the real Windows app with a debugging port:

```powershell
ChatGPT.exe --remote-debugging-port=9224 --remote-debugging-address=127.0.0.1
```

Then from WSL or the same Windows machine:

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
export OPENCLI_CDP_TARGET="chatgpt"   # optional but recommended
```

> On Windows, a **true cold launch matters**. If ChatGPT is already running, relaunching with debug flags may leave you with no usable `/json` target list.

## Command support matrix

| Command | `macos-native` | `macos-cdp` | `windows-cdp` |
|---------|-----------------|-------------|---------------|
| `status` | ✅ | ✅ | ✅ |
| `new` | ✅ | — | — |
| `send` | ✅ | ✅ | ✅ |
| `read` | ✅ | ✅ | ✅ |
| `ask` | ✅ | — | — |

## How the CDP path behaves today

The current CDP implementation is intentionally narrow:

- `status` attaches to the selected ChatGPT target and reports connection state
- `read` returns the **last visible conversation turn** from the current ChatGPT window
- `send` injects the prompt into the active composer and submits it
- the CDP `send` path returns after submission; use `read` later if you want the latest visible output

## Limitations

- `new` and `ask` remain **macOS-native only**.
- CDP support is intentionally limited to `status`, `read`, and `send`.
- If multiple inspectable targets exist, set `OPENCLI_CDP_TARGET=chatgpt`.
- `send` in CDP mode refuses to overwrite an existing draft already sitting in the composer.
- `read` only returns the **last visible** conversation turn, not a full export.
- DOM selectors may drift as ChatGPT desktop changes.
