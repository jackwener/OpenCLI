# Recipe: monitor（监控巡检）

## 输入

- `target`: repo/topic/symbol
- `domains`: [community, devtools, finance]
- `interval`: 手动或定时触发
- `threshold`: 告警阈值（如热度变化）

## 命令链

```bash
opencli gh issue list --repo <owner/repo> --limit 20
opencli hackernews top --limit 20
opencli reddit search "<topic>" --limit 20
opencli xueqiu search "<symbol>" --limit 10
```

## 失败处理

- 某源不可用：记录告警并继续其他源。
- 数据噪音高：提高阈值、缩短关键词。
- 连续失败：提示检查网络/登录态并执行 `opencli doctor`。

## 输出格式

- `status`: ok/warn/error
- `highlights`: 关键变化列表
- `actions`: 建议动作（最多 3 条）
