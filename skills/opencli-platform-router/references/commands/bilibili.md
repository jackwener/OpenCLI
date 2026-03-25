# bilibili

## Commands

### download
- 用途：下载B站视频（需要 yt-dlp）
- 参数：
  - `bvid`（必填）：Video BV ID (e.g., BV1xxx)
  - `output`（可选）：默认值 './bilibili-downloads'；Output directory
  - `quality`（可选）：默认值 'best'；Video quality (best, 1080p, 720p, 480p)
- 用法：`opencli bilibili download [options] -f json`

### dynamic
- 用途：Get Bilibili user dynamic feed
- 参数：
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli bilibili dynamic [options] -f json`

### favorite
- 用途：我的默认收藏夹
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of results
  - `page`（可选）：类型 int；默认值 1；Page number
- 用法：`opencli bilibili favorite [options] -f json`

### feed
- 用途：关注的人的动态时间线
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of results
  - `type`（可选）：默认值 'all'；Filter: all, video, article
- 用法：`opencli bilibili feed [options] -f json`

### following
- 用途：获取 Bilibili 用户的关注列表
- 参数：
  - `uid`（可选）：目标用户 ID（默认为当前登录用户）
  - `page`（可选）：类型 int；默认值 1；页码
  - `limit`（可选）：类型 int；默认值 50；每页数量 (最大 50)
- 用法：`opencli bilibili following [options] -f json`

### history
- 用途：我的观看历史
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli bilibili history [options] -f json`

### hot
- 用途：B站热门视频
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of videos
- 用法：`opencli bilibili hot [options] -f json`

### me
- 用途：My Bilibili profile info
- 参数：无
- 用法：`opencli bilibili me [options] -f json`

### ranking
- 用途：Get Bilibili video ranking board
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli bilibili ranking [options] -f json`

### search
- 用途：Search Bilibili videos or users
- 参数：
  - `query`（必填）：Search keyword
  - `type`（可选）：默认值 'video'；video or user
  - `page`（可选）：类型 int；默认值 1；Result page
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli bilibili search [options] -f json`

### subtitle
- 用途：获取 Bilibili 视频的字幕
- 参数：
  - `bvid`（必填）
  - `lang`（可选）：字幕语言代码 (如 zh-CN, en-US, ai-zh)，默认取第一个
- 用法：`opencli bilibili subtitle [options] -f json`

### user-videos
- 用途：查看指定用户的投稿视频
- 参数：
  - `uid`（必填）：User UID or username
  - `limit`（可选）：类型 int；默认值 20；Number of results
  - `order`（可选）：默认值 'pubdate'；Sort: pubdate, click, stow
  - `page`（可选）：类型 int；默认值 1；Page number
- 用法：`opencli bilibili user-videos [options] -f json`
