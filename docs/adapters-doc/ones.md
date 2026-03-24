# ONES 项目管理平台（OpenCLI）

基于官方 [ONES Project API](https://developer.ones.cn/zh-CN/docs/api/readme/)，经 **Chrome + Browser Bridge** 在页面里 `fetch`（`credentials: 'include'`）。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ONES_BASE_URL` | 是 | 与 Chrome 中访问的 ONES 根 URL 一致 |
| `ONES_USER_ID` / `ONES_AUTH_TOKEN` | 视部署 | 若接口强制要文档中的 Header，再设置（可先只依赖浏览器登录） |
| `ONES_EMAIL` / `ONES_PHONE` / `ONES_PASSWORD` | 否 | 供 `ones login` 脚本化 |

## 命令

```bash
export ONES_BASE_URL=https://your-host
# 安装扩展，Chrome 已登录 ONES

opencli ones me
opencli ones token-info              # teams column includes name(uuid), useful for tasks
opencli ones tasks <teamUUID> --limit 20 --project <optional>
opencli ones my-tasks <teamUUID> --limit 100              # default assignee=self
opencli ones my-tasks <teamUUID> --mode field004         # deployments using field004 as assignee
opencli ones my-tasks <teamUUID> --mode both             # assignee OR creator
opencli ones task <taskUUID> --team <teamUUID>           # single task (URL .../task/<uuid>)
opencli ones worklog <taskUUID> 2 --team <teamUUID>      # log hours for today
opencli ones worklog <taskUUID> 1 --team <teamUUID> --date 2026-03-01  # backfill
opencli ones login --email you@corp.com --password '***'   # optional; stderr prints header export hints
opencli ones logout
```

更完整的说明见 [docs/adapters/browser/ones.md](../adapters/browser/ones.md)。
