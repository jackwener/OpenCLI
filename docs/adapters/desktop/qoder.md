# Qoder

Control the **Qoder IDE** desktop app from OpenCLI through Chrome DevTools Protocol (CDP). Qoder is an Electron / VS Code-derived AI IDE; these commands operate the currently connected Qoder renderer, so open Qoder with remote debugging enabled before use.

## Prerequisites

1. Install Qoder.
2. Launch Qoder with CDP enabled on its registered port:

```bash
/Applications/Qoder.app/Contents/MacOS/Electron \
  --remote-debugging-port=9237 \
  --remote-allow-origins='*'
```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9237"
```

## Commands

### Diagnostics

- `opencli qoder status`: Check the active Qoder renderer URL and title.

### Quest Lifecycle

- `opencli qoder new`: Start a new Quest.
- `opencli qoder history --limit 20`: List visible Quests from the sidebar.
- `opencli qoder read --limit 30`: Read visible turns in the current Quest.
- `opencli qoder send "message"`: Send a message to the current Quest.
- `opencli qoder ask "prompt" --timeout 120`: Send a prompt and wait for a visible reply.

### Sidebar And Views

- `opencli qoder sidebar-toggle`: Collapse or expand the Quest sidebar.
- `opencli qoder open-panel`: Toggle the bottom panel.
- `opencli qoder search "query"`: Open the Qoder search palette and list results.
- `opencli qoder settings`: Open Settings.
- `opencli qoder knowledge`: Open Knowledge.
- `opencli qoder marketplace`: Open Marketplace.
- `opencli qoder credits`: Open Credits Usage and read the visible popover.
- `opencli qoder view-all`: Click View all in the Quest list.
- `opencli qoder add-workspace`: Open the Add Workspace folder picker.
- `opencli qoder account [--username name]`: Open the account menu and list items.
- `opencli qoder more-actions`: Open More Actions and list menu items.

### Composer

- `opencli qoder prompt-enhance`: Click Prompt Enhance for the current draft.
- `opencli qoder open-editor`: Open the current draft in Qoder's editor view.

## Notes

Most commands use Qoder's visible desktop UI as the source of truth. Commands that click a button will fail with a typed error if the target control is not visible in the current Qoder view. `send` and `ask` require post-submit evidence from the visible Quest before returning success.
