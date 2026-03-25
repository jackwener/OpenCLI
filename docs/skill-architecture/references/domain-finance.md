# Domain: finance（金融）

## 用途

用于行情与市场信号观察：热股榜、个股搜索、价格快照、主题热度聚合。

## 覆盖命令（示例）

- `opencli xueqiu hot --limit 20`
- `opencli xueqiu search "<symbol>" --limit 10`
- `opencli yahoo quote <symbol>`
- `opencli yahoo top-gainers --limit 20`

## 参数

- `platform`：xueqiu/yahoo
- `query`：股票代码或关键词
- `limit`：默认 20
- `timeRange`：1d/5d/1m
- `output`：table/json

## 示例

```bash
# 读：雪球热股
opencli xueqiu hot --limit 20

# 读：Yahoo 查询 NVDA
opencli yahoo quote NVDA
```

## 风险等级

- 数据读取：低
- 若接入交易类动作（未来扩展）：高（强确认 + 合规提示）
