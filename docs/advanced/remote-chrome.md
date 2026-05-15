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

## Browserbase Cloud Browser

[Browserbase](https://browserbase.com) provides managed cloud browsers with proxy support, persistent login contexts, and stealth mode. OpenCLI consumes an existing Browserbase session; create and manage sessions with the `bb` CLI.

```bash
export BROWSERBASE_API_KEY=your_key
export BROWSERBASE_PROJECT_ID=your_project_id

# Create a session with the Browserbase CLI.
bb sessions create --json
```

Run adapter browser commands with either the root `--session` flag or `BROWSERBASE_SESSION_ID`:

```bash
opencli --session <session-id> reddit get-comments <post-id> --limit 5

export BROWSERBASE_SESSION_ID=<session-id>
opencli bilibili comments BV1xxx --limit 5
```

For parallel work, create multiple Browserbase sessions and pass each one to a separate OpenCLI process:

```bash
S1=$(bb sessions create --proxy us --json | jq -r .id)
S2=$(bb sessions create --proxy jp --json | jq -r .id)

opencli --session "$S1" reddit get-comments <post-id> &
opencli --session "$S2" bilibili comments BV1xxx &
wait
```

Session selection priority for adapter browser commands is `--session`, then `BROWSERBASE_SESSION_ID`, then `OPENCLI_CDP_ENDPOINT`, then local Browser Bridge.

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
