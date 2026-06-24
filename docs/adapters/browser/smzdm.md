# SMZDM (什么值得买)

**Mode**: 🔐 Browser · **Domain**: `smzdm.com`

## Commands

| Command | Access | Description |
|---------|--------|-------------|
| `opencli smzdm search <query>` | read | 搜索好价 — search deals by keyword |
| `opencli smzdm hot` | read | 首页精选好价流 — curated home deals feed (`/jingxuan/`) |
| `opencli smzdm detail <id\|url>` | read | 好价详情 — title, price, buy link by deal id or URL |
| `opencli smzdm favorite <id\|url>` | write | 收藏好价 — favorite a deal (idempotent) |
| `opencli smzdm zhi <id\|url> [--down]` | write | 好价打分 — rate a deal 值 (default) / 不值 (`--down`) |

## Usage Examples

```bash
# Search deals
opencli smzdm search "无线耳机" --limit 5 -f json

# Curated home deals feed
opencli smzdm hot --limit 5 -f json

# Deal detail by id (or full smzdm URL)
opencli smzdm detail 177316535 -f json

# Favorite a deal (write — requires login)
opencli smzdm favorite 177316535

# Rate a deal 值 / 不值 (write — requires login)
opencli smzdm zhi 177316535
opencli smzdm zhi 177316535 --down

# Verbose mode for debugging
opencli smzdm search "无线耳机" -v
```

## Notes

- `hot` reuses the same `li.feed-row-wide` extractor as `search` — the home
  feed and search results share identical markup.
- `detail` accepts a bare deal id (`177316535`), a relative `/p/<id>/` path, or a
  full `www.smzdm.com` / `post.smzdm.com` URL. `buy_link` is only populated for
  deals that carry an outbound `go.smzdm.com` affiliate link.
- `zhi` confirms via the up-count incrementing. smzdm does not expose a reliable
  per-account "已打分" state on load, so a re-vote that cannot be confirmed is
  reported honestly rather than as a false success.
- There is no `checkin` command: the smzdm web sign-in endpoint is captcha-gated
  and cannot be automated headlessly.

## Prerequisites

- Chrome running and **logged into** smzdm.com
- [Browser Bridge extension](/guide/browser-bridge) installed
- The `write` commands (`favorite`, `zhi`) require an authenticated session.
