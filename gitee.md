# Gitee

**Mode**: 🌐 Public (Browser) · **Domain**: `gitee.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli gitee trending` | Recommended open-source projects from Gitee Explore |
| `opencli gitee search` | Search Gitee repositories by keyword |
| `opencli gitee user` | Show user profile panel (nickname, followers, public repos, Gitee index) |

## Usage Examples

```bash
# Explore recommended projects
opencli gitee trending --limit 10

# Search repositories
opencli gitee search opencli --limit 10

# User profile panel
opencli gitee user fu-qingrong

# JSON output
opencli gitee trending --limit 5 -f json
opencli gitee search "ai agent" --limit 5 -f json
opencli gitee user jackwener -f json
```

## Prerequisites

- Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed
- No login required for these public commands
