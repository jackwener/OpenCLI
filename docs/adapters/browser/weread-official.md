# WeRead (Official Agent Gateway)

**Mode**: 🌐 Public · **Domain**: `weread.qq.com`

Pure HTTP adapter against WeRead's **official Agent Gateway** (`https://i.weread.qq.com/api/agent/gateway`). Coexists with the cookie-driven [`weread`](./weread.md) adapter — pick whichever auth model the operator has.

## Commands

| Command | Description |
|---------|-------------|
| `opencli weread-official search <keyword>` | Search the WeRead store via `/store/search` (9 scope codes) |
| `opencli weread-official shelf` | Sync your shelf — books, albums, and the `文章收藏` (article) entry |
| `opencli weread-official book <bookId>` | Book metadata + chapter list + reading progress (3-in-1) |
| `opencli weread-official notes [bookId]` | Notebook overview, or merged highlights + thoughts for a specific book |
| `opencli weread-official review <bookId>` | Browse public reviews of a book |
| `opencli weread-official readdata` | Reading statistics: time, streak, preferences, top books |
| `opencli weread-official discover [bookId]` | Personalized recommendations (no bookId) or similar books (with bookId) |
| `opencli weread-official list-apis` | List every `api_name` supported by the gateway (meta endpoint) |

## Usage Examples

```bash
# Search
opencli weread-official search "三体"
opencli weread-official search "刘慈欣" --scope author --count 20
opencli weread-official search "AI" --scope ebook --max-idx 20   # next page

# Shelf — books + albums + article-bookmark entry
opencli weread-official shelf

# Book detail (info + chapters + progress)
opencli weread-official book 3300045871
opencli weread-official book 3300045871 --no-chapters   # skip chapter list
opencli weread-official book 3300045871 --no-progress   # skip reading progress

# Notebook overview (all books you've annotated)
opencli weread-official notes
opencli weread-official notes --last-sort 1748563200    # next page cursor

# Merged highlights + thoughts for a specific book
opencli weread-official notes 3300045871

# Public reviews of a book
opencli weread-official review 3300045871
opencli weread-official review 3300045871 --type recommend --count 20
opencli weread-official review 3300045871 --type newest

# Reading statistics
opencli weread-official readdata --mode weekly
opencli weread-official readdata --mode monthly
opencli weread-official readdata --mode annually
opencli weread-official readdata --mode overall
opencli weread-official readdata --mode weekly --base-time 1748563200

# Discover — personalized recommendations
opencli weread-official discover --count 20

# Discover — books similar to a given one
opencli weread-official discover 3300045871 --count 20

# Meta — list every gateway endpoint
opencli weread-official list-apis

# JSON output (useful for piping into other tools)
opencli weread-official book 3300045871 -f json
```

### Search Scopes

| `--scope` | Code | Meaning |
|-----------|------|---------|
| `all` (default) | 0 | All categories |
| `ebook` | 10 | E-books only |
| `webnovel` | 16 | Web novels |
| `audio` | 14 | Audiobooks |
| `author` | 6 | Author profiles |
| `fulltext` | 12 | Full-text search inside books |
| `booklist` | 13 | Curated book lists |
| `mp` | 2 | WeChat Official Account subscriptions |
| `article` | 4 | Individual articles |

### Review Types

| `--type` | Code | Meaning |
|----------|------|---------|
| `all` (default) | 0 | All reviews |
| `recommend` | 1 | Recommended reviews |
| `thumbs-down` | 2 | Negative reviews |
| `newest` | 3 | Most recent reviews |
| `neutral` | 4 | Neutral reviews |

### Reading Stat Modes

`weekly`, `monthly`, `annually`, `overall`. Optional `--base-time <unix-seconds>` shifts the period anchor.

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, scope, bookId, title, author, rating, readingCount, category, searchIdx, cover, intro, link` |
| `shelf` | `rank, kind, bookId, title, author, rating, finishReadingTime, readingTime, progress, secret, link` |
| `book` | `section, bookId, title, value, ...` (rows tagged `info` / `chapter` / `progress`) |
| `notes` | `kind, bookId, title, count|chapter, content|markText, ...` (`notebook` / `highlight` / `thought`) |
| `review` | `rank, reviewId, bookId, userName, star, content, likedCount, commentCount, time, link` |
| `readdata` | `section, label, value` (sections: `summary`, `longest`, `readStat`, `preferCategory`, `preferAuthor`, `preferPublisher`, `preferTime`) |
| `discover` | `rank, mode, bookId, title, author, rating, readingCount, category, idx, reason, cover, intro, link` |
| `list-apis` | `rank, apiName, description, required, optional, extras` (last row: `(client) SKILL_VERSION=...`) |

## Notes

- **Bearer auth only.** All commands require `WEREAD_API_KEY` (format `wrk-*`) exported in the environment. The adapter refuses to call the gateway when the key is missing.
- **No browser, no cookies.** Pure HTTP — works in containers / CI / headless servers without a Chrome dependency.
- **`mp` entry on the shelf** represents the user's WeChat Official Account / article bookmark feed. Shelf count formula: `books.length + albums.length + (mp非空 ? 1 : 0)`.
- **Rating tiers**: 神作 ≥90%, 力荐 ≥80%, 好评 ≥70%, otherwise `X.X分` (raw 0-1000 scale rendered as a percentage).
- **Star field** uses multiples of 20: `20=⭐, 40=⭐⭐, ..., 100=⭐⭐⭐⭐⭐`. `-1` and `0` both mean "no rating".
- **`readdata` preferTime** is a 24-hour rotation starting at 06:00, mirroring the official SKILL output.
- **Deep links** in the `link` column use the `weread://` URI scheme — clickable on devices with the WeRead app installed.
- **Errors are typed**:
  - Missing key / blank env var → `AuthRequiredError` (refuses to call the gateway).
  - errcode `-2010` / `-2012` → `AuthRequiredError` (token rejected by gateway).
  - `upgrade_info` in response → `CommandExecutionError` naming both required and current `skill_version`.
  - HTTP non-2xx, invalid JSON, timeout, or any non-zero errcode → `CommandExecutionError` / `TimeoutError`.
  - Empty result sets → `EmptyResultError` (never silent `[]`, never sentinel rows).

## Prerequisites

- No browser required — pure HTTP gateway calls.
- Export an API key obtained from the official WeRead agent-skill program:

  ```bash
  export WEREAD_API_KEY=wrk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ```

- Skill version is pinned to `1.0.3` and reported with every request. When the gateway returns `upgrade_info`, pull the latest `weread-skills.zip` and bump `SKILL_VERSION` in `clis/weread-official/utils.js`.

## Related

- [`weread`](./weread.md) — Cookie + browser adapter for the reverse-engineered private endpoints. Use this when you don't have an official API key.
