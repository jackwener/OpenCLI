# Lark Open Platform (Developer Console)

**Mode**: 🔐 Browser · **Domain**: `open.larksuite.com`

The Lark Open Platform [developer console](https://open.larksuite.com/app) — where you create and manage custom apps/bots — has **no public OpenAPI**: everything is driven through the console UI. This adapter reads it as a CLI by calling the console's own same-origin JSON services (`/developers/v1/...`, `/napi/...`) through your logged-in Chrome session.

Those services authenticate off the session cookie; the `/developers/v1` endpoints additionally require an `x-csrf-token` header, which the console publishes as a `window.csrfToken` global — the adapter reuses it from inside the bound tab. Run `opencli lark-console login` once (or just sign in to the console in your bound Chrome), then every command works against your account.

> Read-only. The adapter never creates apps, edits scopes, or publishes versions — it only surfaces what the console shows.
>
> Targets **Lark** (`open.larksuite.com`). Feishu (`open.feishu.cn`) exposes the identical API surface; a Feishu variant only needs the host swapped.

## Commands

| Command | Description |
|---------|-------------|
| `opencli lark-console login` | Open the developer console and wait until the browser session is signed in (run once) |
| `opencli lark-console whoami` | Show the current console login (user id + tenant id) |
| `opencli lark-console apps` | List the apps/bots in your developer console |
| `opencli lark-console app <app>` | One app's basic info (name, abilities, languages, description) |
| `opencli lark-console secret <app>` | Reveal an app's App ID + App Secret (credentials for a bot runtime) |
| `opencli lark-console versions <app>` | An app's version history — which one is live, publish dates, release notes |
| `opencli lark-console scopes <app>` | The API permission scopes an app has applied for |
| `opencli lark-console admins <app>` | An app's admins / collaborators |

`<app>` accepts a bare app id (`cli_…`) or any console URL that embeds it
(e.g. `https://open.larksuite.com/app/cli_aab2033f0b389ee7/baseinfo`).

## Usage Examples

```bash
# One-time login (opens the developer console in the bound Chrome tab; waits for you to sign in)
opencli lark-console login

# Who am I? (which Lark user + tenant the console session belongs to)
opencli lark-console whoami

# List every app/bot you own or collaborate on
opencli lark-console apps

# Inspect one app
opencli lark-console app cli_aab2033f0b389ee7

# Grab the App ID + Secret to wire a bot into a runtime
opencli lark-console secret cli_aab2033f0b389ee7

# Version history — the live version is flagged online=yes
opencli lark-console versions cli_aab2033f0b389ee7

# Which permission scopes has the bot applied for?
opencli lark-console scopes cli_aab2033f0b389ee7

# Who can administer the app?
opencli lark-console admins cli_aab2033f0b389ee7
```

## Notes

- **`apps` · `role`** — `owner` when you created the app, otherwise `collaborator`.
- **`versions` · `online`** — `yes` marks the live published version. Other historical / under-review states are not decoded (and so are left blank) rather than guessed at.
- **`secret`** returns the same secret the console's *Credentials & Basic Info* page reveals; treat the output as sensitive.
- Endpoints key off your logged-in session, so you only ever see apps your Lark account can access in the console.
