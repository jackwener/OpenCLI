# doubao

## Commands

### ask
- Purpose: Send a prompt and wait for the Doubao response
- Args:
  - `text`(required); Prompt to send
  - `timeout`(optional; default: 60)'); Max seconds to wait (default: 60)
- Usage: `opencli doubao ask [options] -f json`

### detail
- Purpose: Read a specific Doubao conversation by ID
- Args:
  - `id`(required); Conversation ID (numeric or full URL)
- Usage: `opencli doubao detail [options] -f json`

### history
- Purpose: List conversation history from Doubao sidebar
- Args:
  - `limit`(optional; default: '50'); Max number of conversations to show
- Usage: `opencli doubao history [options] -f json`

### meeting-summary
- Purpose: Get meeting summary and chapters from a Doubao conversation
- Args:
  - `id`(required); Conversation ID (numeric or full URL)
  - `chapters`(optional; default: 'false'); Also include AI chapters
- Usage: `opencli doubao meeting-summary [options] -f json`

### meeting-transcript
- Purpose: Get or download the meeting transcript from a Doubao conversation
- Args:
  - `id`(required); Conversation ID (numeric or full URL)
  - `download`(optional; default: 'false'); Trigger browser file download instead of reading text
- Usage: `opencli doubao meeting-transcript [options] -f json`

### new
- Purpose: Start a new conversation in Doubao web chat
- Args: None
- Usage: `opencli doubao new [options] -f json`

### read
- Purpose: Read the current Doubao conversation history
- Args: None
- Usage: `opencli doubao read [options] -f json`

### send
- Purpose: Send a message to Doubao web chat
- Args:
  - `text`(required); Message to send
- Usage: `opencli doubao send [options] -f json`

### status
- Purpose: Check Doubao chat page availability and login state
- Args: None
- Usage: `opencli doubao status [options] -f json`
