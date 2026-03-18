# Connecting OpenCLI via CDP (Remote/Headless Servers)

If you cannot use the Playwright MCP Bridge extension (e.g., in a remote headless server environment without a UI), OpenCLI provides an alternative: connecting directly to Chrome via **CDP (Chrome DevTools Protocol)**.

Because CDP binds to `localhost` by default for security reasons, accessing it from a remote server requires an additional networking step. This guide explains how to:
1. Start Chrome with CDP enabled.
2. Expose that CDP port to your remote server using either **SSH Tunnels** or **Reverse Proxies**.

## Method 1: SSH Tunnel (Port Forwarding)

This is the simplest method if you have SSH access to your server.

### Step 1: Start Chrome with Remote Debugging (Local Machine)

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug-profile"
```

**Windows:**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug-profile"
```

### Step 2: Log Into Target Websites

Open the new Chrome instance and log into the websites you want to use (e.g., bilibili.com, zhihu.com) so that the session has the correct cookies.

---

## Remote Access Methods

Once CDP is running locally, you must securely expose port 9222 to your remote server. Choose one of the two methods below.

### Method 1: SSH Tunnel (Recommended)

Forward the debugging port to your remote server:

```bash
ssh -R 9222:localhost:9222 your-server
```

### Step 4: Run OpenCLI on the Server

On your server, set the environment variable and run OpenCLI:

```bash
export OPENCLI_CDP_ENDPOINT="http://localhost:9222"
opencli doctor                    # Verify connection
opencli bilibili hot --limit 5    # Test a command
```

## Method 2: Reverse Proxy (ngrok / frp / socat)

If you cannot use SSH port forwarding, you can expose your local CDP port using an intranet penetration or reverse proxy tool like `ngrok`, `frp`, or `socat`.

### Using ngrok

1. Start Chrome with remote debugging on port 9222 (see Step 1 above).
2. Run ngrok on your local machine to expose the port:
   ```bash
   ngrok http 9222
   ```
3. Copy the generated ngrok URL (e.g., `https://abcdef.ngrok.app`).
4. On your server, use this URL as the CDP endpoint:
   ```bash
   export OPENCLI_CDP_ENDPOINT="https://abcdef.ngrok.app"
   opencli bilibili hot
   ```
   *Note: Playwright supports passing an HTTP endpoint directly. It will automatically fetch `/json/version` to discover the underlying WebSocket connection URL.*
