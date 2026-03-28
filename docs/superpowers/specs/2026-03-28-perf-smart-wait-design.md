# Performance: Smart Wait & INTERCEPT Fix

**Date**: 2026-03-28
**Status**: Approved

## Problem

Three distinct performance/correctness issues:

1. **INTERCEPT strategy semantic bug**: After `installInterceptor()` + `goto()`, adapters call `wait(N)` — which now uses `waitForDomStableJs` and returns early when the DOM settles. But DOM-settle != network capture. The API response may arrive *after* DOM is stable, causing `getInterceptedRequests()` to return an empty array.

2. **Blind `wait(N)` in adapters**: ~30 high-traffic adapters (Twitter family, Medium, Substack, etc.) call `wait(5)` waiting for React/Vue to hydrate. These should wait for a specific DOM element to appear, not a fixed cap.

3. **Daemon cold-start polling**: Fixed 300ms poll loop means ~600ms before first successful `isExtensionConnected()` check, even though the daemon is typically ready in 500–800ms.

## Design

### Layer 1 — `waitForCapture()` (correctness fix + perf)

Add `waitForCapture(timeout?: number): Promise<void>` to `IPage`.

Polls `window.__opencli_xhr.length > 0` every 100ms inside the browser tab. Resolves as soon as ≥1 capture arrives; rejects after `timeout` seconds.

```typescript
// dom-helpers.ts
export function waitForCaptureJs(maxMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${maxMs};
      const check = () => {
        if ((window.__opencli_xhr || []).length > 0) return resolve('captured');
        if (Date.now() > deadline) return reject(new Error('No capture within ${maxMs / 1000}s'));
        setTimeout(check, 100);
      };
      check();
    })
  `;
}
```

`page.ts` and `cdp.ts` implement `waitForCapture()` by calling `waitForCaptureJs`.

**All INTERCEPT adapters** replace `wait(N)` → `waitForCapture(N+2)` (slightly longer timeout as safety margin).

`stepIntercept` in `pipeline/steps/intercept.ts` replaces its internal `wait(timeout)` with `waitForCapture(timeout)`.

**Expected gain**: 36kr hot/search: 6s → ~1–2s. Twitter search/followers: 5–8s → ~1–3s.

### Layer 2 — `wait({ selector })` (semantic precision)

Extend `WaitOptions` with `selector?: string`.

Add `waitForSelectorJs(selector, timeoutMs)` to `dom-helpers.ts` — polls `document.querySelector(selector)` every 100ms, resolves on first match, rejects on timeout.

```typescript
// types.ts
export interface WaitOptions {
  text?: string;
  selector?: string;   // NEW
  time?: number;
  timeout?: number;
}
```

```typescript
// dom-helpers.ts
export function waitForSelectorJs(selector: string, timeoutMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${timeoutMs};
      const check = () => {
        if (document.querySelector(${JSON.stringify(selector)})) return resolve('found');
        if (Date.now() > deadline) return reject(new Error('Selector not found: ' + ${JSON.stringify(selector)}));
        setTimeout(check, 100);
      };
      check();
    })
  `;
}
```

`page.ts` and `cdp.ts` handle `selector` branch in `wait()`.

**High-impact adapter changes**:

| Adapter | Old | New |
|---------|-----|-----|
| `twitter/*` (15 adapters) | `wait(5)` | `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `twitter/reply.ts` | `wait(5)` | `wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 8 })` |
| `medium/utils.ts` | `wait(5)` + inline 3s setTimeout | `wait({ selector: 'article', timeout: 8 })` + remove inline sleep |
| `substack/utils.ts` | `wait(5)` × 2 | `wait({ selector: 'article', timeout: 8 })` |
| `bloomberg/news.ts` | `wait(5)` | `wait({ selector: 'article', timeout: 6 })` |
| `sinablog/utils.ts` | `wait(5)` | `wait({ selector: 'article, .article', timeout: 6 })` |
| `producthunt` (already covered by layer 1) | — | — |

**Expected gain**: Twitter commands: 5s → ~0.5–2s. Medium: 8s → ~1–3s.

### Layer 3 — Daemon exponential backoff (cold-start)

Replace fixed 300ms poll in `_ensureDaemon()` (`browser/mcp.ts`) with exponential backoff:

```typescript
// before
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 300));
  if (await isExtensionConnected()) return;
}

// after
const backoffs = [50, 100, 200, 400, 800, 1500, 3000];
let i = 0;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, backoffs[Math.min(i++, backoffs.length - 1)]));
  if (await isExtensionConnected()) return;
}
```

**Expected gain**: First cold-start check succeeds at ~150ms instead of ~600ms.

## Files Changed

### New / Modified (framework)
- `src/types.ts` — `WaitOptions.selector`, `IPage.waitForCapture()`
- `src/browser/dom-helpers.ts` — `waitForCaptureJs()`, `waitForSelectorJs()`
- `src/browser/page.ts` — `waitForCapture()`, `wait()` selector branch
- `src/browser/cdp.ts` — `waitForCapture()`, `wait()` selector branch
- `src/browser/mcp.ts` — exponential backoff in `_ensureDaemon()`
- `src/pipeline/steps/intercept.ts` — use `waitForCapture()`

### Modified (adapters — Layer 1, INTERCEPT)
- `src/clis/36kr/hot.ts`
- `src/clis/36kr/search.ts`
- `src/clis/twitter/search.ts`
- `src/clis/twitter/followers.ts`
- `src/clis/twitter/following.ts`
- `src/clis/producthunt/hot.ts`
- `src/clis/producthunt/browse.ts`

### Modified (adapters — Layer 2, selector)
- `src/clis/twitter/reply.ts`
- `src/clis/twitter/follow.ts`
- `src/clis/twitter/unfollow.ts`
- `src/clis/twitter/like.ts`
- `src/clis/twitter/bookmark.ts`
- `src/clis/twitter/unbookmark.ts`
- `src/clis/twitter/block.ts`
- `src/clis/twitter/unblock.ts`
- `src/clis/twitter/hide-reply.ts`
- `src/clis/twitter/notifications.ts`
- `src/clis/twitter/profile.ts`
- `src/clis/twitter/thread.ts`
- `src/clis/twitter/timeline.ts`
- `src/clis/twitter/delete.ts`
- `src/clis/twitter/reply-dm.ts`
- `src/clis/medium/utils.ts`
- `src/clis/substack/utils.ts`
- `src/clis/bloomberg/news.ts`
- `src/clis/sinablog/utils.ts`

## Delivery Order

1. Layer 1 (`waitForCapture`) — correctness fix, highest ROI
2. Layer 3 (backoff) — 3-line change, zero risk
3. Layer 2 (`wait({ selector })`) — largest adapter surface, can be done per-site

## Testing

- Unit tests: `waitForCaptureJs`, `waitForSelectorJs` exported and tested in `dom-helpers.test.ts` (if exists) or new test file
- Adapter tests: existing tests must continue to pass (mock `page.wait` / `page.waitForCapture`)
- Run: `npx vitest run --project unit --project adapter`
