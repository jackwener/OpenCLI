# Connecting OpenCLI via CDP (Remote/Headless Servers)

If you cannot use the opencli Browser Bridge extension (e.g., in a remote headless server environment without a UI), OpenCLI provides an alternative: connecting directly to Chrome via **CDP (Chrome DevTools Protocol)**.

Because CDP binds to `localhost` by default for security reasons, accessing it from a remote server requires an additional networking tunnel.

This guide is broken down into three phases:
1. **Preparation**: Start Chrome with CDP enabled locally.
2. **Network Tunnels**: Expose that CDP port to your remote server using either **SSH Tunnels** or **Reverse Proxies**.
3. **Execution**: Run OpenCLI on your server.

---

## Phase 1: Preparation (Local Machine)

First, you need to start a Chrome browser on your local machine with remote debugging enabled.

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --remote-allow-origins="*"
```

**Linux:**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --remote-allow-origins="*"
```

**Windows:**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug-profile" ^
  --remote-allow-origins="*"
```

> **Note**: The `--remote-allow-origins="*"` flag is often required for modern Chrome versions to accept cross-origin CDP WebSocket connections (e.g. from reverse proxies like ngrok).

Once this browser instance opens, **log into the target websites you want to use** (e.g., bilibili.com, zhihu.com) so that the session contains the correct cookies.

---

## Phase 2: Remote Access Methods

Once CDP is running locally on port `9222`, you must securely expose this port to your remote server. Choose one of the two methods below depending on your network conditions.

### Method A: SSH Tunnel (Recommended)

If your local machine has SSH access to the remote server, this is the most secure and straightforward method.

Run this command on your **Local Machine** to forward the remote server's port `9222` back to your local port `9222`:

```bash
ssh -R 9222:localhost:9222 your-server-user@your-server-ip
```

Leave this SSH session running in the background.

### Method B: Reverse Proxy (ngrok / frp / socat)

If you cannot establish a direct SSH connection (e.g., due to NAT or firewalls), you can use an intranet penetration tool like `ngrok`.

Run this command on your **Local Machine** to expose your local port `9222` to the public internet securely via ngrok:

```bash
ngrok http 9222
```

This will print a forwarding URL, such as `https://abcdef.ngrok.app`. **Copy this URL**.

---

## Phase 3: Execution (Remote Server)

Now switch to your **Remote Server** where OpenCLI is installed. 

Depending on the network tunnel method you chose in Phase 2, set the `OPENCLI_CDP_ENDPOINT` environment variable and run your commands.

### If you used Method A (SSH Tunnel):

```bash
export OPENCLI_CDP_ENDPOINT="http://localhost:9222"
opencli doctor                    # Verify connection
opencli bilibili hot --limit 5    # Test a command
```

### If you used Method B (Reverse Proxy like ngrok):

```bash
# Use the URL you copied from ngrok earlier
export OPENCLI_CDP_ENDPOINT="https://abcdef.ngrok.app"
opencli doctor                    # Verify connection
opencli bilibili hot --limit 5    # Test a command
```

> *Tip: If you provide a standard HTTP/HTTPS CDP endpoint, OpenCLI requests the `/json` target list and picks the most likely inspectable app/page target automatically. If multiple app targets exist, you can further narrow selection with `OPENCLI_CDP_TARGET` (for example `antigravity` or `codex`).*

If you plan to use this setup frequently, you can persist the environment variable by adding the `export` line to your `~/.bashrc` or `~/.zshrc` on the server.
