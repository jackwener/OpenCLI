# antigravity

## Commands

### dump
- 用途：Dump the DOM to help AI understand the UI
- 参数：无
- 用法：`opencli antigravity dump [options] -f json`

### extract-code
- 用途：Extract multi-line code blocks from the current Antigravity conversation
- 参数：无
- 用法：`opencli antigravity extract-code [options] -f json`

### model
- 用途：Switch the active LLM model in Antigravity
- 参数：
  - `name`（必填）：Target model name (e.g. claude, gemini, o1)
- 用法：`opencli antigravity model [options] -f json`

### new
- 用途：Start a new conversation / clear context in Antigravity
- 参数：无
- 用法：`opencli antigravity new [options] -f json`

### read
- 用途：Read the latest chat messages from Antigravity AI
- 参数：
  - `last`（可选）：Number of recent messages to read (not fully implemented due to generic structure, currently returns full history text or latest chunk)
- 用法：`opencli antigravity read [options] -f json`

### send
- 用途：Send a message to Antigravity AI via the internal Lexical editor
- 参数：
  - `message`（必填）：The message text to send
- 用法：`opencli antigravity send [options] -f json`

### status
- 用途：Check Antigravity CDP connection and get current page state
- 参数：无
- 用法：`opencli antigravity status [options] -f json`

### watch
- 用途：Stream new chat messages from Antigravity in real-time
- 参数：无
- 用法：`opencli antigravity watch [options] -f json`
