# Douyin (抖音创作者中心)

**Mode**: 🔐 Browser · **Domain**: `creator.douyin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli douyin detail <target>` | 单条视频或图文详情（ID、HTTPS 视频链接或分享短链） |
| `opencli douyin mix <target>` | 合集（如短剧分集）里的全部视频，按集数排序 |
| `opencli douyin comments <target>` | 单条视频的全部评论，按游标翻到底，可选带回复 |
| `opencli douyin profile` | 获取账号信息 |
| `opencli douyin videos` | 获取作品列表 |
| `opencli douyin drafts` | 获取草稿列表 |
| `opencli douyin draft` | 上传视频并保存为草稿 |
| `opencli douyin publish` | 定时发布视频到抖音 |
| `opencli douyin update` | 更新视频信息 |
| `opencli douyin delete` | 删除作品 |
| `opencli douyin stats` | 查询作品数据分析 |
| `opencli douyin collections` | 获取合集列表 |
| `opencli douyin activities` | 获取官方活动列表 |
| `opencli douyin location` | 搜索发布可用的地理位置 |
| `opencli douyin hashtag search` | 按关键词搜索话题 |
| `opencli douyin hashtag suggest` | 基于封面 URI 推荐话题 |
| `opencli douyin hashtag hot` | 获取热点词 |

## Usage Examples

```bash
# 账号与作品
opencli douyin profile
opencli douyin videos --limit 10
opencli douyin videos --status scheduled
opencli douyin drafts

# 发布前辅助信息
opencli douyin collections
opencli douyin activities
opencli douyin location "东京塔"
opencli douyin hashtag search "春游"
opencli douyin hashtag hot --limit 10

# 保存草稿
opencli douyin draft ./video.mp4 \
  --title "春游 vlog" \
  --caption "#春游 先存草稿"

# 定时发布
opencli douyin publish ./video.mp4 \
  --title "春游 vlog" \
  --caption "#春游 今天去看樱花" \
  --schedule "2026-04-08T12:00:00+09:00"

# 也支持 Unix 秒字符串
opencli douyin publish ./video.mp4 \
  --title "春游 vlog" \
  --schedule 1775617200

# 更新与删除
opencli douyin update 1234567890 --caption "更新后的文案"
opencli douyin update 1234567890 --reschedule "2026-04-09T20:00:00+09:00"
opencli douyin delete 1234567890

# JSON 输出
opencli douyin profile -f json
```

## Prerequisites

- Chrome running and **logged into** `creator.douyin.com`
- The logged-in account must have access to Douyin Creator Center publishing features
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `publish` requires `--schedule` to be at least 2 hours later and no more than 14 days later
- `draft` and `publish` upload the video through Douyin/ByteDance browser-authenticated APIs, so cookies in the active browser session must be valid
- `hashtag suggest` expects a valid `cover`/`cover_uri` value produced during the publish pipeline; for normal manual use, `hashtag search` and `hashtag hot` are usually more convenient

## Public content details

`opencli douyin detail <target> -f json` uses your browser session on `www.douyin.com`. It returns the caption, author and sec_uid, engagement counts, UTC creation time, duration, music, media URLs and image list. The target accepts a 16–20 digit ID, a Douyin video URL, or an HTTPS `v.douyin.com` share URL. Short links follow at most six redirects within known Douyin domains. Deleted, restricted, mismatched and failed API responses produce explicit errors. Media URLs may expire.

## Mixes and full comment threads

`mix` and `comments` read public content through your logged-in browser session on `www.douyin.com` (the site's own page JS signs the requests).

```bash
# Every video of a mix (e.g. a short drama published one episode per video)
opencli douyin mix 7697274036942571554 --limit 200
opencli douyin mix https://www.douyin.com/collection/7697274036942571554
opencli douyin mix https://www.douyin.com/video/7697274002573872394   # any video inside the mix

# All comments of one video, then with replies
opencli douyin comments 7697274002573872394 --limit 2000 -f json
opencli douyin comments 7697274002573872394 --limit 2000 --replies -f json
opencli douyin comments 7697274002573872394 --limit 2000 --replies --min-replies 5 -f json   # only threads with ≥5 replies
```

| Command | Columns |
|---------|---------|
| `mix` | `episode, aweme_id, desc, duration_s, digg, comment, collect, share, created, author, mix_id, mix_name, url` |
| `comments` | `rank, cid, parent_cid, user, text, likes, replies, time, ip_label, aweme_id` |

- `mix` takes a mix id, a `www.douyin.com/collection/<mix_id>` URL, or a video URL / share link of any video in the mix. A bare number is read as a mix id (mix ids and video ids look alike), so pass a video as a URL.
- `comments` pages with the site's cursor, 50 per request with a 0.5 s pause, until the list ends or `--limit` (max 20000, replies included) is reached. `--replies` adds one request per page of replies under each comment that has any, each preceded by a random 5–10 s pause; replies follow their parent, with `parent_cid` set and `replies` null.
- The comment count Douyin shows includes folded and deleted comments the web does not serve, so a complete crawl lands below it: one video showing 1,376 gave 987 top-level comments + 201 replies = 1,188 with `--replies` (2026-11-23).
- Douyin rate-limits the reply endpoint per account much harder than the top-level list. Measured 2026-11-23/24 on one account: with 0.5 s between reply requests a verification prompt appeared within the first thread (twice); with 5–10 s, ~680 threads went through before one; after that it came back every few threads for a while, even at 15–27 s. Top-level pages at 0.5 s ran 1,100 videos without a prompt. Budget about 8 s per commented thread with `--replies`. `--min-replies N` skips threads whose comment shows fewer than N replies: on 《持械入宋》 season 1, the 110 threads with ≥5 replies held 1,368 of the 2,682 declared replies (51%) at 12% of the 932 threads.
- Both commands take `--timeout` (seconds for the whole crawl; `comments` 1800, `mix` 300). Raise it for `--replies` on videos with hundreds of commented threads.
- `time` / `created` are China time (`YYYY-MM-DD HH:mm:ss`).
- Long crawls run on your account. When Douyin shows a verification (captcha) prompt, its page holds requests open instead of failing them; a request that has not settled after ~33 s fails with `AUTH_REQUIRED` ("did not settle") rather than hanging. Solve the prompt in Chrome, wait, then rerun. Rows fetched before a failure are not returned; the error says where the crawl stopped (e.g. "at reply thread 87/242 after 1553 top-level comments and 310 replies").
- A request whose tab detaches mid-command ("Detached while handling command", ~4 in 1,100 live runs) is retried once on the same page.
