# antigravity

## Commands

### dump
- Purpose: Dump the DOM to help AI understand the UI
- Args: None
- Usage: `opencli antigravity dump [options] -f json`

### extract-code
- Purpose: Extract multi-line code blocks from the current Antigravity conversation
- Args: None
- Usage: `opencli antigravity extract-code [options] -f json`

### model
- Purpose: Switch the active LLM model in Antigravity
- Args:
  - `name`(required); Target model name (e.g. claude, gemini, o1)
- Usage: `opencli antigravity model [options] -f json`

### new
- Purpose: Start a new conversation / clear context in Antigravity
- Args: None
- Usage: `opencli antigravity new [options] -f json`

### read
- Purpose: Read the latest chat messages from Antigravity AI
- Args:
  - `last`(optional); Number of recent messages to read (not fully implemented due to generic structure, currently returns full history text or latest chunk)
- Usage: `opencli antigravity read [options] -f json`

### send
- Purpose: Send a message to Antigravity AI via the internal Lexical editor
- Args:
  - `message`(required); The message text to send
- Usage: `opencli antigravity send [options] -f json`

### serve
- Purpose: antigravity serve operation
- Args: None
- Usage: `opencli antigravity serve [options] -f json`

### status
- Purpose: Check Antigravity CDP connection and get current page state
- Args: None
- Usage: `opencli antigravity status [options] -f json`

### watch
- Purpose: Stream new chat messages from Antigravity in real-time
- Args: None
- Usage: `opencli antigravity watch [options] -f json`
