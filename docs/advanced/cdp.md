# Connecting OpenCLI via CDP

If you cannot or do not want to use the opencli Browser Bridge extension, OpenCLI can also connect directly to a Chrome/Chromium debugging endpoint via **CDP (Chrome DevTools Protocol)**.

OpenCLI now provides a dedicated `browser` command group for this workflow, so you do not have to manage everything manually through environment variables and raw Chrome commands.

This guide covers two common modes:

1. **Local CDP browser managed by OpenCLI**
2. **Remote or headless CDP endpoint managed outside OpenCLI**

---

## Local CDP Workflow with `opencli browser`

For most local workflows, start with the built-in browser commands:

```bash
opencli browser launch --port 9222
opencli browser list
opencli browser doctor --backend cdp --cdp-endpoint http://127.0.0.1:9222 --live
opencli browser run --backend cdp --cdp-endpoint http://127.0.0.1:9222 -- zhihu search --keyword AI
opencli browser stop --port 9222
```

### Temporary vs Persistent Profiles

By default, `opencli browser launch` creates a **temporary profile**:

```bash
opencli browser launch --port 9222
```

If you want to preserve login state or browser data, use a named persistent profile:

```bash
opencli browser launch --port 9222 --profile zhihu
opencli browser profiles
```

You can later reuse the same profile on a different port:

```bash
opencli browser stop --port 9222
opencli browser launch --port 9339 --profile zhihu
```

### Managing Profiles

List persistent and temporary profiles:

```bash
opencli browser profiles
```

Remove a named persistent profile:

```bash
opencli browser profiles rm zhihu
```

Remove unused temporary profiles:

```bash
opencli browser profiles prune --temporary
```

### Passing Raw Chrome Flags

If you need additional native Chrome/Chromium launch flags, repeat `--browser-arg`:

```bash
opencli browser launch \
  --port 9222 \
  --profile zhihu \
  --browser-arg=--lang=en-US \
  --browser-arg=--window-size=1440,900
```

This is useful for window sizing, language overrides, proxies, and other Chromium flags that OpenCLI does not expose as first-class options.

---

## Remote or Headless CDP Endpoints

If Chrome is already running elsewhere and exposing a CDP endpoint, you can connect OpenCLI directly without using `opencli browser launch`.

Typical examples:

- a remote Linux server running headless Chrome
- a manually started local Chrome instance
- a tunneled CDP endpoint exposed through SSH or ngrok

You can either pass the endpoint explicitly:

```bash
opencli browser doctor --backend cdp --cdp-endpoint http://127.0.0.1:9222 --live
opencli browser run --backend cdp --cdp-endpoint http://127.0.0.1:9222 -- bilibili hot --limit 5
```

Or export it once:

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
opencli doctor
opencli bilibili hot --limit 5
```

> Tip: If you provide a standard HTTP/HTTPS CDP endpoint, OpenCLI requests the `/json` target list and picks the most likely inspectable app/page target automatically. If multiple targets exist, narrow selection with `OPENCLI_CDP_TARGET`.

---

## Exposing a Local CDP Port to a Remote Server

Because CDP binds to `localhost` by default, a remote machine usually cannot access it directly. Use one of these patterns if OpenCLI runs on a different machine than the browser.

### Method A: SSH Reverse Tunnel

Run this on your **local machine**:

```bash
ssh -R 9222:localhost:9222 your-server-user@your-server-ip
```

Then on the **remote server**:

```bash
export OPENCLI_CDP_ENDPOINT="http://localhost:9222"
opencli doctor
opencli bilibili hot --limit 5
```

### Method B: Reverse Proxy or Tunnel Tool

For example with `ngrok` on your **local machine**:

```bash
ngrok http 9222
```

Then on the **remote server**:

```bash
export OPENCLI_CDP_ENDPOINT="https://abcdef.ngrok.app"
opencli doctor
opencli bilibili hot --limit 5
```

> Note: Some Chrome versions may require `--remote-allow-origins="*"` when CDP is accessed through reverse proxies or other cross-origin WebSocket paths.

---

## Starting Chrome Manually

If you still prefer to start Chrome yourself instead of using `opencli browser launch`, these commands work.

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --remote-allow-origins="*"
```

**Linux**

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --remote-allow-origins="*"
```

**Windows**

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug-profile" ^
  --remote-allow-origins="*"
```

Once the browser is open, log into the target websites you want OpenCLI to reuse.

---

## Recommended Workflow

Use this order of operations for most CDP tasks:

1. Start or discover a CDP browser
2. Verify connectivity with `opencli browser doctor`
3. Run existing site commands through `opencli browser run`
4. Stop the browser with `opencli browser stop`
5. Manage profiles with `opencli browser profiles`

That keeps the CDP path explicit, inspectable, and scriptable for both humans and AI agents.
