# ChatGPT 桌面端适配器

在终端中直接控制 **ChatGPT macOS 桌面应用**。OpenCLI 支持两种自动化方式。

## 方式一：AppleScript（默认，无需配置）

内置命令使用原生 AppleScript 自动化，无需额外启动参数。

### 前置条件
1. 安装官方 [ChatGPT Desktop App](https://openai.com/chatgpt/mac/)。
2. 在 **系统设置 → 隐私与安全性 → 辅助功能** 中为终端应用授予权限。

### 命令
- `opencli chatgpt status`：检查 ChatGPT 应用是否在运行。
- `opencli chatgpt new`：激活 ChatGPT 并按 `Cmd+N` 开始新对话。
- `opencli chatgpt send "消息"`：将消息复制到剪贴板，激活 ChatGPT，粘贴并提交。
- `opencli chatgpt read`：通过当前聚焦 ChatGPT 窗口的辅助功能树读取最后一条可见消息并返回文本。

## 方式二：CDP（高级，Electron 调试模式）

ChatGPT Desktop 同样是 Electron 应用，可以通过远程调试端口启动以实现更深度的自动化：

```bash
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --remote-debugging-port=9224
```

然后设置环境变量：
```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
```

> **注意**：CDP 模式支持未来的高级命令（如 DOM 检查、模型切换、代码提取等），与 Cursor 和 Codex 适配器类似。

## 工作原理

- **AppleScript 模式**：使用 `osascript` 控制 ChatGPT，发送消息时借助 `pbcopy`/`pbpaste` 粘贴文本，读取消息时通过 macOS 辅助功能树获取当前可见聊天内容。
- **CDP 模式**：通过 Chrome DevTools Protocol 连接到 Electron 渲染进程，直接操作 DOM。

## 限制

- 仅支持 macOS（AppleScript 依赖）
- AppleScript 模式需要辅助功能权限
- `read` 返回的是当前聚焦 ChatGPT 窗口里的最后一条可见消息；如果目标消息不在可见区域，需先手动滚动
