# Browser Bridge Setup

> **⚠️ Important**: Browser commands reuse your Chrome login session. You must be logged into the target website in Chrome before running commands.

OpenCLI connects to your browser through a lightweight **Browser Bridge** Chrome Extension + micro-daemon (zero config, auto-start).

## Extension Installation

### Method 1: Download Pre-built Release (Recommended)

1. Go to the GitHub [Releases page](https://github.com/jackwener/opencli/releases) and download the latest `opencli-extension-v{version}.zip`.
2. Unzip the file and open `chrome://extensions`, enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the unzipped folder.

### Method 2: Load Unpacked Source (For Developers)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory from the repository.

## Verification

That's it! The daemon auto-starts when you run any browser command. No tokens, no manual configuration.

```bash
opencli doctor            # Check extension + daemon connectivity
```

## Tab Targeting

Browser commands require an explicit `<session>` positional immediately after `browser`. Use the same session name for a multi-step flow, and use different names to isolate parallel work.

```bash
opencli browser baidu open https://www.baidu.com/
opencli browser baidu tab list
opencli browser baidu tab new https://www.baidu.com/
opencli browser baidu eval --tab <targetId> 'document.title'
opencli browser baidu tab select <targetId>
opencli browser baidu get title
opencli browser baidu tab close <targetId>
```

Key rules:

- `opencli browser <session> open <url>` and `opencli browser <session> tab new [url]` return a `targetId`.
- `opencli browser <session> tab list` prints the `targetId` values of tabs that already exist.
- `--tab <targetId>` routes a single browser command to that specific tab.
- `tab new` creates a new tab but does not change the default browser target.
- `tab select <targetId>` makes that tab the default target for later untargeted `opencli browser ...` commands.
- `tab close <targetId>` removes the tab; if it was the current default target, the stored default is cleared.

## Session Lifecycle

Use a stable session name when you want multiple `opencli browser` commands to keep operating on the same page:

```bash
opencli browser my-session open https://example.com
opencli browser my-session state
opencli browser my-session extract "main"
```

Owned browser sessions use an interactive tab lease with a 10-minute idle timeout. Release it explicitly when done:

```bash
opencli browser my-session close
```

Use `opencli browser <session> bind` when you want to attach OpenCLI to a Chrome tab you already opened manually. Bound sessions do not have the owned-session idle close timer; they stay attached until `unbind`, tab close, window close, or daemon restart. For owned sessions, use `--window foreground` to watch OpenCLI work in a visible automation window, or `--window background` to keep that automation window out of the way.

## How It Works

```
┌─────────────┐     WebSocket      ┌──────────────┐     Chrome API     ┌─────────┐
│  opencli    │ ◄──────────────► │  micro-daemon │ ◄──────────────► │  Chrome  │
│  (Node.js)  │    localhost:19825  │  (auto-start) │    Extension       │ Browser  │
└─────────────┘                    └──────────────┘                    └─────────┘
```

The daemon manages the WebSocket connection between your CLI commands and the Chrome extension. The extension executes JavaScript in the context of web pages, with access to the logged-in session.

## Daemon Lifecycle

The daemon auto-starts on first browser command and stays alive persistently.

```bash
opencli daemon stop      # Graceful shutdown
```

The daemon is persistent — it stays alive until you explicitly stop it (`opencli daemon stop`) or uninstall the package.

## Running OpenCLI from a remote machine

If you need to run `opencli` on a remote server (CI runner, agent host) but keep the browser session on your local machine, see [Remote Orchestration](/guide/remote-orchestration). It walks through the SSH reverse-tunnel pattern so the daemon never leaves localhost.
