# Desktop Adapter Commands

Commands that interact with desktop applications via CDP (Chrome DevTools Protocol) on Electron apps, or external CLI tools.

## GitHub (via gh CLI)

```bash
opencli gh repo list                     # 列出仓库 (passthrough to gh)
opencli gh pr list --limit 5             # PR 列表
opencli gh issue list                    # Issue 列表
```

## Cursor (desktop — CDP via Electron)

```bash
opencli cursor status                    # 检查连接
opencli cursor send "message"            # 发送消息
opencli cursor read                      # 读取回复
opencli cursor new                       # 新建对话
opencli cursor dump                      # 导出 DOM 调试信息
opencli cursor composer                  # Composer 模式
opencli cursor model claude              # 切换模型
opencli cursor extract-code              # 提取代码块
opencli cursor ask "question"            # 一键提问并等回复
opencli cursor screenshot                # 截图
opencli cursor history                   # 对话历史
opencli cursor export                    # 导出对话
```

## Codex (desktop — headless CLI agent)

```bash
opencli codex status                     # 检查连接
opencli codex send "message"             # 发送消息
opencli codex read                       # 读取回复
opencli codex new                        # 新建对话
opencli codex dump                       # 导出调试信息
opencli codex extract-diff               # 提取 diff
opencli codex model gpt-4                # 切换模型
opencli codex ask "question"             # 一键提问并等回复
opencli codex screenshot                 # 截图
opencli codex history                    # 对话历史
opencli codex export                     # 导出对话
```

## ChatGPT (desktop — macOS AppleScript/CDP)

```bash
opencli chatgpt status                   # 检查应用状态
opencli chatgpt new                      # 新建对话
opencli chatgpt send "message"           # 发送消息
opencli chatgpt read                     # 读取回复
opencli chatgpt ask "question"           # 一键提问并等回复
```

## ChatWise (desktop — multi-LLM client)

```bash
opencli chatwise status                  # 检查连接
opencli chatwise new                     # 新建对话
opencli chatwise send "message"          # 发送消息
opencli chatwise read                    # 读取回复
opencli chatwise ask "question"          # 一键提问并等回复
opencli chatwise model claude            # 切换模型
opencli chatwise history                 # 对话历史
opencli chatwise export                  # 导出对话
opencli chatwise screenshot              # 截图
```

## Notion (desktop — CDP via Electron)

```bash
opencli notion status                    # 检查连接
opencli notion search "keyword"          # 搜索页面
opencli notion read                      # 读取当前页面
opencli notion new                       # 新建页面
opencli notion write "content"           # 写入内容
opencli notion sidebar                   # 侧边栏导航
opencli notion favorites                 # 收藏列表
opencli notion export                    # 导出
```

## Discord App (desktop — CDP via Electron)

```bash
opencli discord-app status               # 检查连接
opencli discord-app send "message"       # 发送消息
opencli discord-app read                 # 读取消息
opencli discord-app channels             # 频道列表
opencli discord-app servers              # 服务器列表
opencli discord-app search "keyword"     # 搜索
opencli discord-app members              # 成员列表
```

## Doubao App 豆包桌面版 (desktop — CDP via Electron)

```bash
opencli doubao-app status                # 检查连接
opencli doubao-app new                   # 新建对话
opencli doubao-app send "message"        # 发送消息
opencli doubao-app read                  # 读取回复
opencli doubao-app ask "question"        # 一键提问并等回复
opencli doubao-app screenshot            # 截图
opencli doubao-app dump                  # 导出 DOM 调试信息
```

## Antigravity (Electron/CDP)

```bash
opencli antigravity status              # 检查 CDP 连接
opencli antigravity send "hello"        # 发送文本到当前 agent 聊天框
opencli antigravity read                # 读取整个聊天记录面板
opencli antigravity new                 # 清空聊天、开启新对话
opencli antigravity dump               # 导出 DOM 和快照调试信息
opencli antigravity extract-code        # 自动抽取 AI 回复中的代码块
opencli antigravity model claude        # 切换底层模型
opencli antigravity watch               # 流式监听增量消息
```
