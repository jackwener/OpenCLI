# NotebookLM

**Mode**: 🔐 Browser Bridge · **Domain**: `notebooklm.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli notebooklm status` | Check whether NotebookLM is reachable in the current Chrome session |
| `opencli notebooklm list` | List notebooks visible from the NotebookLM home page |
| `opencli notebooklm open <notebook>` | Open one notebook in the NotebookLM adapter session by id or URL |
| `opencli notebooklm current` | Show metadata for the currently opened notebook in the adapter session |
| `opencli notebooklm get` | Get richer metadata for the current notebook |
| `opencli notebooklm source-list` | List sources in the current notebook |
| `opencli notebooklm source-get <source>` | Resolve one source in the current notebook by id or title |
| `opencli notebooklm source-fulltext <source>` | Fetch extracted source fulltext through NotebookLM RPC |
| `opencli notebooklm source-guide <source>` | Fetch guide summary and keywords for one source |
| `opencli notebooklm history` | List conversation history threads for the current notebook |
| `opencli notebooklm note-list` | List Studio notes visible in the current notebook |
| `opencli notebooklm notes-get <note>` | Read the currently visible Studio note by title |
| `opencli notebooklm summary` | Read the current notebook summary |
| `opencli notebooklm create <title> --execute` | Create a new NotebookLM notebook |
| `opencli notebooklm add-source <notebook> (--url <url> \| --content <text> \| --file <path>) --execute` | Add one source to an existing notebook |
| `opencli notebooklm write-note <notebook> --title <title> --content <markdown> --execute` | Create a Studio note in a notebook |
| `opencli notebooklm generate-audio <notebook> --execute` | Trigger Audio Overview generation for a notebook |
| `opencli notebooklm generate-slides <notebook> --execute` | Trigger slide deck generation for a notebook |

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

Read commands expose NotebookLM metadata, sources, notes, summaries, and history from desktop Chrome with an already logged-in Google account. Write commands call NotebookLM's in-page RPC endpoints from that same logged-in browser session and require an explicit `--execute` flag before any remote mutation is attempted.

## Usage Examples

```bash
opencli notebooklm status
opencli notebooklm list -f json
opencli notebooklm open nb-demo -f json
opencli notebooklm current -f json
opencli notebooklm get -f json
opencli notebooklm source-list -f json
opencli notebooklm source-get "Quarterly report" -f json
opencli notebooklm source-guide "Quarterly report" -f json
opencli notebooklm source-fulltext "Quarterly report" -f json
opencli notebooklm history -f json
opencli notebooklm note-list -f json
opencli notebooklm notes-get "Draft note" -f json
opencli notebooklm summary -f json

# Write commands refuse to mutate unless --execute is present.
opencli notebooklm create "Research Brief" --emoji "📒" --execute
opencli notebooklm add-source 17e2b882-6a01-4c6c-9262-0738dfa2abee --url https://example.com/report --execute
opencli notebooklm add-source 17e2b882-6a01-4c6c-9262-0738dfa2abee --content "Source text" --title "Pasted source" --execute
opencli notebooklm add-source 17e2b882-6a01-4c6c-9262-0738dfa2abee --file ./paper.pdf --execute
opencli notebooklm write-note 17e2b882-6a01-4c6c-9262-0738dfa2abee --title "Open questions" --content "## Next steps" --execute
opencli notebooklm generate-audio 17e2b882-6a01-4c6c-9262-0738dfa2abee --execute
opencli notebooklm generate-slides 17e2b882-6a01-4c6c-9262-0738dfa2abee --length 3 --language en --execute
```

## Prerequisites

- Chrome running and logged into Google / NotebookLM
- [Browser Bridge extension](/guide/browser-bridge) installed
- NotebookLM accessible in the current browser session

## Notes

- Notebook-oriented commands run in OpenCLI's owned NotebookLM adapter session/window. Use `opencli notebooklm open <notebook>` first to choose the current notebook for follow-up commands.
- `list`, `get`, `source-list`, `history`, `source-fulltext`, and `source-guide` prefer NotebookLM RPC paths and fall back only when the richer path is unavailable.
- `notes-get` currently reads note content only from the visible Studio note editor; if the note is listed but not open, open it in NotebookLM first and then retry.
- All NotebookLM write commands require `--execute` and fail before opening a browser/RPC write path when it is absent.
- Write commands accept a bare notebook UUID or a canonical `https://notebooklm.google.com/notebook/<uuid>` URL. Off-domain, non-HTTPS, credentialed, or custom-port notebook URLs are rejected.
- `add-source` accepts exactly one source input: `--url`, `--content`, or `--file`.
