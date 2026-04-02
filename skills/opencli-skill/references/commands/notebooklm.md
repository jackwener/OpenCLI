# notebooklm

## Commands

### current
- Purpose: Show metadata for the currently opened NotebookLM notebook tab
- Args: None
- Usage: `opencli notebooklm current [options] -f json`

### get
- Purpose: Get rich metadata for the currently opened NotebookLM notebook
- Args: None
- Usage: `opencli notebooklm get [options] -f json`

### history
- Purpose: List NotebookLM conversation history threads in the current notebook
- Args: None
- Usage: `opencli notebooklm history [options] -f json`

### list
- Purpose: List NotebookLM notebooks via in-page batchexecute RPC in the current logged-in session
- Args: None
- Usage: `opencli notebooklm list [options] -f json`

### note-list
- Purpose: List saved notes from the Studio panel of the current NotebookLM notebook
- Args: None
- Usage: `opencli notebooklm note-list [options] -f json`

### notes-get
- Purpose: Get one note from the current NotebookLM notebook by title from the visible note editor
- Args:
  - `note`(required); Note title or id from the current notebook
- Usage: `opencli notebooklm notes-get [options] -f json`

### open
- Purpose: Open one NotebookLM notebook in the automation workspace by id or URL
- Args:
  - `notebook`(required); Notebook id from list output, or a full NotebookLM notebook URL
- Usage: `opencli notebooklm open [options] -f json`

### rpc
- Purpose: notebooklm rpc operation
- Args: None
- Usage: `opencli notebooklm rpc [options] -f json`

### source-fulltext
- Purpose: Get the extracted fulltext for one source in the currently opened NotebookLM notebook
- Args:
  - `source`(required); Source id or title from the current notebook
- Usage: `opencli notebooklm source-fulltext [options] -f json`

### source-get
- Purpose: Get one source from the currently opened NotebookLM notebook by id or title
- Args:
  - `source`(required); Source id or title from the current notebook
- Usage: `opencli notebooklm source-get [options] -f json`

### source-guide
- Purpose: Get the guide summary and keywords for one source in the currently opened NotebookLM notebook
- Args:
  - `source`(required); Source id or title from the current notebook
- Usage: `opencli notebooklm source-guide [options] -f json`

### source-list
- Purpose: List sources for the currently opened NotebookLM notebook
- Args: None
- Usage: `opencli notebooklm source-list [options] -f json`

### status
- Purpose: Check NotebookLM page availability and login state in the current Chrome session
- Args: None
- Usage: `opencli notebooklm status [options] -f json`

### summary
- Purpose: Get the summary block from the currently opened NotebookLM notebook
- Args: None
- Usage: `opencli notebooklm summary [options] -f json`
