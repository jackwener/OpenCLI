# grok

## Commands

### ask
- Purpose: Send a message to Grok and get response
- Args:
  - `prompt`(required; type: string); Prompt to send to Grok
  - `timeout`(optional; type: int; default: 120); Max seconds to wait for response (default: 120)
  - `new`(optional; type: boolean; default: false); Start a new chat before sending (default: false)
  - `web`(optional; type: boolean; default: false); Use the explicit grok.com consumer web flow (default: false)
- Usage: `opencli grok ask [options] -f json`
