# Facebook

**Mode**: 🔐 Browser · **Domain**: `facebook.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli facebook profile` | Get user/page profile info |
| `opencli facebook notifications` | Get recent notifications |
| `opencli facebook feed` | Get news feed posts |
| `opencli facebook search` | Search people, pages, posts |
| `opencli facebook friends` | Friend suggestions |
| `opencli facebook groups` | List your joined groups |
| `opencli facebook memories` | On This Day memories |
| `opencli facebook events` | Browse event categories |
| `opencli facebook add-friend` | Send a friend request |
| `opencli facebook join-group` | Join a group |

## Usage Examples

```bash
# View a profile
opencli facebook profile --username zuck

# Get notifications
opencli facebook notifications --limit 10

# News feed
opencli facebook feed --limit 5

# Search
opencli facebook search --query "OpenAI" --limit 5

# List your groups
opencli facebook groups

# Send friend request
opencli facebook add-friend --username someone

# Join a group
opencli facebook join-group --group 123456789

# JSON output
opencli facebook profile --username zuck -f json
```

## Prerequisites

- Chrome running and **logged into** facebook.com
- [Browser Bridge extension](/guide/browser-bridge) installed
