# Douyin (抖音)

**Mode**: 🔐 Browser · **Domains**: `www.douyin.com` (ordinary-user private messages), `creator.douyin.com` (creator commands)

## Commands

| Command | Description |
|---------|-------------|
| `opencli douyin inbox` | 获取普通用户私聊会话列表 |
| `opencli douyin messages <conversation_id>` | 读取指定私聊的最近 N 条或全部可访问历史 |
| `opencli douyin user-profile` | 获取普通用户主页、数字 UID、sec_uid 与近期公开作品 |
| `opencli douyin detail <target>` | 单条视频或图文详情（ID、HTTPS 视频链接或分享短链） |
| `opencli douyin send <target> <text>` | 私信预检查；执行需独立签名审批与服务器回执 |
| `opencli douyin conversation-open <target>` | 会话预检查；获批后通过原生 SDK 建立或找到服务端会话，不发送 |
| `opencli douyin write-status <request-id>` | 查询本地写入回执；不执行服务端对账 |
| `opencli douyin follow <target>` | 关注预检查；执行需独立签名审批 |
| `opencli douyin unfollow <target>` | 取关预检查；执行需独立签名审批 |
| `opencli douyin nearby` | 仅能力检查：当前未验证 Web 附近数据源，明确报不可用 |
| `opencli douyin profile` | 获取本人创作者账号信息 |
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

## Ordinary-user discovery

See [social discovery](/adapters/browser/social-discovery) for `user-profile`, `detail`, the unavailable Web nearby capability and source/identity contracts. `location` searches publishing POIs, not nearby content. Public `sec_uid` maps to numeric `user_id` through the profile tool; `messages` requires numeric/private IDs; new private writers can also resolve a public profile URL or `sec_uid` to a verified numeric UID.

## Private Messages

```bash
opencli douyin inbox --limit 20 -f json
opencli douyin inbox --unread --limit 20 -f json
opencli douyin messages '<conversation_id-from-inbox>' --after-message <processed-message-id> -f json
opencli douyin messages '<conversation_id-from-inbox>' --limit 10 -f json
opencli douyin messages '<conversation_id-from-inbox>' --all -f json
```

Use the exact `conversation_id` or numeric `user_id` from inbox, not a nickname or `sec_uid`. These commands are read-only and require login on **www.douyin.com**, not creator center. They do not send replies or greetings. See [private messaging](/adapters/browser/private-messaging) for limits, fields, history completeness, stranger-box coverage, read-state caveats, and implementation evidence.

## Approved writes

See [social writes](/adapters/browser/social-writes) for `send`, `conversation-open`, `follow`, `unfollow`, external signing and `write-status`. All new mutators default to preflight; only `--execute --request-id <UUID> --approval <file>` can execute. Unknown outcomes retain an account lock and must not be automatically retried. Six cross-platform live preflight paths passed, but real writes/new-author creation remain unverified pending designated objects and permission. Douyin Web nearby development is deferred.

## Prerequisites

- For `inbox` / `messages`: Chrome running and **logged into** `www.douyin.com`
- For creator commands: Chrome running and **logged into** `creator.douyin.com`
- Creator publishing commands require access to Douyin Creator Center publishing features
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `publish` requires `--schedule` to be at least 2 hours later and no more than 14 days later
- `draft` and `publish` upload the video through Douyin/ByteDance browser-authenticated APIs, so cookies in the active browser session must be valid
- `hashtag suggest` expects a valid `cover`/`cover_uri` value produced during the publish pipeline; for normal manual use, `hashtag search` and `hashtag hot` are usually more convenient

## Public content details

`opencli douyin detail <target> -f json` uses your browser session on `www.douyin.com`. It returns the caption, author and sec_uid, engagement counts, UTC creation time, duration, music, media URLs and image list. The target accepts a 16–20 digit ID, a Douyin video URL, or an HTTPS `v.douyin.com` share URL. Short links follow at most six redirects within known Douyin domains. Deleted, restricted, mismatched and failed API responses produce explicit errors. Media URLs may expire.
