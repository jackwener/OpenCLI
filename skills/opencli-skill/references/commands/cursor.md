# cursor

## Commands

### ask
- Purpose: Send a prompt and wait for the AI response (send + wait + read)
- Args:
  - `text`(required); Prompt to send
  - `timeout`(optional; default: 30)'); Max seconds to wait for response (default: 30)
- Usage: `opencli cursor ask [options] -f json`

### composer
- Purpose: Send a prompt directly into Cursor Composer (Cmd+I shortcut)
- Args:
  - `text`(required); Text to send into Composer
- Usage: `opencli cursor composer [options] -f json`

### dump
- Purpose: Dump the DOM and Accessibility tree of Cursor for reverse-engineering
- Args: None
- Usage: `opencli cursor dump [options] -f json`

### export
- Purpose: Export the current ${site} conversation to a Markdown file
- Args:
  - `output`(optional; default: /tmp/${site)
- Usage: `opencli cursor export [options] -f json`

### extract-code
- Purpose: Extract multi-line code blocks from the current Cursor conversation
- Args: None
- Usage: `opencli cursor extract-code [options] -f json`

### history
- Purpose: List recent chat sessions from the Cursor sidebar
- Args: None
- Usage: `opencli cursor history [options] -f json`

### model
- Purpose: Get or switch the currently active AI model in Cursor
- Args:
  - `model-name`(optional); The ID of the model to switch to (e.g. claude-3.5-sonnet)
- Usage: `opencli cursor model [options] -f json`

### new
- Purpose: Start a new Cursor chat or Composer session
- Args: None
- Usage: `opencli cursor new [options] -f json`

### read
- Purpose: Read the current Cursor chat/composer conversation history
- Args: None
- Usage: `opencli cursor read [options] -f json`

### screenshot
- Purpose: cursor screenshot operation
- Args: None
- Usage: `opencli cursor screenshot [options] -f json`

### send
- Purpose: Send a prompt directly into Cursor Composer/Chat
- Args:
  - `text`(required); Text to send into Cursor
- Usage: `opencli cursor send [options] -f json`

### status
- Purpose: Check active CDP connection to Cursor AI Editor
- Args: None
- Usage: `opencli cursor status [options] -f json`
