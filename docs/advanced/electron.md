---
description: How to CLI-ify and automate any Electron Desktop Application via CDP
---

# CLI-ifying Electron Applications (Skill Guide)

Based on the successful automation of **Cursor**, **Codex**, **Antigravity**, **ChatWise**, **Notion**, and **Discord** desktop apps, this guide serves as the standard operating procedure (SOP) for adapting ANY Electron-based application into an OpenCLI adapter.

## Core Concept

Electron apps are essentially local Chromium browser instances. By exposing a debugging port (CDP — Chrome DevTools Protocol) at launch time, we can use the Browser Bridge to pierce through the UI layer, accessing and controlling all underlying state including React/Vue components and Shadow DOM.

> **Note:** Not all desktop apps are Electron. WeChat (native Cocoa) and Feishu/Lark (custom Lark Framework) embed Chromium but do NOT expose CDP. For those apps, use the AppleScript + clipboard approach instead (see [Non-Electron Pattern](#non-electron-pattern-applescript)).

### Launching the Target App
```bash
/Applications/AppName.app/Contents/MacOS/AppName --remote-debugging-port=9222
```

### Verifying Electron
```bash
# Check for Electron Framework in the app bundle
ls /Applications/AppName.app/Contents/Frameworks/Electron\ Framework.framework
# If this directory exists → Electron → CDP works
# If not → check for libEGL.dylib (embedded Chromium/CEF, CDP may not work)
```

## The 5-Command Pattern (CDP / Electron)

Every new Electron adapter should implement these 5 commands in `src/clis/<app_name>/`:

### 1. `status.ts` — Connection Test
```typescript
export const statusCommand = cli({
  site: 'myapp',
  name: 'status',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,       // Requires CDP connection
  args: [],
  columns: ['Status', 'Url', 'Title'],
  func: async (page: IPage) => {
    const url = await page.evaluate('window.location.href');
    const title = await page.evaluate('document.title');
    return [{ Status: 'Connected', Url: url, Title: title }];
  },
});
```

### 2. `dump.ts` — Reverse Engineering Core
Modern app DOMs are huge and obfuscated. **Never guess selectors.** Dump first, then extract precise class names with AI or `grep`:
```typescript
const dom = await page.evaluate('document.body.innerHTML');
fs.writeFileSync('/tmp/app-dom.html', dom);
const snap = await page.snapshot({ interactive: false });
fs.writeFileSync('/tmp/app-snapshot.json', JSON.stringify(snap, null, 2));
```

### 3. `send.ts` — Advanced Text Injection
Electron apps often use complex rich-text editors (Monaco, Lexical, ProseMirror). Setting `.value` directly is ignored by React state.

**Best practice:** Use `document.execCommand('insertText')` to perfectly simulate real user input, fully piercing React state:
```javascript
const composer = document.querySelector('[contenteditable="true"]');
composer.focus();
document.execCommand('insertText', false, 'Hello');
```
Then submit with `await page.pressKey('Enter')`.

### 4. `read.ts` — Context Extraction
Don't extract the entire page text. Use `dump.ts` output to find the real "conversation container":
- Look for semantic selectors: `[role="log"]`, `[data-testid="conversation"]`, `[data-content-search-turn-key]`
- Format output as Markdown — readable by both humans and LLMs

### 5. `new.ts` — Keyboard Shortcuts
Many GUI actions respond to native shortcuts rather than button clicks:
```typescript
const isMac = process.platform === 'darwin';
await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
await page.wait(1); // Wait for re-render
```

## Environment Variable
```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
```

## Non-Electron Pattern (AppleScript)

For native macOS apps (WeChat, Feishu) that don't expose CDP:
```typescript
export const statusCommand = cli({
  site: 'myapp',
  strategy: Strategy.PUBLIC,
  browser: false,       // No browser needed
  func: async (page: IPage | null) => {
    const output = execSync("osascript -e 'application \"MyApp\" is running'", { encoding: 'utf-8' }).trim();
    return [{ Status: output === 'true' ? 'Running' : 'Stopped' }];
  },
});
```

Core techniques:
- **status**: `osascript -e 'application "AppName" is running'`
- **send**: `pbcopy` → activate window → `Cmd+V` → `Enter`
- **read**: `Cmd+A` → `Cmd+C` → `pbpaste`
- **search**: Activate → `Cmd+F`/`Cmd+K` → `keystroke "query"`

## Pitfalls & Gotchas

1. **Port conflicts (EADDRINUSE)**: Only one app per port. Use unique ports: Codex=9222, ChatGPT=9224, Cursor=9226, ChatWise=9228, Notion=9230, Discord=9232
2. **IPage abstraction**: OpenCLI wraps the browser page as `IPage` (`src/types.ts`). Use `page.pressKey()` and `page.evaluate()`, NOT direct DOM APIs
3. **Timing**: Always add `await page.wait(0.5)` to `1.0` after DOM mutations. Returning too early disconnects prematurely
4. **AppleScript requires Accessibility**: Terminal app must be granted permission in System Settings → Privacy & Security → Accessibility

## Port Assignment Table

| App | Port | Mode |
|-----|------|------|
| Codex | 9222 | CDP |
| ChatGPT | 9224 | CDP / AppleScript |
| Cursor | 9226 | CDP |
| ChatWise | 9228 | CDP |
| Notion | 9230 | CDP |
| Discord App | 9232 | CDP |
