# gemini

## Commands

### ask
- Purpose: Send a prompt to Gemini and return only the assistant response
- Args:
  - `prompt`(required); Prompt to send
  - `timeout`(optional; default: 60)'); Max seconds to wait (default: 60)
  - `new`(optional; default: false)'); Start a new chat first (true/false, default: false)
- Usage: `opencli gemini ask [options] -f json`

### deep-research
- Purpose: Start a Gemini Deep Research run and confirm it
- Args:
  - `prompt`(required); Prompt to send
  - `timeout`(optional; type: int; default: 30)'); Max seconds to wait for confirm (default: 30)
  - `tool`(optional; default: Deep Research)'); Override tool label (default: Deep Research)
  - `confirm`(optional; default: Start research)'); Override confirm button label (default: Start research)
- Usage: `opencli gemini deep-research [options] -f json`

### deep-research-result
- Purpose: Export Deep Research report URL from a Gemini conversation
- Args:
  - `query`(optional); Conversation title or URL (optional; defaults to latest conversation)
  - `match`(optional; default: 'contains'); Match mode
  - `timeout`(optional; type: int; default: 120); Max seconds to wait for Docs export (default: 120)
- Usage: `opencli gemini deep-research-result [options] -f json`

### image
- Purpose: Generate images with Gemini web and save them locally
- Args:
  - `prompt`(required); Image prompt to send to Gemini
  - `rt`(optional; default: '1:1'); Ratio shorthand for aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3)
  - `st`(optional; default: ''); Style shorthand, e.g. anime, icon, watercolor
  - `op`(optional; default: path.join(os.homedir()); Output directory shorthand
  - `sd`(optional; type: boolean; default: false); Skip download shorthand; only show Gemini page link
- Usage: `opencli gemini image [options] -f json`

### new
- Purpose: Start a new conversation in Gemini web chat
- Args: None
- Usage: `opencli gemini new [options] -f json`
