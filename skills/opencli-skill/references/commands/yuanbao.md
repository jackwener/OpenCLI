# yuanbao

## Commands

### ask
- Purpose: Send a prompt to Yuanbao web chat and wait for the assistant response
- Args:
  - `prompt`(required); Prompt to send
  - `timeout`(optional; default: 60)'); Max seconds to wait (default: 60)
  - `search`(optional; type: boolean; default: true)'); Enable Yuanbao internet search (default: true)
  - `think`(optional; type: boolean; default: false)'); Enable Yuanbao deep thinking (default: false)
- Usage: `opencli yuanbao ask [options] -f json`

### new
- Purpose: Start a new conversation in Yuanbao web chat
- Args: None
- Usage: `opencli yuanbao new [options] -f json`
