# Qiita

**Mode**: 🌐 Public · **Domain**: `qiita.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli qiita search <query>` | Search Qiita articles |
| `opencli qiita user <username>` | Get Qiita user profile |
| `opencli qiita articles <username>` | List articles by a Qiita user |

## Usage Examples

```bash
# Search articles
opencli qiita search "ChatGPT" --limit 5

# User profile
opencli qiita user jnchito

# User's articles
opencli qiita articles jnchito --limit 10

# JSON output
opencli qiita search "LLM" -f json
```

## Prerequisites

- No browser required — uses Qiita public API v2
