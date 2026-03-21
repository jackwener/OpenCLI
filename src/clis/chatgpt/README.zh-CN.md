# ChatGPT 桌面端适配器

在终端中控制 **ChatGPT Desktop App**。

## 当前现实

- **默认回退路径**：macOS AppleScript / 辅助功能自动化
- **实验性 CDP 路径**：当设置 `OPENCLI_CDP_ENDPOINT` 时，`chatgpt status`、`chatgpt read`、`chatgpt reasoning`、`chatgpt send` 会改走 CDP
- **默认异步**：`chatgpt send` 只负责提交并返回 `Submitted`；稍后用 `chatgpt read` 读取输出
- **Windows / WSL 支持**：本轮仅提供实验性、CDP-only 的窄支持
- **仍然是 AppleScript / macOS only**：`chatgpt new`、`chatgpt ask`
- **推理切换范围**：实验性 CDP 目前只控制顶层 `Instant / Thinking / Pro` 选择器（`auto` 会视为 `instant`）
- **当前 caveat**：某些 Windows 桌面版里，长时间运行的 Pro 请求可能会在 Busy / 半成品界面状态停很久

### 推荐异步流程

```bash
opencli chatgpt send --reasoning pro "认真研究这个任务，不用急着回答"
opencli chatgpt status   # 可选：Busy=Yes 表示还在跑
opencli chatgpt read     # 稍后读取当前可见输出
```

📖 **完整文档**： [docs/adapters/desktop/chatgpt](../../../docs/adapters/desktop/chatgpt.md)
