# OpenCLI Browser Bridge Extension

The extension connects Chrome tabs to the local OpenCLI daemon. It uses Chrome
extension APIs only as a transport and browser-control layer for explicit CLI
commands.

## Permission Notes

- `debugger`: sends CDP commands to OpenCLI-controlled or bound tabs.
- `tabs` / `tabGroups`: manages the dedicated OpenCLI automation container and
  reports selected tab metadata back to the CLI.
- `cookies`: reads cookies for browser-backed adapters that need authenticated
  fetches.
- `downloads`: surfaces download lifecycle to `opencli browser wait download`.
  The extension observes started / in-progress / completed / failed downloads so
  the CLI can wait for a file triggered by an automation command. OpenCLI
  filters by the command's filename/URL pattern and timeout, and does not modify,
  redirect, or persist browser download history.

Suggested Chrome Web Store justification for `downloads`:

> This extension uses `chrome.downloads` to surface download lifecycle
> (started / in-progress / completed / failed) to the OpenCLI command-line tool,
> so agents can wait for downloads triggered during an automation workflow. The
> command filters by a user-provided filename or URL pattern and timeout. We do
> not modify, redirect, or persist user download history.

## Browser Tab Groups

OpenCLI groups browser-session tabs under `OpenCLI Browser` by default. To keep
those tabs ungrouped, open the extension popup and turn off **Group browser
tabs**. The preference is stored in the Chrome profile and takes effect for
existing live OpenCLI groups as well as future browser sessions.

Chrome does not expose saved tab groups through the extension API. Turning the
setting off prevents new saved `OpenCLI Browser` entries, but previously saved
`OpenCLI Browser` entries and legacy `OpenCLI Adapter` entries must be removed
once from Chrome's saved tab groups bar.
