# Using OpenCLI with Android Chrome

OpenCLI can control Chrome on a connected Android device via **ADB port forwarding** and **CDPBridge** — no extra tools or custom builds required. The same adapters that run on desktop Chrome work identically on Android, reusing whatever cookies are already in the mobile browser.

---

## How It Works

Android Chrome supports [remote debugging via CDP](https://developer.chrome.com/docs/devtools/remote-debugging/). The device exposes a local Unix socket that ADB can forward to a TCP port on your machine. OpenCLI's `CDPBridge` then connects to that port exactly as it would to any other CDP endpoint.

```
OpenCLI (CDPBridge)
    │  WebSocket (CDP)
    ▼
localhost:9222                ← ADB forward
    │  adb forward
    ▼
Android device
  chrome_devtools_remote      ← Chrome's Unix debug socket
```

No Chrome extension, no daemon process — just a direct CDP WebSocket connection.

---

## Prerequisites

**On the Android device:**
1. Settings → About Phone → tap **Build Number** 7 times to enable Developer Options
2. Settings → Developer Options → enable **USB Debugging**
3. In Chrome for Android, open `chrome://flags`, search for `DevTools remote debugging`, and enable it (Chrome 119+). On older versions this is on by default when USB debugging is active.

**On your machine:**
- [Android Debug Bridge (ADB)](https://developer.android.com/tools/adb) installed and on `$PATH`
- OpenCLI installed (`npm install -g opencli`)

---

## Step-by-Step Setup

### 1. Connect the device

```bash
adb devices
```

Expected output:
```
List of devices attached
R5CT443TRDM    device
```

If the device shows as `unauthorized`, check for a "Allow USB Debugging?" prompt on the phone and tap **Allow**.

### 2. Forward the CDP port

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

### 3. Verify the connection

```bash
curl http://localhost:9222/json
```

A successful response lists the open tabs:
```json
[
  {
    "id": "3941",
    "title": "Hacker News",
    "type": "page",
    "url": "https://news.ycombinator.com",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/3941"
  }
]
```

### 4. Run any OpenCLI command

```bash
export OPENCLI_CDP_ENDPOINT=http://localhost:9222
opencli hackernews top --limit 5
```

---

## Targeting a Specific Tab

When multiple tabs are open, `CDPBridge` picks the best one automatically using a scoring algorithm (prefer `type=page`, real URLs over `about:blank`, etc.). To override this, set `OPENCLI_CDP_TARGET` to a substring of the tab's title or URL:

```bash
OPENCLI_CDP_TARGET="twitter" opencli twitter trending
```

You can also connect directly to a specific tab's WebSocket URL (from `/json`):

```bash
OPENCLI_CDP_ENDPOINT=ws://localhost:9222/devtools/page/3941 opencli ...
```

---

## Using Login-Required Adapters

Adapters that use the `cookie` strategy (most social/content sites) need you to be logged in on the Android device. The cookies are already in Android Chrome — OpenCLI reads them automatically over CDP.

To check whether an adapter requires login:

```bash
opencli zhihu hot --help
# Strategy: cookie | Browser: yes | Domain: www.zhihu.com
```

If you see `Strategy: cookie`, log into the site on the phone first, then run the command.

---

## Teardown

Remove the port forward when done:

```bash
adb forward --remove tcp:9222
# or remove all forwards:
adb forward --remove-all
```

---

## Differences from Desktop Chrome

| Feature | Desktop Chrome (BrowserBridge) | Android Chrome (CDPBridge) |
|---------|-------------------------------|---------------------------|
| Chrome extension required | Yes | No |
| Daemon process | Yes (auto-started) | No |
| Multi-tab management | Full (`tabs`, `selectTab`) | Not supported |
| Cookie session | Desktop browser's cookies | Android browser's cookies |
| Touch events | N/A | Not needed (CDP uses DOM events) |
| Concurrent devices | N/A | Use different local ports per device |

---

## Multiple Devices

To connect to more than one Android device simultaneously, assign each a different local port:

```bash
# Device 1
adb -s <device1-serial> forward tcp:9222 localabstract:chrome_devtools_remote

# Device 2
adb -s <device2-serial> forward tcp:9223 localabstract:chrome_devtools_remote

# Run commands targeting each device
OPENCLI_CDP_ENDPOINT=http://localhost:9222 opencli twitter trending
OPENCLI_CDP_ENDPOINT=http://localhost:9223 opencli twitter trending
```

---

## Troubleshooting

**`adb devices` shows nothing**
- Check USB cable (data cable, not charge-only)
- Revoke USB debugging authorizations on the device and re-approve

**`curl http://localhost:9222/json` returns empty array `[]`**
- Chrome for Android is not open, or has no visible tabs — open a tab and retry
- Remote debugging flag in `chrome://flags` may be disabled

**`curl http://localhost:9222/json` returns connection refused**
- Port forward may have dropped (happens after device screen lock on some ROMs) — re-run `adb forward`

**Adapter returns `(no data)` despite a working connection**
- The site's API requires authentication: log into the site in Android Chrome first
- Confirm with `--verbose` to see which pipeline step returns 0 items
