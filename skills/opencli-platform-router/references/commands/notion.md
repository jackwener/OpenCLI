# notion

## Commands

### export
- 用途：Export the current Notion page as Markdown
- 参数：
  - `output`（可选）：默认值 /tmp/notion-export.md)'；Output file (default: /tmp/notion-export.md)
- 用法：`opencli notion export [options] -f json`

### favorites
- 用途：List pages from the Notion Favorites section in the sidebar
- 参数：无
- 用法：`opencli notion favorites [options] -f json`

### new
- 用途：Create a new page in Notion
- 参数：
  - `title`（可选）：Page title (optional)
- 用法：`opencli notion new [options] -f json`

### read
- 用途：Read the content of the currently open Notion page
- 参数：无
- 用法：`opencli notion read [options] -f json`

### search
- 用途：Search pages and databases in Notion via Quick Find (Cmd+P)
- 参数：
  - `query`（必填）：Search query
- 用法：`opencli notion search [options] -f json`

### sidebar
- 用途：List pages and databases from the Notion sidebar
- 参数：无
- 用法：`opencli notion sidebar [options] -f json`

### status
- 用途：Check active CDP connection to Notion Desktop
- 参数：无
- 用法：`opencli notion status [options] -f json`

### write
- 用途：Append text content to the currently open Notion page
- 参数：
  - `text`（必填）：Text to append to the page
- 用法：`opencli notion write [options] -f json`
