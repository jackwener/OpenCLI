# ChatGPT

Control the **ChatGPT Desktop App** from the terminal. OpenCLI currently supports two different automation paths for ChatGPT.

## Mode 1: AppleScript fallback on macOS

If `OPENCLI_CDP_ENDPOINT` is **not** set, the built-in ChatGPT adapter uses the original macOS-native AppleScript / Accessibility flow.

### Prerequisites
1. Install the official [ChatGPT desktop app](https://openai.com/chatgpt/download/).
2. Grant **Accessibility permissions** to your terminal app in **System Settings → Privacy & Security → Accessibility**.

### Commands that use AppleScript today
- `opencli chatgpt status`
- `opencli chatgpt new`
- `opencli chatgpt send "message"`
- `opencli chatgpt read`
- `opencli chatgpt ask "message"`

Notes for the AppleScript path:
- `read` returns the **last visible message** from the focused ChatGPT window via the macOS Accessibility tree.
- `ask` is still the old **send + wait + read** AppleScript flow.

## Mode 2: Experimental CDP path

If `OPENCLI_CDP_ENDPOINT` **is** set, OpenCLI switches `chatgpt status`, `chatgpt read`, `chatgpt reasoning`, and `chatgpt send` to a Chrome DevTools Protocol (CDP) path instead of AppleScript.

This is the current experimental path for:

- **Windows / WSL**
- **macOS with ChatGPT launched in remote-debug mode**

### What works today in CDP mode
- `opencli chatgpt status`
- `opencli chatgpt read`
- `opencli chatgpt reasoning`
- `opencli chatgpt reasoning pro`
- `opencli chatgpt send "message"` *(async submit: returns immediately with `Status=Submitted`)*
- `opencli chatgpt send --reasoning pro "solve this carefully"`

### What is still out of scope / not promised in CDP mode
- `opencli chatgpt new`
- `opencli chatgpt ask`
- shortcut-heavy flows like search/new-tab style actions

Those still rely on the older macOS AppleScript path.

## Experimental CDP setup

### macOS example

```bash
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --remote-debugging-port=9224

export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
# Optional but useful when multiple targets exist:
export OPENCLI_CDP_TARGET="chatgpt"
```

### Windows / WSL example

The exact executable path can vary, but the important part is:

1. **Fully quit ChatGPT first**
2. launch the real Windows app with:

```powershell
ChatGPT.exe --remote-debugging-port=9224 --remote-debugging-address=127.0.0.1
```

3. then from WSL (or from the same machine if you are not using WSL):

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
export OPENCLI_CDP_TARGET="chatgpt"   # optional but recommended
```

> On Windows, a **true cold launch matters**. If ChatGPT is already running, relaunch attempts with debug flags can fail misleadingly and expose no usable `/json` endpoint.

## Exact commands that now work in experimental CDP mode

```bash
opencli chatgpt status
opencli chatgpt read
opencli chatgpt reasoning
opencli chatgpt reasoning pro
opencli chatgpt send "hello from opencli"
opencli chatgpt send --reasoning pro "solve this carefully"
```

## Recommended async flow for Pro / research tasks

For long-running tasks, treat `send` as a **submit-only** step:

```bash
opencli chatgpt send --reasoning pro "Research this carefully and take your time"
# returns immediately with Status=Submitted after the prompt is submitted

opencli chatgpt status
# optional: Busy=Yes means ChatGPT is still working

opencli chatgpt read
# later, fetch the current visible output
```

This is the intended product shape for the current ChatGPT desktop path: **submit now, read later**.

### `opencli chatgpt status`
Checks the active CDP target and reports useful session state such as:

- current URL
- current title
- visible turn count
- whether the composer looks ready
- currently detected reasoning mode when the top-level picker can be read
- whether ChatGPT appears busy / still generating

### `opencli chatgpt read`
Extracts visible conversation content from the current ChatGPT window in a narrow but real DOM-based way.

This is the intended follow-up command after an async `opencli chatgpt send ...`.

### `opencli chatgpt send "message"`
Finds the active composer, injects your prompt, submits it, and then **returns immediately**.

It does **not** wait for the assistant to finish a reply. `Status=Submitted` means OpenCLI injected the prompt and triggered submit — not that ChatGPT finished answering.

If you pass `--reasoning <mode>`, OpenCLI first tries to switch the **top-level** ChatGPT picker to `instant`, `thinking`, or `pro` before sending. `auto` is accepted as an alias for `instant`.

### `opencli chatgpt reasoning [mode]`
Reads the current top-level ChatGPT reasoning mode when possible, or switches it when you pass `instant`, `thinking`, or `pro`.

Important scope note:
- this targets the **top-level header picker** only
- it does **not** target reply-level retry/model-switch controls
- it does **not** yet control Light / Standard / Extended / Heavy thinking-time options

## How it works

- **AppleScript mode**: uses `osascript`, clipboard transfer, and macOS Accessibility.
- **CDP mode**: attaches directly to the ChatGPT Electron renderer process and reads / manipulates DOM state.

## Limitations

- The CDP path is still **experimental** and intentionally narrow.
- Only `status`, `read`, `reasoning`, and `send` are currently implemented for the experimental Windows/WSL path.
- `send` is intentionally submit-only / async for this path. If you want output, call `read` separately later.
- `reasoning` currently targets only the top-level `Instant` / `Thinking` / `Pro` picker. It does **not** yet control Light / Standard / Extended / Heavy thinking-time options.
- `new` and `ask` should still be treated as **macOS AppleScript-only** commands.
- If multiple inspectable targets exist, set `OPENCLI_CDP_TARGET=chatgpt` (or another window-title fragment).
- DOM selectors may drift as ChatGPT desktop changes.
- In experimental CDP mode, `send` intentionally refuses to overwrite an existing draft already sitting in the composer.
- On current Windows desktop builds, some long-running `send --reasoning pro` requests can remain in a busy / partially rendered state for minutes before the final answer settles. OpenCLI tries to report that state honestly via `status` / `read`, but it cannot force the ChatGPT app to finalize the response.
