# Xiaoyuzhou (小宇宙)

**Mode**: 🔑 Local API · **Domain**: `xiaoyuzhou.fm`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaoyuzhou podcast` | View a podcast profile (requires local credentials) |
| `opencli xiaoyuzhou podcast-episodes` | List podcast episodes (requires local credentials) |
| `opencli xiaoyuzhou episode` | View episode details (requires local credentials) |
| `opencli xiaoyuzhou history` | List the logged-in account's playback history and progress (requires local credentials) |
| `opencli xiaoyuzhou download` | Download episode audio (requires local credentials) |
| `opencli xiaoyuzhou transcript` | Download transcript JSON and extracted text (requires local credentials) |

## Usage Examples

```bash
# Podcast profile
opencli xiaoyuzhou podcast 6013f9f58e2f7ee375cf4216

# Recent episodes
opencli xiaoyuzhou podcast-episodes 6013f9f58e2f7ee375cf4216 --limit 5

# Episode details
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0

# Recent playback history
opencli xiaoyuzhou history --limit 20

# Fetch all playback-history pages as JSON
opencli xiaoyuzhou history --all -f json

# Download episode audio
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 --output ./xiaoyuzhou

# Download transcript JSON + text
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 --output ./xiaoyuzhou-transcripts

# JSON output
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0 -f json

# Verbose mode
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 -v
```

### Playback history semantics

`history` reads Xiaoyuzhou's undocumented app endpoints using the local credential file; the `Local API` label describes that credential carrier, not a public or stable API contract. Rows stay in the service's history order. Episode metadata and playback progress come from separate endpoints, and the command fails instead of returning a partial result if pagination or that join is incomplete.

`durationSec`, `progressSec`, `progressPct`, and `playedAt` can be `null` only when the corresponding API row explicitly has no value. With `--all`, `--limit` is ignored and the command continues until the cursor is exhausted. `--max-pages` is a safety ceiling; reaching it before exhaustion is an error and never returns a partial archive.

## Prerequisites

- No browser required — uses the authenticated Xiaoyuzhou API
- All commands require local Xiaoyuzhou app credentials in `~/.opencli/xiaoyuzhou.json`

Example credential file:

```json
{
  "access_token": "your-access-token",
  "refresh_token": "your-refresh-token",
  "device_id": "81ADBFD6-6921-482B-9AB9-A29E7CC7BB55",
  "device_properties": "",
  "expires_at": 0
}
```
