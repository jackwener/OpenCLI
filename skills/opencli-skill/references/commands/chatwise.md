# chatwise

## Commands

### ask
- Purpose: Send a prompt and wait for the AI response (send + wait + read)
- Args:
  - `text`(required); Prompt to send
  - `timeout`(optional; default: 30)'); Max seconds to wait (default: 30)
- Usage: `opencli chatwise ask [options] -f json`

### export
- Purpose: Export the current ChatWise conversation to a Markdown file
- Args:
  - `output`(optional; default: /tmp/chatwise-export.md)'); Output file (default: /tmp/chatwise-export.md)
- Usage: `opencli chatwise export [options] -f json`

### history
- Purpose: List conversation history in ChatWise sidebar
- Args: None
- Usage: `opencli chatwise history [options] -f json`

### model
- Purpose: Get or switch the active AI model in ChatWise
- Args:
  - `model-name`(optional); Model to switch to (e.g. gpt-4, claude-3)
- Usage: `opencli chatwise model [options] -f json`

### new
- Purpose: Start a new conversation in ChatWise
- Args: None
- Usage: `opencli chatwise new [options] -f json`

### read
- Purpose: Read the current ChatWise conversation history
- Args: None
- Usage: `opencli chatwise read [options] -f json`

### screenshot
- Purpose: Capture a snapshot of the current ChatWise window (DOM + Accessibility tree)
- Args: None
- Usage: `opencli chatwise screenshot [options] -f json`

### send
- Purpose: Send a message to the active ChatWise conversation
- Args:
  - `text`(required); Message to send
- Usage: `opencli chatwise send [options] -f json`

### status
- Purpose: Check active CDP connection to ChatWise Desktop
- Args: None
- Usage: `opencli chatwise status [options] -f json`
