# NotebookLM

**Mode**: 🔐 Browser Bridge · **Domain**: `notebooklm.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli notebooklm status` | Check whether NotebookLM is reachable in the current Chrome session |
| `opencli notebooklm list` | List notebooks visible from the NotebookLM home page |
| `opencli notebooklm current` | Show metadata for the currently opened notebook tab |

## Positioning

This adapter is intended to reuse the existing OpenCLI Browser Bridge runtime:

- no custom NotebookLM extension
- no exported cookie replay
- requests and page state stay in the real Chrome session

The first implementation focus is desktop Chrome with an already logged-in Google account.

## Usage Examples

```bash
opencli notebooklm status
opencli notebooklm list -f json
opencli notebooklm current -f json
```

## Prerequisites

- Chrome running and logged into Google / NotebookLM
- [Browser Bridge extension](/guide/browser-bridge) installed
- NotebookLM accessible in the current browser session

## Notes

- `list` currently reads notebooks visible from the NotebookLM home page DOM.
- `current` is useful as a lower-risk fallback when you already have a notebook tab open.
- More advanced NotebookLM actions should be added only after `status`, `list`, and `current` are stable.
