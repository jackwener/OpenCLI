# douyin

## Commands

### activities
- Purpose: Get official activity list
- Args: None
- Usage: `opencli douyin activities [options] -f json`

### collections
- Purpose: Get creator collections list
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli douyin collections [options] -f json`

### delete
- Purpose: Delete a published video
- Args:
  - `aweme_id`(required); 作品 ID
- Usage: `opencli douyin delete [options] -f json`

### draft
- Purpose: Upload a video and save it as draft
- Args:
  - `video`(required); 视频文件路径
  - `title`(required); 视频标题（≤30字）
  - `caption`(optional; default: ''); 正文内容（≤1000字，支持 #话题）
  - `cover`(optional; default: ''); 封面图片路径
  - `visibility`(optional; default: 'public')
- Usage: `opencli douyin draft [options] -f json`

### drafts
- Purpose: Get draft video list
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli douyin drafts [options] -f json`

### hashtag
- Purpose: Hashtag search, suggestion, or hot topics
- Args:
  - `action`(required); search=关键词搜索 suggest=AI推荐 hot=热点词
  - `keyword`(optional; default: ''); 搜索关键词（search/hot 使用）
  - `cover`(optional; default: ''); 封面 URI（suggest 使用）
  - `limit`(optional; type: int; default: 10)
- Usage: `opencli douyin hashtag [options] -f json`

### location
- Purpose: Search POI locations
- Args:
  - `query`(required); 地名关键词
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli douyin location [options] -f json`

### profile
- Purpose: Get creator account profile information
- Args: None
- Usage: `opencli douyin profile [options] -f json`

### publish
- Purpose: Upload and schedule a Douyin video post
- Args:
  - `video`(required); 视频文件路径
  - `title`(required); 视频标题（≤30字）
  - `schedule`(required); 定时发布时间（ISO8601 或 Unix 秒，2h ~ 14天后）
  - `caption`(optional; default: ''); 正文内容（≤1000字，支持 #话题）
  - `cover`(optional; default: ''); 封面图片路径（不提供时使用视频截帧）
  - `visibility`(optional; default: 'public')
  - `allow_download`(optional; type: bool; default: false); 允许下载
  - `collection`(optional; default: ''); 合集 ID
  - `activity`(optional; default: ''); 活动 ID
  - `poi_id`(optional; default: ''); 地理位置 ID
  - `poi_name`(optional; default: ''); 地理位置名称
  - `hotspot`(optional; default: ''); 关联热点词
  - `no_safety_check`(optional; type: bool; default: false); 跳过内容安全检测
  - `sync_toutiao`(optional; type: bool; default: false); 同步发布到头条
- Usage: `opencli douyin publish [options] -f json`

### stats
- Purpose: Get analytics metrics for a specific video
- Args:
  - `aweme_id`(required)
- Usage: `opencli douyin stats [options] -f json`

### update
- Purpose: Update scheduled publish time or caption of a video
- Args:
  - `aweme_id`(required)
  - `reschedule`(optional; default: ''); 新的发布时间（ISO8601 或 Unix 秒）
  - `caption`(optional; default: ''); 新的正文内容
- Usage: `opencli douyin update [options] -f json`

### user-videos
- Purpose: 获取指定用户的视频列表（含下载地址和热门评论）
- Args:
  - `sec_uid`(required; type: string); 用户 sec_uid（URL 末尾部分）
  - `limit`(optional; type: int; default: 20); 获取数量（最大 20）
  - `with_comments`(optional; type: bool; default: true); 包含热门评论（默认: true）
  - `comment_limit`(optional; type: int; default: 10); 每个视频获取多少条评论（最大 10）
- Usage: `opencli douyin user-videos [options] -f json`

### videos
- Purpose: Get creator video list
- Args:
  - `limit`(optional; type: int; default: 20); 每页数量
  - `page`(optional; type: int; default: 1); 页码
  - `status`(optional; default: 'all')
- Usage: `opencli douyin videos [options] -f json`
