# codex

## Commands

### ask
- Purpose: Send a prompt and wait for the AI response (send + wait + read)
- Args:
  - `text`(required); Prompt to send
  - `timeout`(optional; default: 60)'); Max seconds to wait for response (default: 60)
- Usage: `opencli codex ask [options] -f json`

### dump
- Purpose: Dump the DOM and Accessibility tree of Codex for reverse-engineering
- Args: None
- Usage: `opencli codex dump [options] -f json`

### export
- Purpose: Export the current Codex conversation to a Markdown file
- Args:
  - `output`(optional; default: /tmp/codex-export.md)'); Output file (default: /tmp/codex-export.md)
- Usage: `opencli codex export [options] -f json`

### extract-diff
- Purpose: Extract visual code review diff patches from Codex
- Args: None
- Usage: `opencli codex extract-diff [options] -f json`

### history
- Purpose: List recent conversation threads in Codex
- Args: None
- Usage: `opencli codex history [options] -f json`

### model
- Purpose: Get or switch the currently active AI model in Codex Desktop
- Args:
  - `model-name`(optional); The ID of the model to switch to (e.g. gpt-4)
- Usage: `opencli codex model [options] -f json`

### new
- Purpose: Start a new Codex conversation thread / isolated workspace
- Args: None
- Usage: `opencli codex new [options] -f json`

### read
- Purpose: Read the contents of the current Codex conversation thread
- Args: None
- Usage: `opencli codex read [options] -f json`

### screenshot
- Purpose: Capture a snapshot of the current Codex window (DOM + Accessibility tree)
- Args: None
- Usage: `opencli codex screenshot [options] -f json`

### send
- Purpose: Send text/commands to the Codex AI composer
- Args:
  - `text`(required); Text, command (e.g. /review), or skill (e.g. $imagegen)
- Usage: `opencli codex send [options] -f json`

### status
- Purpose: Check active CDP connection to OpenAI Codex App
- Args: None
- Usage: `opencli codex status [options] -f json`
