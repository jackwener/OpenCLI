# doubao-app

## Commands

### ask
- 用途：Send a message to Doubao desktop app and wait for the AI response
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：类型 int；默认值 30；Max seconds to wait for response
- 用法：`opencli doubao-app ask [options] -f json`

### dump
- 用途：Dump Doubao desktop app DOM and snapshot to /tmp for debugging
- 参数：无
- 用法：`opencli doubao-app dump [options] -f json`

### new
- 用途：Start a new chat in Doubao desktop app
- 参数：无
- 用法：`opencli doubao-app new [options] -f json`

### read
- 用途：Read chat history from Doubao desktop app
- 参数：无
- 用法：`opencli doubao-app read [options] -f json`

### screenshot
- 用途：Capture a screenshot of the Doubao desktop app window
- 参数：
  - `output`（可选）：默认值 /tmp/doubao-screenshot.png)'；Output file path (default: /tmp/doubao-screenshot.png)
- 用法：`opencli doubao-app screenshot [options] -f json`

### send
- 用途：Send a message to Doubao desktop app
- 参数：
  - `text`（必填）：Message text to send
- 用法：`opencli doubao-app send [options] -f json`

### status
- 用途：Check CDP connection to Doubao desktop app
- 参数：无
- 用法：`opencli doubao-app status [options] -f json`
