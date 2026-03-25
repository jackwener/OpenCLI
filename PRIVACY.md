# Privacy Policy — OpenCLI Browser Extension

**Last updated**: 2026-03-25

## What the extension does

The OpenCLI Browser Extension is a bridge between the [OpenCLI](https://github.com/jackwener/opencli) command-line tool and your Chrome browser. It receives commands from a **locally running daemon** process via WebSocket (`localhost` only) and executes them in **isolated Chrome windows** that are separate from your normal browsing session.

## Data collection

The extension does **NOT** collect, store, transmit, or sell any personal data. Specifically:

- **No analytics or telemetry** — no data is sent to any remote server.
- **No user tracking** — no cookies, identifiers, or fingerprints are created.
- **No external network requests** — all communication is strictly `localhost` (WebSocket to `ws://localhost:19825`).

## Permissions explained

| Permission | Why it's needed |
|------------|----------------|
| `debugger` | Required to use Chrome DevTools Protocol (CDP) for browser automation — executing JavaScript, capturing page content, and taking screenshots in isolated windows. |
| `tabs` | Required to create and manage isolated automation windows and tabs, separate from the user's browsing session. |
| `cookies` | Required to read site-specific cookies (scoped by domain) so CLI commands can authenticate with websites the user is already logged into. Cookies are **never written, modified, or transmitted externally**. |
| `activeTab` | Required to identify the currently active tab for context-aware commands. |
| `alarms` | Required to maintain the WebSocket connection to the local daemon via periodic keepalive checks. |

## Data flow

```
User's terminal (opencli CLI)
    ↓ (spawns)
Local daemon process (localhost:19825)
    ↓ (WebSocket, localhost only)
Chrome Extension (this extension)
    ↓ (Chrome APIs)
Isolated Chrome automation window
```

All data stays on the user's machine. No data leaves `localhost`.

## Cookie access

The extension reads cookies **only** when explicitly requested by a CLI command, and **only** for the specific domain the command targets. It cannot and does not dump all cookies. Cookie data is returned to the local daemon process and is never sent to any external server.

## Third-party services

This extension does not integrate with, send data to, or receive data from any third-party service.

## Open source

This extension is fully open source. You can audit the complete source code at:
https://github.com/jackwener/opencli/tree/main/extension

## Contact

For privacy questions or concerns, please open an issue at:
https://github.com/jackwener/opencli/issues
