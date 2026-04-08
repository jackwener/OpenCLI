# notion

## Commands

### export
- Purpose: Export the current Notion page as Markdown
- Args:
  - `output`(optional; default: /tmp/notion-export.md)'); Output file (default: /tmp/notion-export.md)
- Usage: `opencli notion export [options] -f json`

### favorites
- Purpose: List pages from the Notion Favorites section in the sidebar
- Args: None
- Usage: `opencli notion favorites [options] -f json`

### new
- Purpose: Create a new page in Notion
- Args:
  - `title`(optional); Page title (optional)
- Usage: `opencli notion new [options] -f json`

### read
- Purpose: Read the content of the currently open Notion page
- Args: None
- Usage: `opencli notion read [options] -f json`

### search
- Purpose: Search pages and databases in Notion via Quick Find (Cmd+P)
- Args:
  - `query`(required); Search query
- Usage: `opencli notion search [options] -f json`

### sidebar
- Purpose: List pages and databases from the Notion sidebar
- Args: None
- Usage: `opencli notion sidebar [options] -f json`

### status
- Purpose: Check active CDP connection to Notion Desktop
- Args: None
- Usage: `opencli notion status [options] -f json`

### write
- Purpose: Append text content to the currently open Notion page
- Args:
  - `text`(required); Text to append to the page
- Usage: `opencli notion write [options] -f json`
