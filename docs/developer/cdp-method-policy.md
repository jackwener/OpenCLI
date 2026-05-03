# CDP Method Policy

**Audience**: contributors and agents proposing new CDP-backed browser capabilities.
**Purpose**: prevent the system from accumulating unused CDP surface, while keeping a clear, falsifiable record of what is exposed, what is intentionally not, and exactly what would change our minds.

When someone files an issue like "we should add CDP `X.y`", read this doc first. If the request maps to an existing trigger, point at it and proceed. If it does not, the default answer is **no — wait for a concrete failing adapter**.

---

## Decision framework

Every CDP method we expose must answer **all three** of these:

1. **Real failure mode** — Is there at least one adapter (or a concrete blocking automation flow) that fails today because this method is missing? Speculative needs do not count.
2. **No existing primitive** — Can the same outcome be achieved with what we already expose (DOM, JS evaluate, existing CDP allowlist, network capture, intercept)? If yes, prefer the existing primitive.
3. **Maintenance value > cost** — Will this method be exercised by more than the one adapter that triggered it? One-off niche helpers belong in adapter code, not in core.

If any answer is "no" or "not yet", the method stays **intentionally not exposed** with a recorded re-evaluation trigger.

---

## Currently exposed surface

The single source of truth for what is reachable from adapters is the extension allowlist plus the daemon action table; everything below is keyed off them.

### Extension CDP allowlist (`extension/src/background.ts` `CDP_ALLOWLIST`)

| Domain | Method | Used by | Why exposed |
|---|---|---|---|
| Accessibility | `getFullAXTree` | `browser state`, `analyze` | Accessibility-tree snapshot; cheaper and more stable than DOM walking |
| DOM | `getDocument`, `querySelectorAll`, `getBoxModel`, `getContentQuads`, `scrollIntoViewIfNeeded` | Native click / type targeting | Resolve selectors → node IDs → coordinates for `Input.dispatch*` |
| DOMSnapshot | `captureSnapshot` | `state`, `analyze` | Whole-page snapshot for offline analysis |
| Input | `dispatchMouseEvent`, `dispatchKeyEvent`, `insertText` | `click`, `type`, `keys` (native paths) | DOM-synthetic events do not reach React/DraftJS app state; native input is the only correct path for editor surfaces |
| Page | `getLayoutMetrics`, `captureScreenshot`, `getFrameTree` | `screenshot`, `frames` | Full-page screenshot with correct device pixel ratio; iframe enumeration |
| Runtime | `enable` | CDP attach bootstrap | Required by `chrome.debugger` before other domains work |
| Emulation | `setDeviceMetricsOverride`, `clearDeviceMetricsOverride` | Full-page screenshot | Temporarily resize viewport to capture content below the fold |

### Daemon action table (`extension/src/background.ts` action dispatch)

Higher-level actions wrap one or more CDP calls behind a stable IPC boundary so adapter authors do not write CDP directly:

`exec`, `navigate`, `tabs`, `cookies`, `screenshot`, `close-window`, `cdp` (raw passthrough, allowlist-gated), `sessions`, `set-file-input`, `insert-text`, `bind`, `network-capture-start`, `network-capture-read`, `frames`.

### `IPage` user-facing methods (`src/types.ts`)

The `IPage` interface is what adapter code sees. Native input methods (`nativeClick`, `nativeType`, `nativeKeyPress`, `insertText`) are optional today because the direct-CDP path (`CDPPage`) does not implement them yet — see *Known parity gaps* below.

---

## Intentionally not exposed

Each entry has a **specific re-evaluation trigger**. If you can point at one, file a focused issue that names the trigger; otherwise the answer stays "no".

### Input domain

| Method | Why not exposed | Re-evaluation trigger |
|---|---|---|
| `Input.dispatchTouchEvent` | We have no mobile-emulation adapters; viewport touch is unrelated to our data-extraction flows | First adapter that needs to drive a touch-only interaction (mobile-only site that ignores click events) |
| `Input.dispatchDragEvent` | Drag is a write-side interaction (reorder, drag-drop file). All current adapters are read-side | First adapter where the only path to the target data requires drag (e.g. unlocking a paginated grid via drag-to-load) |
| `Input.imeSetComposition` | CJK text already routes through `Input.insertText` correctly; IME composition is only needed for IME-aware editors that reject paste | Concrete CJK editor where `insertText` is dropped (provide failing case) |

### DOM domain

| Method | Why not exposed | Re-evaluation trigger |
|---|---|---|
| `DOM.focus` | `el.focus()` via `evaluate` plus `Input.dispatchMouseEvent` already cover focus paths | A native-input flow where a measured focus race causes flaky text insertion (provide repro) |
| `DOM.setAttributeValue` | Bypasses React/Vue controlled-input invariants; produces the *same* "DOM looks right but app state is wrong" failure that this allowlist exists to prevent | Never — this method is an anti-pattern in our context |

### Page domain

| Method | Why not exposed | Re-evaluation trigger |
|---|---|---|
| `Page.handleJavaScriptDialog` + `Page.javascriptDialogOpening` | No adapter has reported a hard hang on `alert`/`confirm`/`prompt` yet, but it is on deck as task B for a focused implementation. If you hit a dialog hang before that lands, post a repro | First adapter that hangs on a dialog, **or** task B (planned) |
| `Page.printToPDF` | No archival/print pipeline in scope; static screenshots cover documentation needs | A specific document-extraction adapter that requires layout-faithful PDF |
| `Page.setDownloadBehavior` (Browser domain in current CDP) | We do not currently support file-download adapters end-to-end | First adapter that needs to capture an actual file download, not just the URL |

### Network / Fetch / Storage

| Method | Why not exposed | Re-evaluation trigger |
|---|---|---|
| `Fetch.enable` / `Fetch.requestPaused` / `Fetch.fulfillRequest` | We already capture requests via the XHR/fetch interceptor in `installInterceptor` and via `Network` events; we do **not** rewrite responses | An adapter that can only be verified by mutating a request or response (e.g. forcing a debug header to expose a hidden field). Authoring a fixture is preferred first |
| `Storage.setCookies` / `Storage.clearDataForOrigin` | Cookie write is high-blast-radius; current cookie reads cover what adapters need | Concrete adapter where login state must be programmatically set/cleared |

### Emulation

| Method | Why not exposed | Re-evaluation trigger |
|---|---|---|
| `Emulation.setUserAgentOverride` | Anti-bot strategy is `cookie + interceptor + headers`, not UA spoofing. Adding UA override invites a brittle dependency on UA strings | Concrete site where every other auth strategy fails and UA is provably the gate |
| `Emulation.setGeolocationOverride` | Geo-gated content is not a current target | First geo-gated adapter |
| `Emulation.setTouchEmulationEnabled` | Pairs with `dispatchTouchEvent`; same trigger | (See touch event row) |

---

## Known parity gaps

These are gaps inside the **already-decided** policy, not new surface decisions. They should be closed without further design discussion.

- **`CDPPage` (direct-CDP path) lacks `insertText` / `nativeType` / `nativeKeyPress` / `nativeClick` / `setFileInput` / `cdp` / `frames` / `evaluateInFrame` / `closeWindow` / `newTab` / `closeTab`.** The Browser-Bridge `Page` class implements these. Behaviour divergence between the two transports is a footgun: the same adapter may pass tests on one path and silently misbehave on the other. Closing this gap is in scope whenever native-input work touches `Page`.

---

## Process for proposing a new CDP method

1. Open an issue that includes:
   - The exact CDP method (`Domain.method`).
   - The concrete adapter or flow that fails today, with a repro snippet.
   - Why no existing primitive (DOM, evaluate, current allowlist) solves it. Show the failed attempt.
2. Check this doc. If the method is in *Intentionally not exposed* and your case **is** the listed re-evaluation trigger, say so and link the entry.
3. The maintainer who lands the change updates this doc in the same PR — either move the row out of *Intentionally not exposed* into the exposure table, or refine the re-evaluation trigger to be more precise.

If the method is not listed at all in this doc, it is not "approved" — it is just unexamined. Run the three-question framework on it before proposing.

---

## Anti-patterns to avoid

- **"Add it because CDP supports it."** CDP supports hundreds of methods. The cost of an exposed method is the maintenance, attack surface, documentation, and migration cost of every method that uses it. Keep the surface as small as possible.
- **Adding a method speculatively for "future adapters".** Future adapters do not exist; only current adapters do. When the future adapter shows up, add the method then with the concrete failure case in the PR.
- **Adding a flag instead of fixing the default path.** If `browser type` cannot drive React editors today, fix the default — do not add `--use-cdp-input` and call it done.
- **Working around React/Vue controlled-input invariants by mutating the DOM.** Use the framework-aware native-setter or `Input.insertText` path; do not use `DOM.setAttributeValue`/`setProperty` on managed nodes.

---

## Appendix: where the allowlist actually lives

- Extension allowlist (security boundary): `extension/src/background.ts` — `CDP_ALLOWLIST` constant.
- Daemon action handlers: `extension/src/background.ts` action dispatch + `src/browser/daemon-client.ts`.
- IPage shape: `src/types.ts`.
- Browser-Bridge implementation: `src/browser/page.ts`.
- Direct-CDP implementation: `src/browser/cdp.ts`.

Any change to the exposure table must update both the allowlist and this doc in the same commit.
