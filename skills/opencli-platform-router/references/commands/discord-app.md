# discord-app

## Commands

### channels
- 用途：List channels in the current Discord server
- 参数：无
- 用法：`opencli discord-app channels [options] -f json`

### members
- 用途：List online members in the current Discord channel
- 参数：无
- 用法：`opencli discord-app members [options] -f json`

### read
- 用途：Read recent messages from the active Discord channel
- 参数：
  - `count`（可选）：默认值 20)'；Number of messages to read (default: 20)
- 用法：`opencli discord-app read [options] -f json`

### search
- 用途：Search messages in the current Discord server/channel (Cmd+F)
- 参数：
  - `query`（必填）：Search query
- 用法：`opencli discord-app search [options] -f json`

### send
- 用途：Send a message in the active Discord channel
- 参数：
  - `text`（必填）：Message to send
- 用法：`opencli discord-app send [options] -f json`

### servers
- 用途：List all Discord servers (guilds) in the sidebar
- 参数：无
- 用法：`opencli discord-app servers [options] -f json`

### status
- 用途：Check active CDP connection to Discord Desktop
- 参数：无
- 用法：`opencli discord-app status [options] -f json`
