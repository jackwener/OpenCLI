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

## Custom Daemon Port

The default Browser Bridge port is `19825`.

For source builds, set `OPENCLI_DAEMON_PORT` before building the extension so the generated background service worker uses the same port as the CLI/daemon:

```bash
cd extension
OPENCLI_DAEMON_PORT=21350 npm run build
OPENCLI_DAEMON_PORT=21350 opencli doctor
```

For an already installed extension, open the OpenCLI extension popup, edit the **Port** field, and click **Save**. The saved extension port overrides the build-time value. Click **Reset** to fall back to the build-time value, or to `19825` when no build-time value is configured.

## Tab Targeting

Browser commands run inside the shared `browser:default` workspace unless you explicitly choose another tab target.

```bash
opencli browser open https://www.baidu.com/
opencli browser tab list
opencli browser tab new https://www.baidu.com/
opencli browser eval --tab <targetId> 'document.title'
opencli browser tab select <targetId>
opencli browser get title
opencli browser tab close <targetId>
```

Key rules:

- `opencli browser open <url>` and `opencli browser tab new [url]` return a `targetId`.
- `opencli browser tab list` prints the `targetId` values of tabs that already exist.
- `--tab <targetId>` routes a single browser command to that specific tab.
- `tab new` creates a new tab but does not change the default browser target.
- `tab select <targetId>` makes that tab the default target for later untargeted `opencli browser ...` commands.
- `tab close <targetId>` removes the tab; if it was the current default target, the stored default is cleared.

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
