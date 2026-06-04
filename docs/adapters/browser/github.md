# GitHub

**Mode**: 🔐 Browser · **Domain**: `github.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli github whoami` | Show the currently logged-in GitHub account |
| `opencli github login` | Open GitHub login and wait until the browser session is authenticated |

## Usage Examples

```bash
# Check current GitHub identity
opencli github whoami

# Open the login page if the current browser session is not authenticated
opencli github login

# JSON output for agents/scripts
opencli github whoami -f json
```

## Prerequisites

- Chrome running and **logged into** github.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `whoami` verifies the current browser cookie session and does not open the login page.
- `login` opens `https://github.com/login` in a foreground browser window and waits until OpenCLI can verify the account.
- OpenCLI never fills credentials, CAPTCHA, 2FA, or passkeys. The user completes authentication in the browser; OpenCLI only verifies the resulting session.
