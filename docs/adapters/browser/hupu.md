# Hupu (虎扑)

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `bbs.hupu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli hupu hot` | Read Hupu hot threads |
| `opencli hupu search <keyword>` | Search Hupu threads by keyword |
| `opencli hupu detail <tid>` | Read one thread and optional hot replies |
| `opencli hupu mentions` | Read replies that mentioned you |
| `opencli hupu reply <tid> <text>` | Reply to a thread or quote one reply |
| `opencli hupu like <tid> <pid>` | Like one reply |
| `opencli hupu unlike <tid> <pid>` | Cancel like on one reply |

## Usage Examples

```bash
# Hot threads
opencli hupu hot --limit 5

# Search threads
opencli hupu search 湖人 --limit 10

# Read one thread and include hot replies
opencli hupu detail 638234927 --replies true

# Read mentions that replied to you
opencli hupu mentions --limit 20

# Reply to the thread
opencli hupu reply 638234927 "hello from opencli" --topic_id 502

# Quote one hot reply by pid
opencli hupu reply 638234927 "replying to this comment" --topic_id 502 --quote_id 174908

# Like / unlike one reply
opencli hupu like 638234927 174908 --fid 4860
opencli hupu unlike 638234927 174908 --fid 4860

# JSON output
opencli hupu detail 638234927 -f json
```

## Notes

- `reply --topic_id` maps to Hupu's API `topicId`, for example `502` for Basketball News
- `reply --quote_id` is the quoted reply `pid`
- `mentions` reads `my.hupu.com` notification APIs from the logged-in browser session
- `like` / `unlike --fid` uses the forum ID from thread metadata
- `detail --replies true` appends top hot replies to the content field
- `hot --limit` is validated upfront: must be a positive integer in `[1, 100]`. Out-of-range or non-integer values raise `ArgumentError` — no silent clamp.

## Output

### `hot`

Reads the public `bbs.hupu.com/` landing page (no login required) via an in-page `querySelectorAll('.t-info')` walk. Replaces a legacy `documentElement.outerHTML` regex that conflated navigation links with thread rows.

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based position on the home page |
| `tid` | string | 9-digit hupu thread id; round-trips into `hupu detail <tid>` |
| `title` | string | Thread title from `.t-title`; trimmed |
| `lights` | int \| null | "亮" count (likes-equivalent), `null` if upstream omitted the span; `0` is a real value, never an unknown sentinel |
| `replies` | int \| null | "回复" count, same `null` semantics as `lights`. `万`-suffixed counts are expanded (`1.2万 → 12000`) |
| `forum` | string | Sub-section name (e.g. `步行街主干道`, `NBA湿乎乎的话题`) from the row's `.t-label` link |
| `is_hot` | bool | `true` when hupu tagged the row with `class=" hot"` — exposes hupu's own hot marker; rows are returned in page order regardless |
| `url` | string | Canonical `https://bbs.hupu.com/<tid>.html` |

Empty home page → `EmptyResultError` (the page structure may have changed); never a silent `[]`.

## Prerequisites

- Chrome running and able to open `bbs.hupu.com` and `my.hupu.com`
- [Browser Bridge extension](/guide/browser-bridge) installed
- For `mentions`, `reply`, `like`, and `unlike`, a valid Hupu login session in Chrome is required
