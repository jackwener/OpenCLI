# discord-app

## Commands

### channels
- Purpose: List channels in the current Discord server
- Args: None
- Usage: `opencli discord-app channels [options] -f json`

### members
- Purpose: List online members in the current Discord channel
- Args: None
- Usage: `opencli discord-app members [options] -f json`

### read
- Purpose: Read recent messages from the active Discord channel
- Args:
  - `count`(optional; default: 20)'); Number of messages to read (default: 20)
- Usage: `opencli discord-app read [options] -f json`

### search
- Purpose: Search messages in the current Discord server/channel (Cmd+F)
- Args:
  - `query`(required); Search query
- Usage: `opencli discord-app search [options] -f json`

### send
- Purpose: Send a message in the active Discord channel
- Args:
  - `text`(required); Message to send
- Usage: `opencli discord-app send [options] -f json`

### servers
- Purpose: List all Discord servers (guilds) in the sidebar
- Args: None
- Usage: `opencli discord-app servers [options] -f json`

### status
- Purpose: Check active CDP connection to Discord Desktop
- Args: None
- Usage: `opencli discord-app status [options] -f json`
