# Douyu (斗鱼)

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `www.douyu.com` / `v.douyu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli douyu search` | 搜索斗鱼直播间 |
| `opencli douyu room` | 获取斗鱼直播间公开信息 |
| `opencli douyu category` | 获取斗鱼分类直播列表 |
| `opencli douyu home` | 获取斗鱼首页推荐直播 |
| `opencli douyu watch` | 打开斗鱼直播间并返回当前直播状态 |
| `opencli douyu me` | 获取当前斗鱼登录用户信息 |
| `opencli douyu my-follow` | 获取我的斗鱼关注列表 |
| `opencli douyu history` | 获取斗鱼观看历史 |
| `opencli douyu follow` | 关注斗鱼直播间主播 |
| `opencli douyu unfollow` | 取消关注斗鱼直播间主播 |
| `opencli douyu danmaku` | 向斗鱼直播间发送普通弹幕 |
| `opencli douyu daily-task` | 随机打开直播间，关注主播，发送两条普通弹幕，保持观看直播，并累计视频分站观看任务时长 |

## Usage Examples

```bash
# 搜索直播间
opencli douyu search 英雄联盟 --limit 10 -f yaml

# 公开直播间/分类数据
opencli douyu room 6979222 -f yaml
opencli douyu category all --limit 10 -f yaml

# 浏览器读取
opencli douyu home --limit 10 -f yaml
opencli douyu watch 6979222 -f yaml
opencli douyu me -f yaml
opencli douyu my-follow --limit 10 -f yaml
opencli douyu history --limit 10 -f yaml

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

- `search`, `room`, and `category` read public Douyu pages without a browser session.
- `home`, `watch`, `me`, `my-follow`, `history`, `follow`, `unfollow`, `danmaku`, and `daily-task` use Browser Bridge.
- `daily-task` also searches the Douyu video subsite (`v.douyu.com`) for candidate videos, including links rendered inside shadow DOM.
- Playback credit is accumulated from actual `<video>` `currentTime` progress. If a short video ends before the target duration, the command picks another unseen video until `--video-watch-minutes` is reached or `--max-videos` is exhausted.
- `--dry-run true` only chooses and opens a candidate room; it does not follow, send danmaku, or accumulate live/video watch time.
