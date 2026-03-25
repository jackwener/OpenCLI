# Domain: community（社区）

## 用途

用于社区信息巡检与讨论脉络跟踪：论坛热帖、技术社区趋势、舆情监测。

## 覆盖命令（示例）

- `opencli hackernews top --limit 30`
- `opencli reddit search "<query>" --limit 20`
- `opencli v2ex hot --limit 20`
- `opencli weibo hot --limit 50`
- `opencli v2ex daily`（写：签到类）

## 参数

- `platform`：hackernews/reddit/v2ex/weibo
- `query`：关键词
- `limit`：默认 20
- `timeRange`：24h/7d
- `output`：table/json/markdown
- `confirm`：写操作确认

## 示例

```bash
# 读：HN 热门
opencli hackernews top --limit 30

# 读：Reddit 搜索 agent 主题
opencli reddit search "ai agent" --limit 20

# 写：V2EX 每日签到（需确认）
opencli v2ex daily
```

## 风险等级

- 巡检读取：低
- 账号动作（签到/评论/点赞）：中-高（必须确认）
