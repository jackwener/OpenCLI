# Domain: content（内容）

## 用途

面向内容生产与分发：热榜采集、选题筛选、素材整理、发布前检查。

## 覆盖命令（示例）

- `opencli bilibili hot --limit 20`
- `opencli zhihu hot --limit 20`
- `opencli youtube search "<query>" --limit 20`
- `opencli xiaohongshu search "<query>" --limit 20`
- `opencli twitter post "<content>"`（写）

## 参数

- `platform`：bilibili/zhihu/youtube/xiaohongshu/twitter
- `query`：关键词（可选）
- `limit`：结果数量，默认 20
- `timeRange`：1d/7d/30d
- `dryRun`：写操作前预演
- `confirm`：写操作确认标记

## 示例

```bash
# 读：抓取知乎热榜
opencli zhihu hot --limit 30

# 读：找小红书“春季穿搭”素材
opencli xiaohongshu search "春季穿搭" --limit 20

# 写：发推（先确认）
opencli twitter post "今天整理了 10 条 AI Agent 实战经验..."
```

## 风险等级

- 读取：低
- 发布/互动：高（必须确认）
