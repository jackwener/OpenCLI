# Browser visual fallback

2026-09-24 design.

## Evidence and need

Codex's bundled Browser client cannot import here (`node:process` is forbidden by its Node REPL). Computer Use imports `@oai/sky` but cannot list apps because `NODE_REPL_TRUSTED_SERVICES` is unavailable. OpenCLI connects to signed-in Chrome, while a cross-origin Chatkit iframe may expose no actionable DOM or AX ref. Its existing `IPage.nativeClick` and `nativeType` can act through CDP. The operator needs these actions through the documented CLI with a traceable screenshot and tab.

## Action contract

- `browser screenshot <path> --for-click --tab <targetId>` captures the unmodified viewport PNG. It rejects full-page, resized, and annotated modes. Its JSON output includes image and CSS viewport dimensions plus a short-lived capture descriptor bound to the exact tab target ID, a hash of its URL, and a hash of the captured PNG. No raw URL is stored in the descriptor. The descriptor's image dimensions allow Retina PNG pixels to map to CSS viewport coordinates.
- `browser click --point <image-x,image-y> --capture <descriptor> --tab <targetId>` accepts only image-pixel coordinates from that screenshot. It rejects element/semantic targets, bad or expired descriptors, tab or URL changes, viewport changes, and points outside the image. It maps image pixels to CSS pixels, moves the pointer to that point, then captures the same viewport again and requires identical PNG bytes, including dimensions. Any redraw, scroll, or hover change requires a new screenshot and point. Only after that comparison does it send mousePressed and mouseReleased at the point, without another mouseMoved. It returns `dispatched_unverified`; the page outcome requires read-back.
- `browser type --focused <text> --tab <targetId>` accepts no element/semantic target. Before insertion it probes the current focus: input, textarea, contenteditable, or an iframe is eligible; anything else fails. Cross-origin iframe focus cannot prove the inner field, so the output names `iframe` and says the inserted value is unverified. The operator reads it back before any submit.
- A CDP command that carries an explicit target ID must fail if that tab is gone, non-debuggable, or outside its session. The extension must not silently choose a replacement tab for it. Other implicit-tab behavior is unchanged.
- Once a visual click or text insertion begins, any transport failure is reported as `outcome_unknown` with a reconcile-before-repeat hint. Do not launch a new action automatically. The existing same-command-ID transport reconciliation may continue.
- Normal element refs and semantic locators retain their behavior.

## Browser routing

A Codex Browser or Computer Use setup failure may trigger one switch to OpenCLI on the same connected Chrome browser. An explicitly requested in-app browser stays in-app. The switch grants no new action authority: reads remain reads, an outbound message still uses its exact approved draft and destination, and a purchase still needs its approved amount and account. Before a visual action inspect the exact tab URL and fresh screenshot. After any external action, inspect the same conversation/order/account for its result. If it cannot be reconciled, stop without repeating it.

## 2026-09-24 Edge/iCloud correction

A real Edge profile failed after iCloud Passwords injected its own `chrome-extension://` iframe: `chrome.debugger.attach` returned `Cannot access a chrome-extension:// URL of different extension`. A different Chrome profile cannot validate this case. An attach retry or targetId attach does not solve this Chromium boundary. Do not remove or disable the iCloud frame.

For that exact attach error, visual capture uses `chrome.tabs.captureVisibleTab` on the exact active tab in its existing window, with viewport dimensions from `chrome.scripting`. Point actions use scripts in exact web frame IDs from `chrome.webNavigation`. A visible iframe must match exactly one child by parent frame ID and URL; redirects or duplicate URLs fail closed. Protected extension frames are skipped. No point-action message is exposed to page scripts. Focused typing uses the uniquely focused web frame. This input is synthetic and marked as such in CLI output. Sites that require trusted input can reject it, so read-back is mandatory, and no claim of full support is made from unit tests. `chrome.tabs.update({active:true})` and OS focus are never used to obtain a screenshot.

The primary CDP path remains for tabs without the protected iframe. If an action switches transport after a screenshot, the caller must capture again. The current acceptance gate is an actual Edge local cross-origin fixture with iCloud Passwords enabled: screenshot, point click, focused Unicode input, and UI read-back, without moving browser focus. A new extension build requires an explicit reload in Edge before this gate can run.

## Acceptance

Unit tests cover the descriptor's pixel-to-CSS mapping at non-1 device scale, target/URL/viewport drift, a same-size redraw or scroll between capture and click, a hover menu changed by pointer movement, expired or malformed input, unsupported native actions, focus rejection, ambiguous dispatch, and the old element path. Extension tests prove an explicit target cannot re-resolve to another owned tab. The actual Edge `main` profile with iCloud Passwords enabled must exercise screenshot, cross-origin iframe point click, Unicode input, and UI read-back. A profile without iCloud is not acceptance evidence. No live purchase or support-send test is needed.
