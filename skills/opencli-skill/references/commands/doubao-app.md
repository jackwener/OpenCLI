# doubao-app

## Commands

### ask
- Purpose: Send a message to Doubao desktop app and wait for the AI response
- Args:
  - `text`(required); Prompt to send
  - `timeout`(optional; type: int; default: 30); Max seconds to wait for response
- Usage: `opencli doubao-app ask [options] -f json`

### dump
- Purpose: Dump Doubao desktop app DOM and snapshot to /tmp for debugging
- Args: None
- Usage: `opencli doubao-app dump [options] -f json`

### new
- Purpose: Start a new chat in Doubao desktop app
- Args: None
- Usage: `opencli doubao-app new [options] -f json`

### read
- Purpose: Read chat history from Doubao desktop app
- Args: None
- Usage: `opencli doubao-app read [options] -f json`

### screenshot
- Purpose: Capture a screenshot of the Doubao desktop app window
- Args:
  - `output`(optional; default: /tmp/doubao-screenshot.png)'); Output file path (default: /tmp/doubao-screenshot.png)
- Usage: `opencli doubao-app screenshot [options] -f json`

### send
- Purpose: Send a message to Doubao desktop app
- Args:
  - `text`(required); Message text to send
- Usage: `opencli doubao-app send [options] -f json`

### status
- Purpose: Check CDP connection to Doubao desktop app
- Args: None
- Usage: `opencli doubao-app status [options] -f json`
