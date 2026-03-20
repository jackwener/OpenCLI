# Troubleshooting

## Common Issues

### "Extension not connected"

- Ensure the opencli Browser Bridge extension is installed and **enabled** in `chrome://extensions`.
- Run `opencli doctor` to diagnose connectivity.

If you want to bypass extension mode entirely, use direct CDP mode instead:

```bash
opencli browser launch --port 9222
opencli browser doctor --backend cdp --cdp-endpoint http://127.0.0.1:9222 --live
```

### Empty data or 'Unauthorized' error

- Your login session in Chrome might have expired. Open a normal Chrome tab, navigate to the target site, and log in or refresh the page.
- Some sites have geographic restrictions (e.g., Bilibili, Zhihu from outside China).

### Node API errors

- Make sure you are using **Node.js >= 20**. Some dependencies require modern Node APIs.
- Run `node --version` to verify.

### Daemon issues

```bash
# Check daemon status
curl localhost:19825/status

# View extension logs
curl localhost:19825/logs

# Kill and restart daemon
pkill -f opencli-daemon
opencli doctor
```

### Desktop adapter connection issues

For Electron/CDP-based adapters (Cursor, Codex, etc.):

1. Make sure the app is launched with `--remote-debugging-port=XXXX`
2. Verify the endpoint is set: `echo $OPENCLI_CDP_ENDPOINT`
3. Test the endpoint: `curl http://127.0.0.1:XXXX/json/version`

### CDP browser management issues

If you are using the `opencli browser` command group, these commands should be your first checks:

```bash
opencli browser list
opencli browser profiles
opencli browser doctor --backend cdp --cdp-endpoint http://127.0.0.1:9222 --live
```

Common recovery steps:

```bash
# Stop a stuck opencli-managed browser
opencli browser stop --port 9222

# Remove an unused persistent profile
opencli browser profiles rm zhihu

# Remove unused temporary profiles
opencli browser profiles prune --temporary
```

If you need non-standard Chromium flags, pass them through launch:

```bash
opencli browser launch --port 9222 --browser-arg=--window-size=1440,900
```

### Build errors

```bash
# Clean rebuild
rm -rf dist/
npm run build

# Type check
npx tsc --noEmit
```

## Getting Help

- [GitHub Issues](https://github.com/jackwener/opencli/issues) — Bug reports and feature requests
- Run `opencli doctor --live` for comprehensive diagnostics
