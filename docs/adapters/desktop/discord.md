# Discord 桌面端

通过 Chrome DevTools Protocol（CDP）从终端控制已登录的 **Discord Desktop App**。

## 前置条件

- 已安装 OpenCLI。
- 已安装 Discord 桌面端并完成登录。
- CDP 只监听本机 `127.0.0.1:9232`。

正常情况下无需预先设置 `OPENCLI_CDP_ENDPOINT`。直接运行：

```bash
opencli discord-app status -f json
```

OpenCLI 会按以下顺序处理：

1. 如果 `9232` 已暴露 Discord 页面目标，直接连接。
2. macOS/Windows 下自动发现 Discord 安装路径。
3. 如果 Discord 正在运行但未开启 CDP，先请求确认，再重启应用；确认默认选择“否”，非交互环境不会自动重启。
4. 使用 `--remote-debugging-port=9232 --remote-allow-origins=*` 启动并等待就绪。

Windows 默认发现 `%LOCALAPPDATA%\Discord\app-*\Discord.exe`。找不到安装目录时，检查 Discord 是否采用了自定义安装路径。

Linux 暂不支持自动发现；请手动启动：

```bash
discord --remote-debugging-port=9232 --remote-allow-origins=*
```

只有使用自定义 HTTP(S) 端口或远程端点时才设置：

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9232"
```

PowerShell：

```powershell
$env:OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9232'
```

CDP 没有应用层认证。不要把调试端点暴露到公网；远程场景应使用受信任的 SSH/VPN 隧道。

## 命令

| 命令 | 说明 |
|---|---|
| `opencli discord-app status` | 检查 CDP 连接 |
| `opencli discord-app send "message"` | 在活动频道发送消息 |
| `opencli discord-app read` | 读取近期消息 |
| `opencli discord-app channels` | 列出当前服务器的频道及稳定 ID/URL |
| `opencli discord-app servers` | 列出侧栏可见的已加入服务器 |
| `opencli discord-app goto` | 通过 ID、名称或 URL 打开频道，不发送消息 |
| `opencli discord-app threads` | 列出可见的论坛帖子或线程 |
| `opencli discord-app thread-read` | 读取指定论坛帖子或线程 |
| `opencli discord-app search "query"` | 使用 Discord UI 搜索消息 |
| `opencli discord-app members` | 列出当前频道可见的在线成员 |
| `opencli discord-app delete MESSAGE_ID` | 删除指定消息 |

## 只读定向采集

优先使用数字 ID 或完整 URL；名称解析仅针对当前侧栏可见频道，属于尽力而为。

```bash
# 获取当前服务器的稳定频道 ID/URL。
opencli discord-app channels -f json

# 定向读取频道。
opencli discord-app read --url https://discord.com/channels/<guild_id>/<channel_id> --count 20 -f json
opencli discord-app read --guild <guild_id> --channel <channel_id> --count 20 -f json

# 仅导航，不读取或发送消息。
opencli discord-app goto --url https://discord.com/channels/<guild_id>/<channel_id>
```

通过 Discord 自身路由打开频道，会像人工点击一样改变正常的已读/未读状态。

## 论坛和线程

```bash
opencli discord-app threads --url https://discord.com/channels/<guild_id>/<forum_channel_id> -f json
opencli discord-app thread-read --url https://discord.com/channels/<guild_id>/<forum_channel_id>/<thread_id> --count 20 -f json
opencli discord-app thread-read --guild <guild_id> --channel <forum_channel_id> --thread <thread_id> --count 20 -f json
```

## 数据边界

- `read` 只提取当前 DOM 已加载的消息，不提供完整历史分页。
- 消息正文最多保留约 300 字符。
- `search` 结果正文最多保留约 200 字符，通常不包含稳定消息 ID。
- `members` 是当前 UI 可见的在线成员，不是完整成员目录。
- `threads` 只列出当前 UI 已渲染的帖子卡片。

需要历史同步、SQLite 检索或批量导出时，应使用独立的 `discord-cli` 路径，并明确评估 user-token 自动化的账号风险。

## 故障排查

- `CDP port 9232 is active but does not belong to Discord`：端口被其他 CDP 程序占用；关闭冲突程序后重试。
- Discord 已运行但命令要求重启：确认后 OpenCLI 才会结束匹配安装目录的 Discord 进程。
- 找不到 Discord：确认安装位置；自定义 Electron 应用可在 `~/.opencli/apps.yaml` 中登记 `windowsInstallDirs`。
- Chromium 142+ WebSocket 返回 `403`：确保启动参数包含 `--remote-allow-origins=*`。
- 选择器漂移：使用 `--trace retain-on-failure`，但 trace 可能包含私密消息，必须按敏感数据处理。
