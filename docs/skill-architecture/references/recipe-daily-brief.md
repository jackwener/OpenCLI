# Recipe: daily-brief（日常简报）

## 输入

- `domains`: [content, community, finance]（可选）
- `keywords`: 关键词列表
- `limitPerSource`: 每源条数（默认 10）
- `timeRange`: 24h

## 命令链

```bash
opencli bilibili hot --limit 10
opencli zhihu hot --limit 10
opencli hackernews top --limit 10
opencli weibo hot --limit 10
opencli xueqiu hot --limit 10
```

## 失败处理

- 单源失败：跳过并记录 `source=failed`，继续其他源。
- 多源失败：将 `limit` 降到 5 后重试一次。
- 鉴权问题：提示执行 `opencli doctor`。

## 输出格式

- 默认 Markdown：
  - 今日重点（Top 5）
  - 分领域摘要（content/community/finance）
  - 可行动建议（3 条）
