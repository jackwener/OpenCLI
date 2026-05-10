# V2EX

**Mode**: 🌐 / 🔐 · **Domain**: `v2ex.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli v2ex hot` | Hot topics |
| `opencli v2ex latest` | Latest topics |
| `opencli v2ex topic <id>` | Topic detail |
| `opencli v2ex node <name>` | Topics by node |
| `opencli v2ex user <username>` | Topics by user |
| `opencli v2ex member <username>` | User profile |
| `opencli v2ex replies <id>` | Topic replies |
| `opencli v2ex nodes` | All nodes (sorted by topic count) |
| `opencli v2ex daily` | Daily hot |
| `opencli v2ex me` | My profile (auth required) |
| `opencli v2ex notifications` | My notifications (auth required) |

## Usage Examples

```bash
# Hot topics
opencli v2ex hot --limit 5

# Browse topics in a node
opencli v2ex node python

# View topic replies
opencli v2ex replies 1000

# User's topics
opencli v2ex user Livid

# User profile
opencli v2ex member Livid

# List all nodes
opencli v2ex nodes --limit 10

# JSON output
opencli v2ex hot -f json
```

## Prerequisites

Most commands (`hot`, `latest`, `topic`, `node`, `user`, `member`, `replies`, `nodes`) use the public V2EX API and **require no browser or login**.

For `daily`, `me`, and `notifications`:

- Chrome running and **logged into** v2ex.com
- [Browser Bridge extension](/guide/browser-bridge) installed
