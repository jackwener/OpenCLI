# Desktop Adapter Commands

Commands that interact with desktop applications via CDP (Chrome DevTools Protocol) on Electron apps.

> For external CLI passthrough (gh, docker, lark-cli, etc.), see the **External CLI** section in the main SKILL.md.

## Cursor (desktop — CDP via Electron)

```bash
opencli cursor ask "question"            # 一键提问并等回复 (send + wait + read)
opencli cursor composer "message"        # 通过 Composer (Cmd+I) 发送消息
opencli cursor export                    # 导出当前对话为 Markdown
opencli cursor extract-code              # 提取对话中的代码块
opencli cursor model [model-name]        # 查看或切换当前 AI 模型
opencli cursor history                   # 列出最近的聊天会话
opencli cursor read                      # 读取当前对话历史
opencli cursor send "message"            # 发送消息到 Composer/Chat
```

## Codex (desktop — headless CLI agent)

```bash
opencli codex ask "question"             # 一键提问并等回复 (send + wait + read)
opencli codex export                     # 导出当前 Codex 对话为 Markdown
opencli codex extract-diff               # 提取代码 review diff
opencli codex history                    # 列出最近的对话线程
opencli codex read                       # 读取当前对话内容
opencli codex model [model-name]         # 查看或切换当前 AI 模型
opencli codex send "message"             # 发送文本/命令到 Codex
```

## ChatGPT App (desktop — macOS AppleScript/CDP)

```bash
opencli chatgpt-app status                   # 检查应用状态
opencli chatgpt-app ask "question"           # 一键提问并等回复 (send + wait + read)
opencli chatgpt-app model <model>            # 切换模型/模式 (auto, instant, thinking 等)
opencli chatgpt-app read                     # 读取最近一条可见消息
opencli chatgpt-app new                      # 新建对话
opencli chatgpt-app send "message"           # 发送消息
```

## ChatWise (desktop — multi-LLM client)

```bash
opencli chatwise ask "question"          # 一键提问并等回复 (send + wait + read)
opencli chatwise export                  # 导出当前对话为 Markdown
opencli chatwise history                 # 列出对话历史
opencli chatwise model [model-name]      # 查看或切换当前 AI 模型
opencli chatwise read                    # 读取当前对话历史
opencli chatwise send "message"          # 发送消息
```

## Notion (desktop — CDP via Electron)

```bash
opencli notion status                    # 检查 CDP 连接状态
opencli notion export                    # 导出当前页面为 Markdown
opencli notion favorites                 # 收藏列表
opencli notion new [title]               # 新建页面
opencli notion read                      # 读取当前页面内容
opencli notion search "keyword"          # 通过快速查找搜索页面
opencli notion sidebar                   # 侧边栏导航
opencli notion write "content"           # 追加内容到当前页面
```

## Discord App (desktop — CDP via Electron)

```bash
opencli discord-app status               # 检查 CDP 连接状态
opencli discord-app read                 # 读取当前频道消息
opencli discord-app channels             # 列出当前服务器频道
opencli discord-app search "keyword"     # 搜索消息 (Cmd+F)
opencli discord-app members              # 列出在线成员
opencli discord-app send "message"       # 发送消息
opencli discord-app servers              # 列出所有服务器
```

## Doubao App 豆包桌面版 (desktop — CDP via Electron)

```bash
opencli doubao-app status                # 检查 CDP 连接状态
opencli doubao-app ask "question"        # 一键提问并等回复
opencli doubao-app dump                  # 导出 DOM 调试信息
opencli doubao-app new                   # 新建对话
opencli doubao-app read                  # 读取聊天历史
opencli doubao-app screenshot            # 截图
opencli doubao-app send "message"        # 发送消息
```

## Antigravity (Electron/CDP)

```bash
opencli antigravity status              # 检查 CDP 连接状态
opencli antigravity serve --timeout 300 # 启动 Anthropic 兼容 API 代理，等待回复最多 300s
opencli antigravity dump                # 导出 DOM 调试信息
opencli antigravity extract-code        # 提取对话中的代码块
opencli antigravity model <name>        # 切换底层模型
opencli antigravity new                 # 清空聊天、开启新对话
opencli antigravity read                # 读取聊天记录
opencli antigravity send "hello"        # 发送文本到当前聊天框
opencli antigravity watch               # 流式监听增量消息
```

也可以通过 `OPENCLI_ANTIGRAVITY_TIMEOUT=300` 设置 `serve` 的默认等待时长（单位：秒）。
