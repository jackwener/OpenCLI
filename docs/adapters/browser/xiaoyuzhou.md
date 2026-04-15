# Xiaoyuzhou (小宇宙)

**Mode**: 🌐 Public · **Domain**: `xiaoyuzhou.fm`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaoyuzhou podcast` | |
| `opencli xiaoyuzhou podcast-episodes` | |
| `opencli xiaoyuzhou episode` | |
| `opencli xiaoyuzhou download` | Download episode audio |
| `opencli xiaoyuzhou transcript` | Download transcript JSON and extracted text (requires local credentials) |

## Usage Examples

```bash
# Podcast profile
opencli xiaoyuzhou podcast 6013f9f58e2f7ee375cf4216

# Recent episodes
opencli xiaoyuzhou podcast-episodes 6013f9f58e2f7ee375cf4216 --limit 5

# Episode details
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0

# Download episode audio
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 --output ./xiaoyuzhou

# Download transcript JSON + text
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 --output ./xiaoyuzhou-transcripts

# JSON output
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0 -f json

# Verbose mode
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 -v
```

## Prerequisites

- No browser required — uses public episode pages
- `transcript` requires local Xiaoyuzhou app credentials in `~/.opencli/xiaoyuzhou.json`

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
