# Band

**Mode**: 🔐 Browser · **Domain**: `www.band.us`

Read posts, comments, and notifications from [Band](https://www.band.us), a private community platform. Authentication uses your logged-in Chrome session (cookie-based).

## Commands

| Command | Description |
|---------|-------------|
| `opencli band bands` | List all Bands you belong to |
| `opencli band posts <band_no>` | List posts from a Band |
| `opencli band post <band_no> <post_no>` | Export full post content including nested comments |
| `opencli band mentions` | Show notifications where you were @mentioned |

## Usage Examples

```bash
# List all your bands (get band_no from here)
opencli band bands

# List recent posts in a band
opencli band posts 12345678 --limit 10

# Export a post with comments
opencli band post 12345678 987654321

# Export post body only (skip comments)
opencli band post 12345678 987654321 --comments false

# Export post and download attached photos
opencli band post 12345678 987654321 --output ./band-photos

# Show recent @mention notifications
opencli band mentions --limit 20

# Show only unread mentions
opencli band mentions --unread true

# Show all notification types
opencli band mentions --filter all
```

### `band mentions` filter options

| Filter | Description |
|--------|-------------|
| `mentioned` | Only notifications where you were @mentioned (default) |
| `all` | All notifications |
| `post` | Post-related notifications |
| `comment` | Comment-related notifications |

## Prerequisites

- Chrome running and **logged into** [band.us](https://www.band.us)
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `band_no` is the numeric ID in the Band URL: `band.us/band/{band_no}/post`
- `band bands` lists all your bands with their `band_no` values
- `band post` output rows: `type=post` (the post itself), `type=comment` (top-level comment), `type=reply` (nested reply)
- Photo downloads use the full-resolution URL (thumbnail query params are stripped automatically)
