# cursor

## Commands

### ask
- 用途：Send a prompt and wait for the AI response (send + wait + read)
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：默认值 30)'；Max seconds to wait for response (default: 30)
- 用法：`opencli cursor ask [options] -f json`

### composer
- 用途：Send a prompt directly into Cursor Composer (Cmd+I shortcut)
- 参数：
  - `text`（必填）：Text to send into Composer
- 用法：`opencli cursor composer [options] -f json`

### dump
- 用途：Dump the DOM and Accessibility tree of Cursor for reverse-engineering
- 参数：无
- 用法：`opencli cursor dump [options] -f json`

### extract-code
- 用途：Extract multi-line code blocks from the current Cursor conversation
- 参数：无
- 用法：`opencli cursor extract-code [options] -f json`

### history
- 用途：List recent chat sessions from the Cursor sidebar
- 参数：无
- 用法：`opencli cursor history [options] -f json`

### model
- 用途：Get or switch the currently active AI model in Cursor
- 参数：
  - `model-name`（可选）：The ID of the model to switch to (e.g. claude-3.5-sonnet)
- 用法：`opencli cursor model [options] -f json`

### new
- 用途：Start a new Cursor chat or Composer session
- 参数：无
- 用法：`opencli cursor new [options] -f json`

### read
- 用途：Read the current Cursor chat/composer conversation history
- 参数：无
- 用法：`opencli cursor read [options] -f json`

### send
- 用途：Send a prompt directly into Cursor Composer/Chat
- 参数：
  - `text`（必填）：Text to send into Cursor
- 用法：`opencli cursor send [options] -f json`

### status
- 用途：Check active CDP connection to Cursor AI Editor
- 参数：无
- 用法：`opencli cursor status [options] -f json`
