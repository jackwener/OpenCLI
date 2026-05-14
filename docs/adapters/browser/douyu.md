# Douyu (斗鱼)

**Mode**: 🌐 Public (`search`) / 🔐 Browser · **Domain**: `www.douyu.com` / `v.douyu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli douyu search` | 搜索斗鱼直播间 |
| `opencli douyu watch` | 打开斗鱼直播间并返回当前直播状态 |
| `opencli douyu follow` | 关注斗鱼直播间主播 |
| `opencli douyu unfollow` | 取消关注斗鱼直播间主播 |
| `opencli douyu danmaku` | 向斗鱼直播间发送普通弹幕 |
| `opencli douyu daily-task` | 随机打开直播间，关注主播，发送两条普通弹幕，保持观看直播，并累计视频分站观看任务时长 |

## Usage Examples

```bash
# 搜索直播间
opencli douyu search 英雄联盟 --limit 10 -f yaml

# 直播间状态
opencli douyu watch 6979222 -f yaml

# 关注与弹幕
opencli douyu follow 6979222 -f yaml
opencli douyu unfollow 6979222 -f yaml
opencli douyu danmaku 6979222 "hello" -f yaml

# 每日任务：直播关注/弹幕/观看 + 视频分站观看
opencli douyu daily-task --window foreground --keep-tab true -f yaml
opencli douyu daily-task --dry-run true -f yaml
opencli douyu daily-task --video-watch-minutes 15 --max-videos 5 -f yaml
```

## Prerequisites

- Chrome running and **logged into** `www.douyu.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `search` reads Douyu's public search result HTML and returns live room candidates that can be passed to `watch`, `follow`, or `danmaku`.
- `daily-task` also searches the Douyu video subsite (`v.douyu.com`) for candidate videos, including links rendered inside shadow DOM.
- Playback credit is accumulated from actual `<video>` `currentTime` progress. If a short video ends before the target duration, the command picks another unseen video until `--video-watch-minutes` is reached or `--max-videos` is exhausted.
- `--dry-run true` only chooses and opens a candidate room; it does not follow, send danmaku, or accumulate live/video watch time.
