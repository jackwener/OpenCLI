# Exit Codes

`opencli` follows Unix `sysexits.h` conventions so it integrates naturally with shell pipelines and CI scripts.

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | Command completed normally |
| `1` | Generic error | Unexpected / unclassified failure |
| `2` | Usage error | Bad arguments or unknown command |
| `66` | Empty result | No data returned (`EX_NOINPUT`) |
| `69` | Service unavailable | Browser Bridge not connected (`EX_UNAVAILABLE`) |
| `75` | Temporary failure | Command timed out — retry (`EX_TEMPFAIL`) |
| `77` | Auth required | Not logged in to target site (`EX_NOPERM`) |
| `78` | Config error | Missing credentials or bad config (`EX_CONFIG`) |
| `130` | Interrupted | Ctrl-C / SIGINT |

## Example: branch on exit code

```bash
opencli spotify status || echo "exit $?"   # 69 if browser not running

opencli gh issue list 2>/dev/null
[ $? -eq 77 ] && opencli gh auth login      # auto-auth if not logged in
```
