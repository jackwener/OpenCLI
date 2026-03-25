# xiaohongshu

## Commands

### creator-note-detail
- 用途：小红书单篇笔记详情页数据 (笔记信息 + 核心/互动数据 + 观看来源 + 观众画像 + 趋势数据)
- 参数：
  - `note-id`（必填）：类型 string；Note ID (from creator-notes or note-detail page URL)
- 用法：`opencli xiaohongshu creator-note-detail [options] -f json`

### creator-notes
- 用途：小红书创作者笔记列表 + 每篇数据 (标题/日期/观看/点赞/收藏/评论)
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of notes to return
- 用法：`opencli xiaohongshu creator-notes [options] -f json`

### creator-notes-summary
- 用途：小红书最近笔记批量摘要 (列表 + 单篇关键数据汇总)
- 参数：
  - `limit`（可选）：类型 int；默认值 3；Number of recent notes to summarize
- 用法：`opencli xiaohongshu creator-notes-summary [options] -f json`

### creator-profile
- 用途：小红书创作者账号信息 (粉丝/关注/获赞/成长等级)
- 参数：无
- 用法：`opencli xiaohongshu creator-profile [options] -f json`

### creator-stats
- 用途：小红书创作者数据总览 (观看/点赞/收藏/评论/分享/涨粉，含每日趋势)
- 参数：
  - `period`（可选）：类型 string；默认值 'seven'；Stats period: seven or thirty
- 用法：`opencli xiaohongshu creator-stats [options] -f json`

### download
- 用途：下载小红书笔记中的图片和视频
- 参数：
  - `note-id`（必填）：Note ID (from URL)
  - `output`（可选）：默认值 './xiaohongshu-downloads'；Output directory
- 用法：`opencli xiaohongshu download [options] -f json`

### feed
- 用途：小红书首页推荐 Feed (via Pinia Store Action)
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of items to return
- 用法：`opencli xiaohongshu feed [options] -f json`

### notifications
- 用途：小红书通知 (mentions/likes/connections)
- 参数：
  - `type`（可选）：类型 str；默认值 mentions；"Notification type: mentions, likes, or connections"
  - `limit`（可选）：类型 int；默认值 20；Number of notifications to return
- 用法：`opencli xiaohongshu notifications [options] -f json`

### publish
- 用途：小红书发布图文笔记 (creator center UI automation)
- 参数：
  - `title`（必填）：笔记标题 (最多20字)
  - `content`（必填）：笔记正文
  - `images`（可选）：图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)
  - `topics`（可选）：话题标签，逗号分隔，不含 # 号
  - `draft`（可选）：类型 bool；默认值 false；保存为草稿，不直接发布
- 用法：`opencli xiaohongshu publish [options] -f json`

### search
- 用途：搜索小红书笔记
- 参数：
  - `query`（必填）：Search keyword
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli xiaohongshu search [options] -f json`

### user
- 用途：Get public notes from a Xiaohongshu user profile
- 参数：
  - `id`（必填）：类型 string；User id or profile URL
  - `limit`（可选）：类型 int；默认值 15；Number of notes to return
- 用法：`opencli xiaohongshu user [options] -f json`
