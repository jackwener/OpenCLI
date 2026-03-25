# chatgpt

## Commands

### ask
- 用途：Send a prompt and wait for the AI response (send + wait + read)
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：默认值 30)'；Max seconds to wait for response (default: 30)
- 用法：`opencli chatgpt ask [options] -f json`

### new
- 用途：Open a new chat in ChatGPT Desktop App
- 参数：无
- 用法：`opencli chatgpt new [options] -f json`

### read
- 用途：Read the last visible message from the focused ChatGPT Desktop window
- 参数：无
- 用法：`opencli chatgpt read [options] -f json`

### send
- 用途：Send a message to the active ChatGPT Desktop App window
- 参数：
  - `text`（必填）：Message to send
- 用法：`opencli chatgpt send [options] -f json`

### status
- 用途：Check if ChatGPT Desktop App is running natively on macOS
- 参数：无
- 用法：`opencli chatgpt status [options] -f json`
