# 红果短剧 Hongguo

**Mode**: 🌐 Public · **Domain**: `hongguoduanju.com`

No user login or cookies, no signature, no browser. `feed` and `search` call
the site's JSON APIs (`feed` carries the server-issued `ttwid` session cookie
between its own pages); `rank` and `detail` parse the `_ROUTER_DATA` blob
embedded in the server-rendered pages.

## Commands

| Command | Description |
|---------|-------------|
| `opencli hongguo feed` | The 推荐 recommendation stream (`/?tab=feed`) |
| `opencli hongguo rank` | Boards (榜单): hot, new, hot-search, must-watch, prestige, followed, subscribe, real, comic, ai |
| `opencli hongguo search <query>` | Search series by title, actor or theme |
| `opencli hongguo detail <series_id>` | One series: episodes, cast, rating, heat, likes/favorites, intro |
| `opencli hongguo reviews <series_id>` | Rated series reviews + episode comments (episode 1 by default; every web-playable episode with `--all-episodes`) |

Every listing row carries a `series_id` that `detail` and `reviews` accept;
both also take a `https://hongguoduanju.com/detail?series_id=<id>` or `/player/<id>` URL.

## Usage Examples

```bash
# Recommendation stream (pages through the feed session, de-duplicated)
opencli hongguo feed --limit 20

# Boards, 20 rows per site page, up to 100
opencli hongguo rank                       # 热播榜
opencli hongguo rank --type new --limit 50 # 新剧榜
opencli hongguo rank --type hot-search     # 热搜榜

# Search
opencli hongguo search "重生" --limit 20

# Series detail
opencli hongguo detail 7706512650816982040

# Reviews: series reviews + episode 1 comments (≈ 9 + 15 per series, robots.txt-compliant)
opencli hongguo reviews 7706512650816982040
opencli hongguo reviews 7706512650816982040 --all-episodes      # + episodes 2–5 (≈ 9 + 5×15); see the robots.txt note
opencli hongguo reviews 7706512650816982040 --scope series      # rated series reviews only
opencli hongguo reviews 7706512650816982040 --all-episodes --rounds 3  # re-fetch episodes to catch rotated comments (≈ +6%)

# JSON output
opencli hongguo rank -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `feed` | `rank, series_id, title, episodes, tags, intro, url` |
| `rank` | `rank, series_id, title, metric, score, favorites, likes, episodes, tags, upcoming, url` |
| `search` | `rank, series_id, title, episodes, heat, favorites, likes, tags, intro, url` |
| `reviews` | `rank, scope, episode, user, rating, likes, time, content, scope_total` |
| `detail` | `field, value` (series_id, title, episodes, total_episodes, web_episodes, tags, cast, rating, rating_count, heat, likes, favorites, reviews, rank_label, released, record_number, intro, cover, url) |

## Notes

- `rank.metric` is the board's headline figure as the site prints it (热度,
  热搜, 收藏, 期待 …), so its unit depends on `--type`. Count-like fields on
  `rank`/`search` stay as the site's display text (e.g. `129.3万收藏`); `detail`
  returns raw integers for likes / favorites / rating_count / reviews.
- `upcoming: true` marks a series that is not released yet (every row of
  `--type subscribe`). The site has no detail page for these, so `url` is empty
  and `detail` answers with an empty-result error.
- `web_episodes` is how many episodes the website lets you watch; the rest are
  app-only.
- `reviews` returns what the website renders, not the full comment history —
  the web has no paginated comment API. That is up to 9 rated series reviews
  (`scope=series`) plus 15 comments per episode page (`scope=episode`).
  `scope_total` is the site's full count for that series/episode, so you can
  see the coverage.
- **robots.txt:** hongguoduanju.com's robots.txt has `Disallow: /player/*/*`.
  Episode 1 is served at `/player/<id>` (allowed), but episodes 2+ only exist
  at `/player/<id>/<vid>`. So by default `reviews` reads episode 1 only —
  about 9 + 15 = 24 rows per series, all from allowed paths. `--all-episodes`
  also reads episodes 2 … `web_episodes` (usually up to 5, about 9 + 5×15 = 84
  rows), which means requesting paths the site asks crawlers not to fetch;
  use it only if that is acceptable for your purpose. `detail`, `rank`,
  `search` and `feed` touch no disallowed paths.
  Episode comments rotate a little between requests; `--rounds N` (1–5)
  re-fetches each episode page and merges the de-duplicated union (series
  reviews do not rotate). `rating` is only present on series reviews; `time` is
  China time.
- How much `--rounds` adds — measured 2026-11-19 with all web episodes (what
  `--all-episodes` reads) on 6 popular series (top 4 of `rank --type hot` and
  `--type new`, 2 overlapping), 30 web episodes, unique episode comments
  accumulated after each round:

  | rounds | comments (30 episodes) | vs. 1 round | added by this round |
  |--------|------------------------|-------------|---------------------|
  | 1 (default) | 450 (15 / episode) | — | — |
  | 2 | 465 | +3.3% | +15 |
  | 3 | 477 | +6.0% | +12 |
  | 4 | 485 | +7.8% | +8 |
  | 5 | 490 | +8.9% | +5 |

  Gains shrink each round and vary a lot: 13 of the 30 episodes never changed,
  the best two went from 15 to 22; per series the 5-round gain ranged from +3
  to +13. Each extra round costs one request per episode page read (1 by
  default, about 5 with `--all-episodes`; with `--all-episodes`, 1 round ≈ 3 s,
  5 rounds ≈ 11–14 s per series). `--rounds 3` gets
  about two thirds of the 5-round gain. Small, time-dependent sample — treat
  the numbers as indicative.
- The feed is personalised per session and differs on every run.
- Search falls back to loosely related titles when nothing matches, so even a
  nonsense query returns rows. If Hongguo challenges search with a captcha
  (`search_verification_required`), the command fails with a typed error
  instead of returning an empty list.
