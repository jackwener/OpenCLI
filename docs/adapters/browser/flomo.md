# Flomo

**Mode**: 🌐 Cookie · **Domain**: `flomoapp.com`, `v.flomoapp.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli flomo memos` | List your Flomo memos |

## What works today

- Lists memos from your Flomo account using the browser login session.
- Reads the access token automatically from `localStorage.me.access_token` — no manual token setup required.
- Supports `--limit` from 1 to 200. Invalid values fail instead of being silently clamped.
- Supports `--since <unix_ts>` to filter by update time.
- Supports `--slug <cursor>` for pagination from a previous memo page.
- Returns stable `id` / `url` fields plus memo content (HTML), slug, tags, image URLs, and timestamps.

## Current limitations

- Requires browser mode with an active Flomo login session.
- The Flomo API uses a custom MD5 signing mechanism with a fixed secret key (embedded in the adapter). If the signing key changes, the adapter will break.
- `--slug` pagination is experimental and may not work reliably.
- Image URLs have expiration timestamps in the query string; they may expire after some time.
- Rate limited to 360 requests per hour.

## Usage Examples

```bash
# List recent memos
opencli flomo memos

# Fetch all memos
opencli flomo memos --limit 200

# Filter by time (Unix timestamp)
opencli flomo memos --since 1735689600

# Continue from a memo cursor
opencli flomo memos --slug memo_abc123 --limit 50

# JSON output
opencli flomo memos --limit 200 -f json
```

## Prerequisites

- Requires Chrome running with an active Flomo session at `v.flomoapp.com`.
- Standalone mode will auto-launch Chrome; use the [Browser Bridge extension](/guide/browser-bridge) for an established session.

## Notes

- The adapter authenticates via `Strategy.COOKIE` — it reads the Bearer token from `localStorage` in the browser context, then calls the signed API from Node.js.
- Memo content is stored as HTML (including formatting tags like `<p>`, `<ul>`, `<strong>`, etc.).
- Image attachments are returned as thumbnail URLs from Flomo's CDN (`static.flomoapp.com`).
- The `--since` parameter expects a Unix timestamp in seconds (e.g. `1735689600` = 2025-01-01 00:00:00 UTC).
- `id` is the memo slug returned by Flomo and `url` opens the memo in Flomo's web app when the session has access.
