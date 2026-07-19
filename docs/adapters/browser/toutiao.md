# Toutiao (今日头条)

**Mode**: 🌐 / 🔐

| Command | Mode | Domain | Description |
|---------|------|--------|-------------|
| `opencli toutiao articles` | 🔐 Browser | `mp.toutiao.com` | 头条号创作者后台文章列表及数据（需登录） |
| `opencli toutiao hot` | 🌐 Public | `www.toutiao.com` | 今日头条首页热榜（公开，无需登录） |
| `opencli toutiao recommend` | 🌐 Public | `www.toutiao.com` | 今日头条频道推荐流（公开，无需登录） |

## Usage Examples

```bash
# Public hot board (no login)
opencli toutiao hot
opencli toutiao hot --limit 10
opencli toutiao hot -f json

# Public channel recommendation feed (no login)
opencli toutiao recommend
opencli toutiao recommend --category news_tech --limit 10
opencli toutiao recommend -f json

# Creator dashboard articles (logged-in)
opencli toutiao articles
opencli toutiao articles --page 2
opencli toutiao articles --page 1 -f json
```

## Output

### `hot`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based, dense after empty-title rows are dropped |
| `group_id` | string \| null | Topic/cluster id (`ClusterIdStr`, falls back to numeric `ClusterId`) |
| `title` | string | Trending topic title |
| `query` | string | Search keyword (`QueryWord`); falls back to `title` if absent |
| `hot_value` | int \| null | `HotValue` parsed as non-negative number; `null` if missing |
| `label` | string \| null | Hot tag (e.g. 热 / 新 / 沸) when present |
| `url` | string \| null | Topic permalink |
| `image_url` | string \| null | First non-empty image URL (`Image.url` → `Image.url_list[*]`) |

### `recommend`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based, dense after sponsored and empty-title rows are dropped |
| `group_id` | string | Article group id; round-trips into the article permalink |
| `title` | string | Article title |
| `abstract` | string \| null | Upstream summary; `null` when the channel omits it |
| `source` | string \| null | Publishing account name |
| `tag` | string \| null | Channel-side label (e.g. 视频) when present |
| `comments` | int \| null | `comments_count` as a non-negative number; `null` if missing |
| `published_at` | string \| null | `behot_time` as ISO 8601 UTC; `null` if missing |
| `url` | string | Canonical article permalink derived from the first-party `source_url` or `group_id` |
| `image_url` | string \| null | Cover image; protocol-relative URLs are normalised to `https:` |

Rows flagged `is_feed_ad` are dropped so an agent never reads a sponsored slot as editorial content.

### `articles`

`title` · `date` · `status` · `展现` · `阅读` · `点赞` · `评论`

If a row's stats span has not finished rendering by the time the page text is read, the row still surfaces with `null` stat columns instead of being silently dropped — this masking previously hid creator-backend slow-render bugs.
Login/captcha pages abort with `AuthRequiredError`; browser render failures abort with `CommandExecutionError`.

## Prerequisites

### `hot`
- No login required. Uses the public `hot-event/hot-board` endpoint that powers the homepage hot panel.

### `recommend`
- No login required. Uses the public `api/pc/feed` endpoint that powers the homepage channel tabs.

### `articles`
- Chrome running and **logged into** `mp.toutiao.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `hot` `--limit` accepts integers in `[1, 50]`; out-of-range values raise an `ArgumentError` (no silent clamp).
- `recommend` `--limit` accepts integers in `[1, 50]`; `--category` accepts `__all__`, `news_tech`, `news_finance`, `news_world`, `news_sports`, `news_entertainment`, `news_military`. `news_auto` is intentionally excluded: the endpoint answers HTTP 200 with an empty payload and no `message` field for it.
- `recommend` is single-shot. The endpoint echoes a `next.max_behot_time` cursor but does not honour it (replaying the cursor returns an overlapping, reordered page), so no pagination flag is exposed.
- `articles` `--page` accepts integers in `[1, 4]`, matching the contributor's verified range on the creator dashboard; out-of-range values raise an `ArgumentError`.
