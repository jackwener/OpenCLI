# chatwise

## Commands

### ask
- 用途：Send a prompt and wait for the AI response (send + wait + read)
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：默认值 30)'；Max seconds to wait (default: 30)
- 用法：`opencli chatwise ask [options] -f json`

### export
- 用途：Export the current ChatWise conversation to a Markdown file
- 参数：
  - `output`（可选）：默认值 /tmp/chatwise-export.md)'；Output file (default: /tmp/chatwise-export.md)
- 用法：`opencli chatwise export [options] -f json`

### history
- 用途：List conversation history in ChatWise sidebar
- 参数：无
- 用法：`opencli chatwise history [options] -f json`

### model
- 用途：Get or switch the active AI model in ChatWise
- 参数：
  - `model-name`（可选）：Model to switch to (e.g. gpt-4, claude-3)
- 用法：`opencli chatwise model [options] -f json`

### new
- 用途：Start a new conversation in ChatWise
- 参数：无
- 用法：`opencli chatwise new [options] -f json`

### read
- 用途：Read the current ChatWise conversation history
- 参数：无
- 用法：`opencli chatwise read [options] -f json`

### screenshot
- 用途：Capture a snapshot of the current ChatWise window (DOM + Accessibility tree)
- 参数：
  - `output`（可选）：默认值 /tmp/chatwise-snapshot)'；Output file path (default: /tmp/chatwise-snapshot)
- 用法：`opencli chatwise screenshot [options] -f json`

### send
- 用途：Send a message to the active ChatWise conversation
- 参数：
  - `text`（必填）：Message to send
- 用法：`opencli chatwise send [options] -f json`

### status
- 用途：Check active CDP connection to ChatWise Desktop
- 参数：无
- 用法：`opencli chatwise status [options] -f json`
