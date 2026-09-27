# Remote Chrome

Run OpenCLI on a server or headless environment by connecting to a remote Chrome instance.

## Use Cases

- Running CLI commands on a remote server
- CI/CD automation with headed browser
- Shared team browser sessions

## Setup

### 1. Start Chrome on the Remote Machine

```bash
# On the remote machine (or your Mac)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```

### 2. SSH Tunnel (If Needed)

If the remote Chrome is on a different machine, create an SSH tunnel:

```bash
# On your local machine or server
ssh -L 9222:127.0.0.1:9222 user@remote-host
```

::: warning
Use `127.0.0.1` instead of `localhost` in the SSH command to avoid IPv6 resolution issues that can cause timeouts.
:::

### 3. Configure OpenCLI

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
```

With the endpoint set, website CLIs (e.g. `opencli twitter timeline`) run over CDP
directly — the Browser Bridge extension is not required in this mode. Each command
opens a **dedicated tab** on the remote browser and closes it when done, so your
existing tabs are never hijacked. Electron app CLIs honor the same variable as before.

::: tip
The endpoint may also be a `ws://` URL pointing at a specific target. In that case
OpenCLI attaches to that exact target instead of opening a dedicated tab
(`OPENCLI_CDP_TARGET` filters targets when using an `http://` endpoint without a
dedicated tab, e.g. for Electron apps).
:::

#### Dedicated tab lifecycle

| Situation | What happens to the tab |
| --- | --- |
| Command finishes (default, `--site-session ephemeral`) | Closed |
| `--keep-tab true`, or `--site-session persistent` (which implies keep-tab) | Left open |
| WebSocket handshake or CDP setup fails | Closed, even with `--keep-tab true` — nothing ever attached to it |
| Command fails mid-run (navigation error, adapter throw) | Closed, unless keep-tab applies |

A kept tab is **not** reused by the next command: each command opens its own tab.
Nothing is lost by that — cookies and login state live in the shared Chrome profile,
not in the tab — so a persistent site session still sees the same logged-in state.
Keep-tab is there for inspecting what a command did, not for session continuity.


### 4. Verify

```bash
# Test the connection
curl http://127.0.0.1:9222/json/version

# Run a diagnostic
opencli doctor
```

## CI/CD Integration

For CI/CD environments, use a real Chrome instance with `xvfb`:

::: v-pre
```yaml
steps:
  - uses: browser-actions/setup-chrome@latest
    id: setup-chrome
  - run: |
      xvfb-run --auto-servernum \
        ${{ steps.setup-chrome.outputs.chrome-path }} \
        --remote-debugging-port=9222 &
```
:::
