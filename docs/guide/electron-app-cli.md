---
description: How to turn a new Electron desktop app into an OpenCLI adapter
---

# Add a New Electron App CLI

This guide is the **fast entry point** for turning a new Electron desktop application into an OpenCLI adapter.

If you want the full background and deeper SOP, read:
- [CLI-ifying Electron Applications](/advanced/electron)
- [Chrome DevTools Protocol](/advanced/cdp)
- [TypeScript Adapter Guide](/developer/ts-adapter)

## When to use this guide

Use this workflow when the target app:
- is built with **Electron**, or at least exposes a working **Chrome DevTools Protocol (CDP)** endpoint
- can be launched with `--remote-debugging-port=<port>`
- should be automated through its real UI instead of a public HTTP API

If the app is **not** Electron and does **not** expose CDP, use the native desktop automation pattern instead. See [CLI-ifying Electron Applications](/advanced/electron#non-electron-pattern-applescript).

## The shortest path

### 1. Confirm the app is Electron

Typical macOS check:

```bash
ls /Applications/AppName.app/Contents/Frameworks/Electron\ Framework.framework
```

If Electron is present, the next step is usually to launch the app with a debugging port.

### 2. Launch it with CDP enabled

```bash
/Applications/AppName.app/Contents/MacOS/AppName --remote-debugging-port=9222
```

Then point OpenCLI at that CDP endpoint:

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
```

### 3. Start with the 5-command pattern

For a new Electron adapter, implement these commands first in `src/clis/<app>/`:

- `status.ts` — verify the app is reachable through CDP
- `dump.ts` — inspect DOM and snapshot structure before guessing selectors
- `read.ts` — extract the visible context you actually need
- `send.ts` — inject text and submit through the real editor
- `new.ts` — create a new session, tab, thread, or document

This is the standard baseline because it gives you:
- a connection check
- a reverse-engineering tool
- one read path
- one write path
- one session reset path

The full rationale and examples are in [CLI-ifying Electron Applications](/advanced/electron).

## Recommended implementation workflow

### Step 1: Build `status`

Goal: prove CDP connectivity before touching app-specific logic.

Typical checks:
- current URL
- document title
- app shell presence

If `status` is unstable, stop there and fix connectivity first.

### Step 2: Build `dump`

Do **not** guess selectors from the rendered UI.

Dump:
- `document.body.innerHTML`
- accessibility snapshot
- any stable attributes such as `data-testid`, `role`, `aria-*`, framework-specific markers

Use the dump to identify real containers, buttons, composers, and conversation regions.

### Step 3: Build `read`

Target only the app region that matters.

Good targets:
- message list
- editor history
- visible thread content
- selected document panel

Avoid dumping the entire page text into the final command output.

### Step 4: Build `send`

Most Electron apps use React-style controlled editors, so direct `.value = ...` assignments are often ignored.

Prefer editor-aware input patterns such as:
- focus the editable region
- use `document.execCommand('insertText', false, text)` when applicable
- use real key presses like `Enter`, `Meta+Enter`, or app-specific shortcuts

### Step 5: Build `new`

Many desktop apps rely on keyboard shortcuts for “new chat”, “new tab”, or “new note”.

Typical pattern:

```ts
const isMac = process.platform === 'darwin';
await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
await page.wait(1);
```

## Where to put files

For a TypeScript desktop adapter, the usual layout is:

```text
src/clis/<app>/status.ts
src/clis/<app>/dump.ts
src/clis/<app>/read.ts
src/clis/<app>/send.ts
src/clis/<app>/new.ts
src/clis/<app>/utils.ts
```

If the app grows beyond the baseline, add higher-level commands such as:
- `ask`
- `history`
- `model`
- `screenshot`
- `export`

## What to document when you add a new app

When the adapter is ready, also add:

- an adapter doc under `docs/adapters/desktop/`
- command list and examples
- launch instructions with `--remote-debugging-port`
- any required environment variables
- platform-specific caveats

Examples to study:
- `docs/adapters/desktop/codex.md`
- `docs/adapters/desktop/chatwise.md`
- `docs/adapters/desktop/notion.md`
- `docs/adapters/desktop/discord.md`

## Common failure modes

### CDP endpoint exists, but commands are flaky

Usually one of these:
- the wrong window/tab is selected
- the app has not finished rendering
- selectors were guessed instead of discovered from `dump`
- the editor is controlled and ignores direct value assignment

### The app is Chromium-based but not truly controllable

Some desktop apps embed Chromium but do not expose a usable CDP surface.
In that case, switch to the non-Electron desktop automation approach instead of forcing the Electron pattern.

### You already have a browser workflow and wonder whether to reuse it

If the app exposes a normal web URL and the browser flow is enough, a browser adapter is usually simpler.
Use an Electron adapter only when the desktop app is the real integration surface.

## Recommended reading order

If you are starting from zero:

1. This page
2. [CLI-ifying Electron Applications](/advanced/electron)
3. [Chrome DevTools Protocol](/advanced/cdp)
4. [TypeScript Adapter Guide](/developer/ts-adapter)
5. One concrete desktop adapter doc under `docs/adapters/desktop/`

## Practical rule

Do not start with a large feature surface.

Start with:
- `status`
- `dump`
- `read`
- `send`
- `new`

Once those are stable, extend outward.
