# LinkedIn

**Mode**: 🔐 Browser · **Domain**: `linkedin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli linkedin search` | |
| `opencli linkedin timeline` | Read posts from your LinkedIn home feed |

## Usage Examples

```bash
# Quick start
opencli linkedin search --limit 5

# Read your home timeline
opencli linkedin timeline --limit 5

# JSON output
opencli linkedin search -f json

opencli linkedin timeline -f json

# Verbose mode
opencli linkedin search -v
```

## Prerequisites

- Chrome running and **logged into** linkedin.com
- [Browser Bridge extension](/guide/browser-bridge) installed
