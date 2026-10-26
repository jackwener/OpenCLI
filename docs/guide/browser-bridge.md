# Browser Bridge Setup

> **⚠️ Important**: Browser commands reuse your Chrome login session. You must be logged into the target website in Chrome before running commands.

OpenCLI connects to your browser through a lightweight **Browser Bridge** Chrome Extension + micro-daemon (zero config, auto-start).

## Extension Installation

### Method 1: Chrome Web Store (Recommended)

Install **OpenCLI** from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk).

### Method 2: Download Pre-built Release

1. Go to the GitHub [Releases page](https://github.com/jackwener/opencli/releases) and download the latest `opencli-extension-v{version}.zip`.
2. Unzip the file and open `chrome://extensions`, enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the unzipped folder.

### Method 3: Load Unpacked Source (For Developers)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory from the repository.

## Verification

That's it! The daemon auto-starts when you run any browser command. No tokens, no manual configuration.

```bash
opencli doctor            # Check extension + daemon connectivity
```

## Tab Targeting

Browser commands require an explicit `--session <name>` option. Use the same session name for a multi-step flow, and use different names to isolate parallel work.

```bash
opencli browser --session baidu open https://www.baidu.com/
opencli browser --session baidu tab list
opencli browser --session baidu tab new https://www.baidu.com/
opencli browser --session baidu eval --tab <targetId> 'document.title'
opencli browser --session baidu tab select <targetId>
opencli browser --session baidu get title
opencli browser --session baidu tab close <targetId>
```

Key rules:

- `opencli browser --session <session> open <url>` and `opencli browser --session <session> tab new [url]` return a `targetId`.
- `opencli browser --session <session> tab list` prints the `targetId` values of tabs that already exist.
- `--tab <targetId>` routes a single browser command to that specific tab.
- `tab new` creates a new tab but does not change the default browser target.
- `tab select <targetId>` makes that tab the default target for later untargeted `opencli browser ...` commands.
- `tab close <targetId>` removes the tab; if it was the current default target, the stored default is cleared.

## Session Lifecycle

Use a stable session name when you want multiple `opencli browser` commands to keep operating on the same page:

```bash
opencli browser --session my-session open https://example.com
opencli browser --session my-session state
opencli browser --session my-session extract "main"
```

Owned browser sessions use an interactive tab lease with a 10-minute idle timeout. Release it explicitly when done:

```bash
opencli browser --session my-session close
```

Use `opencli browser --session <session> bind` when you want to attach OpenCLI to a Chrome tab you already opened manually. Bound sessions do not have the owned-session idle close timer; they stay attached until `unbind`, tab close, window close, or daemon restart. For owned sessions, use `--window foreground` to watch OpenCLI work in a visible automation window, or `--window background` to keep that automation window out of the way.

The `OpenCLI Browser` and `OpenCLI Adapter` tab groups are extension-managed automation containers; avoid putting your own long-lived tabs in them or renaming them. When the last interactive lease is released in a single-tab window, its placeholder becomes an OpenCLI idle page. That marked idle window can be recovered after a browser restart or extension update. Recovery never relies on a group title or color; it leaves older unmarked windows, windows with content or additional tabs, and ambiguous duplicate markers untouched. Active page/session restoration is not supported by this mechanism.

## Native Chrome management

Use Chrome APIs to manage ordinary browser tabs, groups and windows:

```bash
opencli browser chrome describe
opencli browser chrome describe tabs.group
opencli browser chrome call tabs.query '[{}]'
opencli browser chrome call tabs.group '[{"tabIds":[123,456]}]'
opencli browser chrome call tabGroups.update '[789,{"title":"Research","color":"blue"}]'
opencli browser chrome call tabs.ungroup '[[123,456]]'
```

Replace the example IDs with **numeric Chrome IDs** returned by the native queries, not the `targetId` strings used by page commands. Arguments are a JSON array of positional arguments. The success envelope contains native Chrome values in `data`; methods returning nothing return `null`.

`describe` lists the supported browser-management methods. For a method it returns its signature, availability, current permissions and official reference URL. These commands use the selected `--profile` and do not attach a page. Native-created tabs and windows persist after the CLI exits. Mutations affecting an active OpenCLI session or its managed group return `managed_resource_conflict`.

## API discovery

```bash
opencli browser --session research open https://example.com
opencli browser --session research network --static
# Follow a returned request key to inspect its captured response:
opencli browser --session research network --detail '<key>'
```

`network` summarizes captured API requests; `--static` also parses loaded JavaScript with an AST scanner. Each candidate includes method, URL, parameter names and evidence (`network`, `static`, or `network+static`). Script locations and request keys link back to the evidence. Unresolved expressions appear as `EXPR`; they are not guessed into observed routes.

Static candidates are not executed. The agent decides which endpoints to investigate, writes a normal JS adapter, and runs it with the existing CLI. There is no draft store or activation workflow.

Limits are explicit: up to 20 document scripts, 2 MiB per script, a 2 MiB combined inline-script budget, and a 10-second timeout per external script. External scripts are fetched through Node without browser credentials. Imports, workers, alias/data-flow resolution and scripts not present in the current document are not crawled. The report includes parse/fetch errors, omitted scripts and `analysisComplete` for this bounded scan; it does not claim complete site coverage. A drained network buffer falls back to the session cache, with `networkSource` and `networkSavedAt` identifying cached evidence.

### Real-browser regression test

After building the CLI and extension, use Chrome for Testing or Chromium:

```bash
OPENCLI_P0_E2E=1 CHROME_PATH=/path/to/chrome npx vitest run tests/e2e/browser-p0-chrome.test.ts
```

The test uses a temporary Chrome profile and an installation copy with a separate port. It covers native group operations, discovery/cache, and the existing Node/browser JS adapter contracts.

## How It Works

```
┌─────────────┐     WebSocket      ┌──────────────┐     Chrome API     ┌─────────┐
│  opencli    │ ◄──────────────► │  micro-daemon │ ◄──────────────► │  Chrome  │
│  (Node.js)  │    localhost:19825  │  (auto-start) │    Extension       │ Browser  │
└─────────────┘                    └──────────────┘                    └─────────┘
```

The daemon manages the WebSocket connection between your CLI commands and the Chrome extension. The extension executes JavaScript in the context of web pages, with access to the logged-in session.

## Daemon Lifecycle

The daemon auto-starts on first browser command and stays alive persistently.

```bash
opencli daemon stop      # Graceful shutdown
```

The daemon is persistent — it stays alive until you explicitly stop it (`opencli daemon stop`) or uninstall the package.

## Running OpenCLI from a remote machine

If you need to run `opencli` on a remote server (CI runner, agent host) but keep the browser session on your local machine, see [Remote Orchestration](/guide/remote-orchestration). It walks through the SSH reverse-tunnel pattern so the daemon never leaves localhost.


### Native input and hidden pages

Native click, key, hover, double-click and drag actions require the target page
to report `document.visibilityState === 'visible'`. If Chrome reports a hidden
page (for example a background tab or a minimized/occluded window), OpenCLI
returns `COMMAND_EXEC` before dispatching native input. Visibility-check failures
also stop the action. Select the intended tab and restore/uncover its window,
then retry. OpenCLI does not automatically focus the window or replay a blocked
native action through synthetic DOM events. Visibility is a precondition, not a
verification that the application completed the requested action.
