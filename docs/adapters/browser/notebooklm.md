# NotebookLM

**Mode**: 🔐 Browser Bridge · **Domain**: `notebooklm.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli notebooklm status` | Check whether NotebookLM is reachable in the current Chrome session |
| `opencli notebooklm list` | List notebooks visible from the NotebookLM home page |
| `opencli notebooklm open <notebook>` | Open one notebook in the NotebookLM automation workspace by id or URL |
| `opencli notebooklm current` | Show metadata for the currently opened notebook in the automation workspace |
| `opencli notebooklm get` | Get richer metadata for the current notebook |
| `opencli notebooklm source-list` | List sources in the current notebook |
| `opencli notebooklm source-get <source>` | Resolve one source in the current notebook by id or title |
| `opencli notebooklm source-fulltext <source>` | Fetch extracted source fulltext through NotebookLM RPC |
| `opencli notebooklm source-guide <source>` | Fetch guide summary and keywords for one source |
| `opencli notebooklm history` | List conversation history threads for the current notebook |
| `opencli notebooklm note-list` | List Studio notes visible in the current notebook |
| `opencli notebooklm notes-get <note>` | Read the currently visible Studio note by title |
| `opencli notebooklm summary` | Read the current notebook summary |

## Compatibility Aliases

| Alias | Canonical command |
|-------|-------------------|
| `opencli notebooklm select <notebook>` | `opencli notebooklm open <notebook>` |
| `opencli notebooklm metadata` | `opencli notebooklm get` |
| `opencli notebooklm notes-list` | `opencli notebooklm note-list` |

## Positioning

This adapter reuses the existing OpenCLI Browser Bridge runtime:

- no custom NotebookLM extension
- no exported cookie replay
- requests and page state stay in the real Chrome session

The current milestone focuses on a stable NotebookLM read surface in desktop Chrome with an already logged-in Google account.

## Usage Examples

```bash
opencli notebooklm status
opencli notebooklm list -f json
opencli notebooklm open nb-demo -f json
opencli notebooklm current -f json
opencli notebooklm metadata -f json
opencli notebooklm source-list -f json
opencli notebooklm source-get "Quarterly report" -f json
opencli notebooklm source-guide "Quarterly report" -f json
opencli notebooklm source-fulltext "Quarterly report" -f json
opencli notebooklm history -f json
opencli notebooklm notes-list -f json
opencli notebooklm notes-get "Draft note" -f json
opencli notebooklm summary -f json
```

## Prerequisites

- Chrome running and logged into Google / NotebookLM
- [Browser Bridge extension](/guide/browser-bridge) installed
- NotebookLM accessible in the current browser session

## Notes

- Notebook-oriented commands run in OpenCLI's owned NotebookLM automation workspace/window. Use `opencli notebooklm open <notebook>` first to choose the current notebook for follow-up commands.
- `list`, `get`, `source-list`, `history`, `source-fulltext`, and `source-guide` prefer NotebookLM RPC paths and fall back only when the richer path is unavailable.
- `notes-get` currently reads note content only from the visible Studio note editor; if the note is listed but not open, open it in NotebookLM first and then retry.
