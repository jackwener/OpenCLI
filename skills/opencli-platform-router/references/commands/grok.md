# grok

## Commands

### ask
- 用途：Send a message to Grok and get response
- 参数：
  - `prompt`（必填）：类型 string；Prompt to send to Grok
  - `timeout`（可选）：类型 int；默认值 120；Max seconds to wait for response (default: 120)
  - `new`（可选）：类型 boolean；默认值 false；Start a new chat before sending (default: false)
  - `web`（可选）：类型 boolean；默认值 false；Use the explicit grok.com consumer web flow (default: false)
- 用法：`opencli grok ask [options] -f json`
