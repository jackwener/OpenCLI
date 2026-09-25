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

## Browser Bridge on a headless VPS (Xvfb)

The CI snippet above covers the Electron `--remote-debugging-port` path, where OpenCLI connects to Chrome through CDP. The OpenCLI **Browser Bridge extension** flow is different: it relies on Chrome's MV3 service worker, which never reliably wakes when Chrome is launched with `--headless=new` on a server with no X display. The fix is to give Chrome a real (virtual) display via Xvfb instead of running it headless.

::: tip
If you see `[MISSING] Extension: not connected` from `opencli doctor` and your only way to make it work today is to VNC in and start Chrome by hand, this is the setup you want.
:::

### Why `--headless=new` is not enough

With `chromium --headless=new --load-extension=...` on a no-display VPS, the Browser Bridge extension's service worker never registers a connection — `opencli doctor` stays stuck on `Extension: not connected` indefinitely, and the extension does not appear in `chrome://inspect`. Pointing Chrome at a real-looking display through Xvfb restores the normal extension service-worker lifecycle, the same way an interactive VNC session would.

### Setup

```bash
sudo apt install -y xvfb chromium
```

Then, in your VPS startup script (systemd unit, docker-compose, etc.):

```bash
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
export DISPLAY=:99

chromium \
  --no-sandbox \
  --user-data-dir=/var/opencli/chrome-profile \
  --load-extension=/path/to/opencli-extension \
  --disable-extensions-except=/path/to/opencli-extension \
  --no-first-run \
  about:blank &
```

After that `opencli doctor` should report `[OK] Extension: connected`.

::: warning
Use the explicit `Xvfb :99 + export DISPLAY=:99 + chromium &` form. The `xvfb-run google-chrome` wrapper does not reliably propagate `DISPLAY` to a backgrounded Chrome process, so the extension may still fail to connect.
:::

Verified against Chromium 148 + opencli 1.8.0 on Ubuntu 24.04 in [issue #1700](https://github.com/jackwener/OpenCLI/issues/1700).
