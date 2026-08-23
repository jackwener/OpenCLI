# Privacy Policy — OpenCLI Browser Extension

**Last updated**: 2026-08-24

## What the extension does

The OpenCLI Browser Extension is a bridge between the [OpenCLI](https://github.com/jackwener/opencli) command-line tool and your Chrome browser. Chrome parents a **local native host** via Native Messaging. The host muxes CLI commands from a unix socket onto that port. The extension executes them with `chrome.debugger`.

## Data collection

The extension does **NOT** collect, store, transmit, or sell any personal data. Specifically:

- **No analytics or telemetry** — no data is sent to any remote server.
- **No user tracking** — no cookies, identifiers, or fingerprints are created.
- **No external network requests for control** — the control plane is Native Messaging stdio plus a per-user unix socket under `~/.opencli/run/`.

## Permissions explained

| Permission | Why it's needed |
|------------|----------------|
| `debugger` | Required to use Chrome DevTools Protocol (CDP) for browser automation — executing JavaScript, capturing page content, and taking screenshots. |
| `tabs` | Required to create and manage automation windows and tabs. |
| `cookies` | Required to read site-specific cookies (scoped by domain) so CLI commands can authenticate with websites the user is already logged into. Cookies are **never written, modified, or transmitted externally**. |
| `activeTab` | Required to identify the currently active tab for context-aware commands. |
| `alarms` | Required to reconnect Native Messaging if Chrome closes the port, and for session idle timers. |
| `nativeMessaging` | Required so Chrome can spawn and keep the OpenCLI native host. The CLI never listens on a TCP port. |

## Data flow

```
User's terminal (opencli CLI)
    ↓ unix socket  ~/.opencli/run/host-<profile>.sock
Local native host (spawned by Chrome)
    ↓ Native Messaging stdio
Chrome Extension (this extension)
    ↓ chrome.debugger
Chrome tab
```

All control-plane data stays on the user's machine. No data leaves the local host.
