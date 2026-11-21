# Douyin (抖音创作者中心)

**Mode**: 🔐 Browser · **Domain**: `creator.douyin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli douyin detail <target>` | 单条视频或图文详情（ID、HTTPS 视频链接或分享短链） |
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

# 也支持基于当前时间的偏移秒（例为执行命令1天后）
opencli douyin publish ./video.mp4 \
  --title "春游 vlog" \
  --schedule 86400

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

- `publish` requires `--schedule` to be at least 2 hours later and no more than 14 days later. If `--schedule` is not given in command line, it is given a default value 7500, 2 hours and 5 miniutes later. 5 minutes is for uploading progress.
- `draft` and `publish` upload the video through Douyin/ByteDance browser-authenticated APIs, so cookies in the active browser session must be valid
- `hashtag suggest` expects a valid `cover`/`cover_uri` value produced during the publish pipeline; for normal manual use, `hashtag search` and `hashtag hot` are usually more convenient

## Public content details

`opencli douyin detail <target> -f json` uses your browser session on `www.douyin.com`. It returns the caption, author and sec_uid, engagement counts, UTC creation time, duration, music, media URLs and image list. The target accepts a 16–20 digit ID, a Douyin video URL, or an HTTPS `v.douyin.com` share URL. Short links follow at most six redirects within known Douyin domains. Deleted, restricted, mismatched and failed API responses produce explicit errors. Media URLs may expire.
