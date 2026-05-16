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

## Configuration

### `opencli_disable_automation_tab_group` (chrome.storage.local, boolean)

When set to `true`, the extension stops placing owned tabs into a named tab
group (`OpenCLI Browser` / `OpenCLI Adapter`). Tabs are still tracked
internally by id, so adapters keep working — only the visual grouping is
suppressed.

Why this exists: Chrome 119+ ships a "Saved Tab Groups" feature that
auto-saves any named/colored tab group to the user's sidebar and keeps it
there even after the underlying window is closed. For automation-heavy
workflows that spin up many short-lived owned windows, this causes
`OpenCLI Adapter` (or `OpenCLI Browser`) entries to accumulate. The flag
lets users opt out.

To enable, open the extension's service worker DevTools console
(`chrome://extensions` → OpenCLI → "Inspect views: service worker") and run:

```js
chrome.storage.local.set({ opencli_disable_automation_tab_group: true });
```

To revert, set the same key to `false` (or remove it) and reload the
extension. The default behavior (tab grouping enabled) is unchanged.
