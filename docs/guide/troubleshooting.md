# Troubleshooting

## Common Issues

### "Extension not connected"

- Ensure the opencli Browser Bridge extension is installed and **enabled** in `chrome://extensions`.
- Run `opencli doctor` to diagnose connectivity.

### Empty data or 'Unauthorized' error

- Your login session in Chrome might have expired. Open a normal Chrome tab, navigate to the target site, and log in or refresh the page.
- Some sites have geographic restrictions (e.g., Bilibili, Zhihu from outside China).

### Browser command opens the page but still cannot read context

- A healthy Browser Bridge connection does not guarantee that the current page target exposes the data your adapter expects.
- Some browser adapters are sensitive to the active host or page context.
- Example: `opencli 1688 item` may fail with `did not expose product context` if the target is too broad.
- Retry on a real item page, refresh the page in Chrome, and if needed narrow the target, for example:

```bash
OPENCLI_CDP_TARGET=detail.1688.com opencli 1688 item 841141931191 -f json
```

### Node API errors

- Make sure you are using **Node.js >= 21**. Some features require `node:util` styleText (stable in Node 21+).
- Run `node --version` to verify.

### Daemon issues

```bash
# Stop the daemon
opencli daemon stop

# Full diagnostics
opencli doctor
```

> The daemon is persistent and stays alive until explicitly stopped (`opencli daemon stop`) or the package is uninstalled.

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
