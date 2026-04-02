# gemini

## Commands

### ask
- Purpose: Send a prompt to Gemini and return only the assistant response
- Args:
  - `prompt`(required); Prompt to send
  - `timeout`(optional; default: 60)'); Max seconds to wait (default: 60)
  - `new`(optional; default: false)'); Start a new chat first (true/false, default: false)
- Usage: `opencli gemini ask [options] -f json`

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
