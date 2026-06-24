# IT之家 IThome

**Mode**: 🌐 Public · **Domain**: `ithome.com`

No login, no cookies, no signature. IT之家 (ithome.com) is a major Chinese
tech-news site. It exposes a clean **public JSON API** at
`api.ithome.com/json/newslist/<channel>` for the latest-news lists and the 热榜
ranking boards, and serves full articles as plain UTF-8 SSR HTML at
`www.ithome.com/0/<dir>/<id>.htm`. Each command is a plain HTTP GET.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ithome news [channel]` | Latest news (default `news`; or `apple` / `android` / `win` …) → title + 阅读/评论数 + URL |
| `opencli ithome rank [board]` | 热榜 boards: 48小时 / 周热门 / 周评论 / 月榜 → title + hits + comments |
| `opencli ithome article <id\|url>` | Full article text: 标题 / 标签 / 正文 paragraphs |

`news` and `rank` print a `newsid` and an article `url`; feed either into
`article` (it accepts a bare newsid like `968068` or the full
`www.ithome.com/0/968/068.htm` URL).

## Usage Examples

```bash
# Latest news (optionally by channel)
opencli ithome news --limit 10
opencli ithome news apple

# 热榜 — all four boards, or filter to one
opencli ithome rank --limit 20
opencli ithome rank 评论        # 周评论榜
opencli ithome rank 48          # 48小时热榜

# Read an article (newsid from news/rank, or a full URL)
opencli ithome article 968068
opencli ithome article https://www.ithome.com/0/968/068.htm
```

## Notes

- **`news`** reads `api.ithome.com/json/newslist/<channel>` (pinned `toplist`
  first, then `newslist`), deduped by `newsid`; `date` is the post time
  (`YYYY-MM-DD HH:MM`), `hits`/`comments` are the read and comment counts.
- **`rank`** reads `/json/newslist/rank` (four boards) and tags each row with
  its board; `rank` is the position within that board. A `board` argument keeps
  only the boards whose name matches (e.g. `48`, `周热门`, `评论`, `月`).
- **`article`** fetches the SSR page and returns 标题 (from `<title>` minus the
  " - IT之家" suffix), 标签 (keywords meta) and one 正文 row per `<p>` paragraph
  inside `post_content` (bounded before the related/comment sections).
- **Why no `search` / `comment`?** Investigated and left out — neither is
  login-gated, just not cleanly fetchable here:
  - the search host `so.ithome.com` is DNS-sinkholed in this environment
    (resolves to `198.18.x.x`), so it can't be reached/tested;
  - the comment 热评 stream
    (`cmt.ithome.com/api/webcomment/getnewscomment?sn=…`) is keyed by an
    undocumented per-article `sn` hash that isn't present on the page.

  The adapter never ships empty/unreliable data. Read/comment counts are still
  surfaced by `news` and `rank`.
