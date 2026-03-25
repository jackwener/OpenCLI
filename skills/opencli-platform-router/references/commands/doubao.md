# doubao

## Commands

### ask
- 用途：Send a prompt and wait for the Doubao response
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：默认值 60)'；Max seconds to wait (default: 60)
- 用法：`opencli doubao ask [options] -f json`

### new
- 用途：Start a new conversation in Doubao web chat
- 参数：无
- 用法：`opencli doubao new [options] -f json`

### read
- 用途：Read the current Doubao conversation history
- 参数：无
- 用法：`opencli doubao read [options] -f json`

### send
- 用途：Send a message to Doubao web chat
- 参数：
  - `text`（必填）：Message to send
- 用法：`opencli doubao send [options] -f json`

### status
- 用途：Check Doubao chat page availability and login state
- 参数：无
- 用法：`opencli doubao status [options] -f json`
