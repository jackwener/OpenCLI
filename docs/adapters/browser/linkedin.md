# LinkedIn

**Mode**: 🔐 Browser · **Domain**: `linkedin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli linkedin connect` | Send a fail-closed connection request after verifying the exact profile |
| `opencli linkedin inbox` | List LinkedIn messaging inbox conversations and unread status |
| `opencli linkedin safe-send` | Verify exact recipient/thread context before optionally sending a message |
| `opencli linkedin search` | Search LinkedIn jobs (Voyager API), with optional `--details` enrichment |
| `opencli linkedin thread-snapshot` | Load a LinkedIn messaging thread and return available context |
| `opencli linkedin timeline` | Read posts from your LinkedIn home feed |

## Usage Examples

```bash
# Quick start
opencli linkedin search --limit 5

# Search with filters
opencli linkedin search "site reliability engineer" --location "San Francisco Bay Area" --remote remote

# Enrich with full description and apply URL (slower; 1 page navigation per row)
opencli linkedin search "data scientist" --limit 3 --details

# Read your home timeline
opencli linkedin timeline --limit 5

# List recent inbox conversations, including unread status
opencli linkedin inbox --limit 20 -f json

# Verify a profile before sending a connection request; add --send to actually send
opencli linkedin connect https://www.linkedin.com/in/example/ --expected-name "Jane Doe" --note "quick note" --send

# Snapshot a thread, then safe-send only if exact recipient/thread context still matches
opencli linkedin thread-snapshot --thread-url https://www.linkedin.com/messaging/thread/abc/ -f json
opencli linkedin safe-send --thread-url https://www.linkedin.com/messaging/thread/abc/ --expected-name "Jane Doe" --message "thanks" --send

# JSON output
opencli linkedin search -f json
opencli linkedin timeline -f json
```

## Output

### `search`

Always returns: `rank` · `title` · `company` · `location` · `listed` · `salary` · `url`

When `--details` is set, each row additionally has:

| Column | Type | Notes |
|--------|------|-------|
| `description` | string \| null | Full "About the job" body. `null` if upstream had nothing or fetch failed (see `detail_error`). |
| `apply_url` | string \| null | First `apply`-labelled link on the page. `null` if upstream had nothing or fetch failed. |
| `detail_error` | string \| null | `null` on success. Otherwise short reason: `'no url'` (row had no jobId), `'fetch failed: <message>'` (navigation/parse threw), or `'missing description'` (page loaded but body was empty). |

Previously the adapter returned `description: '', apply_url: ''` for both the missing-url path and the silent-catch path — callers couldn't tell upstream gaps apart from fetch failures. The current shape preserves backward compatibility on success and surfaces failures with `null` + a typed reason on `detail_error`. Per-row failures still don't abort the batch.

`--limit` must be between 1 and 100, and `--start` must be a non-negative integer. LinkedIn login/auth walls abort with `AuthRequiredError` instead of being folded into `detail_error`.

### Messaging commands

`inbox` returns `rank`, `thread_url`, `thread_id`, `person_name`, `last_message_preview`, `unread`, and `timestamp`. It loads the LinkedIn messaging page with your browser session, then reuses the page's own `messengerConversations` API request as the row source instead of scraping the virtualized inbox DOM.

`connect` and `safe-send` are write commands but dry-run by default. They only click LinkedIn write actions when `--send` is explicitly passed. `connect` requires an exact `https://www.linkedin.com/in/<profile>/` URL and verifies the landed profile plus visible name before sending. `safe-send` requires an exact `https://www.linkedin.com/messaging/thread/<id>/` URL and verifies the landed thread, visible recipient name, composer presence, and optional latest-message guard before filling or sending.

`thread-snapshot` opens an exact messaging thread URL, validates `--max-scrolls` before navigation, scrolls for available history, and returns a JSON snapshot suitable for caller-side recipient safety checks.

## Prerequisites

- Chrome running and **logged into** linkedin.com
- [Browser Bridge extension](/guide/browser-bridge) installed
