# Troubleshooting

## Common Issues

### "Extension not connected"

- Ensure the opencli Browser Bridge extension is installed and **enabled** in `chrome://extensions`.
- Run `opencli doctor` to diagnose connectivity.

### Empty data or 'Unauthorized' error

- Your login session in Chrome might have expired. Open a normal Chrome tab, navigate to the target site, and log in or refresh the page.
- Some sites have geographic restrictions (e.g., Bilibili, Zhihu from outside China).

### Node API errors

- Make sure you are using **Node.js >= 20**. Some dependencies require modern Node APIs.
- Run `node --version` to verify.

### Daemon issues

```bash
# Check daemon status (PID, uptime, extension connection, memory)
opencli daemon status

# View extension logs
curl localhost:19825/logs

# Stop or restart the daemon
opencli daemon stop
opencli daemon restart

# Full diagnostics
opencli doctor
```

> The daemon auto-exits after 4 hours of inactivity (no CLI requests and no extension connection). Override with `OPENCLI_DAEMON_TIMEOUT` (milliseconds, `0` = never timeout).

### Desktop adapter connection issues

For Electron/CDP-based adapters (Cursor, Codex, etc.):

1. Make sure the app is launched with `--remote-debugging-port=XXXX`
2. Verify the endpoint is set: `echo $OPENCLI_CDP_ENDPOINT`
3. Test the endpoint: `curl http://127.0.0.1:XXXX/json/version`

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
- Run `opencli doctor` for comprehensive diagnostics
