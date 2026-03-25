# Domain: devtools（开发工具）

## 用途

用于开发协作与工程巡检：GitHub issue/PR、CI 状态、外部 CLI 聚合调用。

## 覆盖命令（示例）

- `opencli gh issue list --repo owner/repo --limit 20`
- `opencli gh pr list --repo owner/repo --limit 20`
- `opencli gh run list --repo owner/repo --limit 10`
- `opencli list`（发现可用命令）
- `opencli plugin list`（查看插件）

## 参数

- `platform`：gh/local-cli
- `repo`：owner/repo
- `query`：issue/PR 关键词
- `limit`：默认 20
- `output`：table/json/markdown
- `confirm`：写操作确认（如 comment/close/merge）

## 示例

```bash
# 读：列出 PR
opencli gh pr list --repo openclaw/openclaw --limit 20

# 读：查看 CI run
opencli gh run list --repo openclaw/openclaw --limit 10
```

## 风险等级

- 查询：低
- 仓库写操作（评论/关闭/合并）：高（必须确认）
