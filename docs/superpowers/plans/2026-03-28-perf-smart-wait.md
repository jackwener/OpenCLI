# Performance: Smart Wait & INTERCEPT Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the INTERCEPT strategy correctness bug, add `wait({ selector })` for event-driven waits, and speed up daemon cold-start — eliminating up to 8s of unnecessary fixed sleeps per command.

**Architecture:** Three independent layers applied in order: (1) add `waitForCaptureJs` + `waitForSelectorJs` to `dom-helpers.ts` and expose via `IPage`, (2) update `page.ts`/`cdp.ts` implementations, (3) update adapters from the inside out — framework first, then adapters.

**Tech Stack:** TypeScript, Vitest (unit + adapter projects), Node.js, browser JS (eval'd strings)

---

## File Map

| File | Change |
|------|--------|
| `src/browser/dom-helpers.ts` | Add `waitForCaptureJs()`, `waitForSelectorJs()` |
| `src/browser/dom-helpers.test.ts` | **New** — unit tests for new helpers |
| `src/types.ts` | Add `selector?` to `WaitOptions`; add `waitForCapture()` to `IPage` |
| `src/browser/page.ts` | Implement `waitForCapture()`, add `selector` branch to `wait()` |
| `src/browser/cdp.ts` | Implement `waitForCapture()`, add `selector` branch to `wait()` |
| `src/pipeline/steps/intercept.ts` | Use `page.installInterceptor()` + `page.waitForCapture()` + `page.getInterceptedRequests()` |
| `src/browser/mcp.ts` | Exponential backoff in `_ensureDaemon()` |
| `src/clis/36kr/hot.ts` | `wait(6)` → `waitForCapture(10)` |
| `src/clis/36kr/search.ts` | `wait(6)` → `waitForCapture(10)` |
| `src/clis/twitter/search.ts` | `wait(5)` → `waitForCapture(8)` (already INTERCEPT) |
| `src/clis/twitter/followers.ts` | `wait(5)` → `waitForCapture(8)` (already INTERCEPT) |
| `src/clis/twitter/following.ts` | `wait(5)` → `waitForCapture(8)` (already INTERCEPT) |
| `src/clis/twitter/notifications.ts` | `wait(3)` → selector + `wait(5)` → `waitForCapture(8)` |
| `src/clis/producthunt/hot.ts` | `wait(5)` → `waitForCapture(8)` |
| `src/clis/producthunt/browse.ts` | `wait(5)` → `waitForCapture(8)` |
| `src/clis/twitter/reply.ts` | `wait(5)` → `wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 8 })` |
| `src/clis/twitter/follow.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/unfollow.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/like.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/bookmark.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/unbookmark.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/block.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/unblock.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/hide-reply.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/profile.ts` | `wait(5)` + `wait(3)` → selector variants |
| `src/clis/twitter/thread.ts` | `wait(3)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 })` |
| `src/clis/twitter/timeline.ts` | `wait(3)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 })` |
| `src/clis/twitter/delete.ts` | `wait(5)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })` |
| `src/clis/twitter/reply-dm.ts` | `wait(5)` + `wait(3)` → selector variants |
| `src/clis/medium/utils.ts` | `wait(5)` → selector; remove inline `setTimeout(3000)` |
| `src/clis/substack/utils.ts` | `wait(5)` × 2 → selector; remove inline `setTimeout(3000)` × 2 |
| `src/clis/bloomberg/news.ts` | `wait(5)` → `wait({ selector: '#__NEXT_DATA__', timeout: 8 })`; `wait(4)` → `wait({ selector: '#__NEXT_DATA__', timeout: 5 })` |
| `src/clis/sinablog/utils.ts` | `wait(3/5)` → selector; remove inline polling loop |

---

## Task 1: Add `waitForCaptureJs` and `waitForSelectorJs` to dom-helpers.ts

**Files:**
- Modify: `src/browser/dom-helpers.ts`
- Create: `src/browser/dom-helpers.test.ts`

- [ ] **Step 1: Add two new exported functions at the end of `src/browser/dom-helpers.ts`**

```typescript
/**
 * Generate JS to wait until window.__opencli_xhr has ≥1 captured response.
 * Polls every 100ms. Resolves 'captured' on success; rejects after maxMs.
 * Used after installInterceptor() + goto() instead of a fixed sleep.
 */
export function waitForCaptureJs(maxMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${maxMs};
      const check = () => {
        if ((window.__opencli_xhr || []).length > 0) return resolve('captured');
        if (Date.now() > deadline) return reject(new Error('No network capture within ${maxMs / 1000}s'));
        setTimeout(check, 100);
      };
      check();
    })
  `;
}

/**
 * Generate JS to wait until document.querySelector(selector) returns a match.
 * Polls every 100ms. Resolves 'found' on success; rejects after timeoutMs.
 */
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

- [ ] **Step 2: Create `src/browser/dom-helpers.test.ts` with failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { waitForCaptureJs, waitForSelectorJs } from './dom-helpers.js';

describe('waitForCaptureJs', () => {
  it('returns a non-empty string', () => {
    const code = waitForCaptureJs(1000);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
    expect(code).toContain('__opencli_xhr');
    expect(code).toContain('resolve');
    expect(code).toContain('reject');
  });

  it('resolves "captured" when __opencli_xhr is populated before deadline', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [];
    const code = waitForCaptureJs(1000);
    const promise = eval(code) as Promise<string>;
    g.__opencli_xhr.push({ data: 'test' });
    await expect(promise).resolves.toBe('captured');
    delete g.__opencli_xhr;
  });

  it('rejects when __opencli_xhr stays empty past deadline', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [];
    const code = waitForCaptureJs(50); // 50ms timeout
    const promise = eval(code) as Promise<string>;
    await expect(promise).rejects.toThrow('No network capture within 0.05s');
    delete g.__opencli_xhr;
  });

  it('resolves immediately when __opencli_xhr already has data', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [{ data: 'already here' }];
    const code = waitForCaptureJs(1000);
    await expect(eval(code) as Promise<string>).resolves.toBe('captured');
    delete g.__opencli_xhr;
  });
});

describe('waitForSelectorJs', () => {
  it('returns a non-empty string', () => {
    const code = waitForSelectorJs('#app', 1000);
    expect(typeof code).toBe('string');
    expect(code).toContain('#app');
    expect(code).toContain('querySelector');
  });

  it('rejects when document.querySelector returns null within timeout', async () => {
    const g = globalThis as any;
    g.document = { querySelector: (_: string) => null };
    const code = waitForSelectorJs('#missing', 50);
    await expect(eval(code) as Promise<string>).rejects.toThrow('Selector not found: #missing');
    delete g.document;
  });

  it('resolves "found" when document.querySelector returns an element', async () => {
    const g = globalThis as any;
    const fakeEl = { tagName: 'DIV' };
    g.document = { querySelector: (_: string) => fakeEl };
    const code = waitForSelectorJs('[data-testid="primaryColumn"]', 1000);
    await expect(eval(code) as Promise<string>).resolves.toBe('found');
    delete g.document;
  });
});
```

- [ ] **Step 3: Run tests to verify they fail (functions not yet exported)**

```bash
cd /Users/jakevin/code/opencli
npx vitest run --project unit src/browser/dom-helpers.test.ts
```
Expected: Tests for `waitForCaptureJs` pass (function exists), tests for `waitForSelectorJs` fail (not yet added).

- [ ] **Step 4: Run tests again after Step 1 to verify all pass**

```bash
npx vitest run --project unit src/browser/dom-helpers.test.ts
```
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/browser/dom-helpers.ts src/browser/dom-helpers.test.ts
git commit -m "feat(perf): add waitForCaptureJs and waitForSelectorJs to dom-helpers"
```

---

## Task 2: Extend `IPage` interface and `WaitOptions` in `types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `selector` to `WaitOptions` and `waitForCapture` to `IPage`**

In `src/types.ts`, find `WaitOptions` and add `selector?`:

```typescript
export interface WaitOptions {
  text?: string;
  selector?: string;   // wait until document.querySelector(selector) matches
  time?: number;
  timeout?: number;
}
```

In the same file, find `IPage` and add `waitForCapture` after `getInterceptedRequests`:

```typescript
  installInterceptor(pattern: string): Promise<void>;
  getInterceptedRequests(): Promise<any[]>;
  waitForCapture(timeout?: number): Promise<void>;
```

- [ ] **Step 2: Run unit tests to confirm no type errors**

```bash
npx vitest run --project unit
```
Expected: All existing unit tests PASS (no adapter tests broken since IPage is extended, not changed).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(perf): extend WaitOptions with selector, add waitForCapture to IPage"
```

---

## Task 3: Implement `waitForCapture()` and `wait({ selector })` in `page.ts`

**Files:**
- Modify: `src/browser/page.ts`

- [ ] **Step 1: Add `waitForCaptureJs` and `waitForSelectorJs` to the imports at the top of `page.ts`**

Find the existing import from `./dom-helpers.js`:

```typescript
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
```

Replace with:

```typescript
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  waitForCaptureJs,
  waitForSelectorJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
```

- [ ] **Step 2: Add `selector` branch to the existing `wait()` method in `page.ts`**

Find the current `wait()` implementation and add the `selector` branch before the `text` branch:

```typescript
  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      if (options >= 1) {
        try {
          const maxMs = options * 1000;
          await sendCommand('exec', {
            code: waitForDomStableJs(maxMs, Math.min(500, maxMs)),
            ...this._cmdOpts(),
          });
          return;
        } catch {
          // Fallback: fixed sleep (e.g. if page has no DOM yet)
        }
      }
      await new Promise(resolve => setTimeout(resolve, options * 1000));
      return;
    }
    if (typeof options.time === 'number') {
      await new Promise(resolve => setTimeout(resolve, options.time! * 1000));
      return;
    }
    if (options.selector) {
      const timeout = (options.timeout ?? 10) * 1000;
      const code = waitForSelectorJs(options.selector, timeout);
      await sendCommand('exec', { code, ...this._cmdOpts() });
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      const code = waitForTextJs(options.text, timeout);
      await sendCommand('exec', { code, ...this._cmdOpts() });
    }
  }
```

- [ ] **Step 3: Add `waitForCapture()` method to `page.ts`, just after `getInterceptedRequests()`**

Find `getInterceptedRequests()` at the end of the `Page` class and add after it:

```typescript
  async waitForCapture(timeout: number = 10): Promise<void> {
    const maxMs = timeout * 1000;
    await sendCommand('exec', {
      code: waitForCaptureJs(maxMs),
      ...this._cmdOpts(),
    });
  }
```

- [ ] **Step 4: Run unit tests**

```bash
npx vitest run --project unit
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/browser/page.ts
git commit -m "feat(perf): implement waitForCapture() and wait({ selector }) in Page"
```

---

## Task 4: Implement `waitForCapture()` and `wait({ selector })` in `cdp.ts`

**Files:**
- Modify: `src/browser/cdp.ts`

- [ ] **Step 1: Add `waitForCaptureJs` and `waitForSelectorJs` to the imports in `cdp.ts`**

Find the existing import from `./dom-helpers.js` in `cdp.ts`:

```typescript
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
} from './dom-helpers.js';
```

Replace with:

```typescript
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  waitForCaptureJs,
  waitForSelectorJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
} from './dom-helpers.js';
```

- [ ] **Step 2: Add `selector` branch to `wait()` in `cdp.ts`**

Find the current `wait()` in `cdp.ts` and replace it entirely:

```typescript
  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      await new Promise((resolve) => setTimeout(resolve, options * 1000));
      return;
    }
    if (typeof options.time === 'number') {
      const waitTime = options.time;
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      return;
    }
    if (options.selector) {
      const timeout = (options.timeout ?? 10) * 1000;
      await this.evaluate(waitForSelectorJs(options.selector, timeout));
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      await this.evaluate(waitForTextJs(options.text, timeout));
    }
  }
```

- [ ] **Step 3: Add `waitForCapture()` to `cdp.ts`, just after `getInterceptedRequests()`**

Find `getInterceptedRequests()` at the end of the `CDPPage` class and add after it:

```typescript
  async waitForCapture(timeout: number = 10): Promise<void> {
    const maxMs = timeout * 1000;
    await this.evaluate(waitForCaptureJs(maxMs));
  }
```

- [ ] **Step 4: Run unit tests**

```bash
npx vitest run --project unit
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/browser/cdp.ts
git commit -m "feat(perf): implement waitForCapture() and wait({ selector }) in CDPPage"
```

---

## Task 5: Update `stepIntercept` to use unified IPage methods

**Files:**
- Modify: `src/pipeline/steps/intercept.ts`

The current `stepIntercept` uses `generateInterceptorJs`/`generateReadInterceptedJs` directly, writing to `__opencli_intercepted`. We unify this to use `page.installInterceptor()` (→ `__opencli_xhr`) + `page.waitForCapture()` + `page.getInterceptedRequests()`.

- [ ] **Step 1: Rewrite `src/pipeline/steps/intercept.ts`**

```typescript
/**
 * Pipeline step: intercept — declarative XHR interception.
 */

import type { IPage } from '../../src/types.js';
import { render, normalizeEvaluateSource } from '../template.js';

export async function stepIntercept(page: IPage | null, params: any, data: any, args: Record<string, any>): Promise<any> {
  const cfg = typeof params === 'object' ? params : {};
  const trigger = cfg.trigger ?? '';
  const capturePattern = cfg.capture ?? '';
  const timeout = cfg.timeout ?? 8;
  const selectPath = cfg.select ?? null;

  if (!capturePattern) return data;

  // Step 1: Install fetch/XHR interceptor BEFORE trigger
  await page!.installInterceptor(capturePattern);

  // Step 2: Execute the trigger action
  if (trigger.startsWith('navigate:')) {
    const url = render(trigger.slice('navigate:'.length), { args, data });
    await page!.goto(String(url));
  } else if (trigger.startsWith('evaluate:')) {
    const js = trigger.slice('evaluate:'.length);
    await page!.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
  } else if (trigger.startsWith('click:')) {
    const ref = render(trigger.slice('click:'.length), { args, data });
    await page!.click(String(ref).replace(/^@/, ''));
  } else if (trigger === 'scroll') {
    await page!.scroll('down');
  }

  // Step 3: Wait for network capture instead of fixed sleep
  await page!.waitForCapture(timeout);

  // Step 4: Retrieve captured data
  const matchingResponses = await page!.getInterceptedRequests();

  // Step 5: Select from response if specified
  let result = matchingResponses.length === 1 ? matchingResponses[0] :
               matchingResponses.length > 1 ? matchingResponses : data;

  if (selectPath && result) {
    let current = result;
    for (const part of String(selectPath).split('.')) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = current[part];
      } else break;
    }
    result = current ?? result;
  }

  return result;
}
```

- [ ] **Step 2: Run unit + adapter tests**

```bash
npx vitest run --project unit --project adapter
```
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/steps/intercept.ts
git commit -m "perf(intercept): use installInterceptor+waitForCapture in stepIntercept pipeline step"
```

---

## Task 6: Fix INTERCEPT adapters (Layer 1)

**Files:** `36kr/hot.ts`, `36kr/search.ts`, `twitter/search.ts`, `twitter/followers.ts`, `twitter/following.ts`, `twitter/notifications.ts`, `producthunt/hot.ts`, `producthunt/browse.ts`

- [ ] **Step 1: Fix `src/clis/36kr/hot.ts`**

Find:
```typescript
    await page.installInterceptor('36kr.com/api');
    await page.goto(url);
    await page.wait(6);
```
Replace with:
```typescript
    await page.installInterceptor('36kr.com/api');
    await page.goto(url);
    await page.waitForCapture(10);
```

- [ ] **Step 2: Fix `src/clis/36kr/search.ts`**

Find:
```typescript
    await page.installInterceptor('36kr.com/api');
    await page.goto(`https://www.36kr.com/search/articles/${query}`);
    await page.wait(6);
```
Replace with:
```typescript
    await page.installInterceptor('36kr.com/api');
    await page.goto(`https://www.36kr.com/search/articles/${query}`);
    await page.waitForCapture(10);
```

- [ ] **Step 3: Fix `src/clis/twitter/search.ts`**

Find the two lines that contain `await page.wait(5)` in the `navigateToSearch` helper:
```typescript
    await page.wait(5);
```
(there are two of them: one after `pushState`, one in the retry). Replace both with:
```typescript
    await page.waitForCapture(8);
```

- [ ] **Step 4: Fix `src/clis/twitter/followers.ts`**

Find:
```typescript
    await page.wait(5);

    // 4. Scroll to trigger pagination API calls
```
Replace with:
```typescript
    await page.waitForCapture(8);

    // 4. Scroll to trigger pagination API calls
```

Also find the earlier `wait(5)` after going to profile and `wait(3)` after going to home — those are UI waits (not INTERCEPT), replace with selector:
```typescript
    // After page.goto('https://x.com/home'):
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 5 });
    // After page.goto(`https://x.com/${targetUser}`):
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 });
```

- [ ] **Step 5: Fix `src/clis/twitter/following.ts`**

Same pattern as `followers.ts`. Find and apply identically:
- `wait(5)` after `goto('https://x.com/home')` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 5 })`
- `wait(3)` after `goto(\`https://x.com/${targetUser}\`)` → `wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 })`
- `wait(5)` after SPA click that triggers INTERCEPT → `waitForCapture(8)`

- [ ] **Step 6: Fix `src/clis/twitter/notifications.ts`**

Find:
```typescript
    await page.goto('https://x.com/home');
    await page.wait(3);
```
Replace with:
```typescript
    await page.goto('https://x.com/home');
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 5 });
```

Find:
```typescript
    await page.wait(5);

    // Verify SPA navigation succeeded
```
Replace with:
```typescript
    await page.waitForCapture(8);

    // Verify SPA navigation succeeded
```

- [ ] **Step 7: Fix `src/clis/producthunt/hot.ts`**

Find:
```typescript
    await page.installInterceptor(
```
Look at the full pattern and replace the subsequent `wait(5)` with `waitForCapture(8)`.

- [ ] **Step 8: Fix `src/clis/producthunt/browse.ts`**

Same as `hot.ts` — replace `wait(5)` after `installInterceptor` + `goto` with `waitForCapture(8)`.

- [ ] **Step 9: Run adapter tests**

```bash
npx vitest run --project adapter
```
Expected: All PASS (adapter tests mock `page.wait` and `page.waitForCapture`; existing mocks will need `waitForCapture: vi.fn()` if not already present).

If any adapter test file lacks `waitForCapture` mock, add `waitForCapture: vi.fn().mockResolvedValue(undefined)` to its mock page object.

- [ ] **Step 10: Commit**

```bash
git add src/clis/36kr/hot.ts src/clis/36kr/search.ts \
        src/clis/twitter/search.ts src/clis/twitter/followers.ts \
        src/clis/twitter/following.ts src/clis/twitter/notifications.ts \
        src/clis/producthunt/hot.ts src/clis/producthunt/browse.ts
git commit -m "perf(intercept): replace wait(N) with waitForCapture() in all INTERCEPT adapters"
```

---

## Task 7: Daemon exponential backoff (Layer 3)

**Files:**
- Modify: `src/browser/mcp.ts`

- [ ] **Step 1: Replace fixed 300ms poll loop in `_ensureDaemon()`**

In `src/browser/mcp.ts`, find:

```typescript
    // Wait for daemon to be ready AND extension to connect
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
      if (await isExtensionConnected()) return;
    }
```

Replace with:

```typescript
    // Wait for daemon to be ready AND extension to connect.
    // Exponential backoff: daemon typically ready in 500–800ms,
    // so first check at 50ms then 100ms gets a fast result without hammering.
    const deadline = Date.now() + timeoutMs;
    const backoffs = [50, 100, 200, 400, 800, 1500, 3000];
    let backoffIdx = 0;
    while (Date.now() < deadline) {
      const delay = backoffs[Math.min(backoffIdx++, backoffs.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));
      if (await isExtensionConnected()) return;
    }
```

- [ ] **Step 2: Run unit tests**

```bash
npx vitest run --project unit
```
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/browser/mcp.ts
git commit -m "perf(daemon): exponential backoff for cold-start extension polling"
```

---

## Task 8: Fix Twitter UI adapters with `wait({ selector })` (Layer 2, part 1)

**Files:** 13 adapters in `src/clis/twitter/`

For all adapters below, the pattern is identical: `await page.goto(url)` followed by `await page.wait(5)` waiting for React to hydrate. Replace `wait(5)` with `wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 })`.

- [ ] **Step 1: Fix `src/clis/twitter/reply.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5); // Wait for the react application to hydrate
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 8 });
```
(reply.ts uses the reply textarea directly — more precise than primaryColumn)

- [ ] **Step 2: Fix `src/clis/twitter/follow.ts`**

Find:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 3: Fix `src/clis/twitter/unfollow.ts`**

Find:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 4: Fix `src/clis/twitter/like.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5); // Wait for tweet to load completely
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 5: Fix `src/clis/twitter/bookmark.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 6: Fix `src/clis/twitter/unbookmark.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 7: Fix `src/clis/twitter/block.ts`**

Find:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 8: Fix `src/clis/twitter/unblock.ts`**

Find:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 9: Fix `src/clis/twitter/hide-reply.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 10: Fix `src/clis/twitter/delete.ts`**

Find:
```typescript
    await page.goto(kwargs.url);
    await page.wait(5); // Wait for tweet to load completely
```
Replace with:
```typescript
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

- [ ] **Step 11: Fix `src/clis/twitter/profile.ts`**

There are two wait calls:

Find (detecting logged-in user):
```typescript
      await page.goto('https://x.com/home');
      await page.wait(5);
```
Replace with:
```typescript
      await page.goto('https://x.com/home');
      await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 6 });
```

Find (after going to profile):
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait(3);
```
Replace with:
```typescript
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 });
```

- [ ] **Step 12: Fix `src/clis/twitter/thread.ts`**

Find:
```typescript
    await page.goto('https://x.com');
    await page.wait(3);
```
Replace with:
```typescript
    await page.goto('https://x.com');
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 });
```

- [ ] **Step 13: Fix `src/clis/twitter/timeline.ts`**

Find:
```typescript
    await page.goto('https://x.com');
    await page.wait(3);
```
Replace with:
```typescript
    await page.goto('https://x.com');
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 });
```

- [ ] **Step 14: Fix `src/clis/twitter/reply-dm.ts`**

Find:
```typescript
    await page.goto('https://x.com/messages');
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto('https://x.com/messages');
    await page.wait({ selector: '[data-testid="DMDrawer"], [data-testid="primaryColumn"]', timeout: 6 });
```

Find the second wait in `reply-dm.ts`:
```typescript
      await page.goto(convUrl);
      await page.wait(3);
```
Replace with:
```typescript
      await page.goto(convUrl);
      await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 4 });
```

- [ ] **Step 15: Run adapter tests**

```bash
npx vitest run --project adapter
```
Expected: All PASS.

- [ ] **Step 16: Commit**

```bash
git add src/clis/twitter/reply.ts src/clis/twitter/follow.ts src/clis/twitter/unfollow.ts \
        src/clis/twitter/like.ts src/clis/twitter/bookmark.ts src/clis/twitter/unbookmark.ts \
        src/clis/twitter/block.ts src/clis/twitter/unblock.ts src/clis/twitter/hide-reply.ts \
        src/clis/twitter/delete.ts src/clis/twitter/profile.ts src/clis/twitter/thread.ts \
        src/clis/twitter/timeline.ts src/clis/twitter/reply-dm.ts
git commit -m "perf(twitter): replace wait(N) with wait({ selector }) for React hydration waits"
```

---

## Task 9: Fix medium, substack, bloomberg, sinablog (Layer 2, part 2)

**Files:** `medium/utils.ts`, `substack/utils.ts`, `bloomberg/news.ts`, `sinablog/utils.ts`

The pattern for medium/substack: outer `wait(5)` + inner `setTimeout(3000)` in `evaluate()`. Fix: replace outer with `wait({ selector: 'article', timeout: 8 })`, remove inner setTimeout, and let the evaluate run synchronously.

- [ ] **Step 1: Fix `src/clis/medium/utils.ts`**

Find the `loadMediumPosts` function. Replace:
```typescript
  await page.goto(url);
  await page.wait(5);
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
```
With:
```typescript
  await page.goto(url);
  await page.wait({ selector: 'article', timeout: 8 });
  const data = await page.evaluate(`
    (() => {
```
Also remove the closing `})()` (async) and replace with `()()` (sync). The full evaluate becomes a sync IIFE since the inner sleep is removed.

**Complete replacement** — find the entire evaluate block starting with `(async () => {` and ending with `})()`:

The evaluate body starting line is:
```typescript
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const limit = ${Math.max(1, Math.min(limit, 50))};
```
Replace `(async () => {` with `(() => {` and remove the `await new Promise((resolve) => setTimeout(resolve, 3000));` line (and the blank line after it). Change `})()` closing to `})()`. Remove `async` from the arrow function signature.

- [ ] **Step 2: Fix `src/clis/substack/utils.ts` — `loadSubstackFeed`**

Find:
```typescript
  await page.goto(url);
  await page.wait(5);
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
```
Replace with:
```typescript
  await page.goto(url);
  await page.wait({ selector: 'article, [class*="post"]', timeout: 8 });
  const data = await page.evaluate(`
    (() => {
```
And remove the `await new Promise((resolve) => setTimeout(resolve, 3000));` line. Change `(async () => {` to `(() => {`.

- [ ] **Step 3: Fix `src/clis/substack/utils.ts` — `loadSubstackArchive`**

Same fix as Step 2 but for `loadSubstackArchive`:
```typescript
  await page.goto(`${baseUrl}/archive`);
  await page.wait(5);
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
```
Replace with:
```typescript
  await page.goto(`${baseUrl}/archive`);
  await page.wait({ selector: 'a[href*="/p/"]', timeout: 8 });
  const data = await page.evaluate(`
    (() => {
```
Remove inner setTimeout line. Change async to sync.

- [ ] **Step 4: Fix `src/clis/bloomberg/news.ts`**

Find:
```typescript
    await page.goto(url);
    await page.wait(5);
```
Replace with:
```typescript
    await page.goto(url);
    await page.wait({ selector: '#__NEXT_DATA__, article', timeout: 8 });
```

Find the retry wait:
```typescript
    if (result?.errorCode === 'NO_NEXT_DATA' || result?.errorCode === 'NO_STORY') {
      await page.wait(4);
      result = await loadStory();
    }
```
Replace with:
```typescript
    if (result?.errorCode === 'NO_NEXT_DATA' || result?.errorCode === 'NO_STORY') {
      await page.wait({ selector: '#__NEXT_DATA__', timeout: 5 });
      result = await loadStory();
    }
```

- [ ] **Step 5: Fix `src/clis/sinablog/utils.ts`**

`sinablog` has three functions to fix.

**`loadSinaBlogHot` and `loadSinaBlogUser`** — find their `wait(3)` calls followed by inline `setTimeout(1500)` loops:

```typescript
  await page.goto(url);
  await page.wait(3);
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
```
Replace with:
```typescript
  await page.goto(url);
  await page.wait({ selector: '.article-list, .blog-article, article', timeout: 6 });
  const data = await page.evaluate(`
    (() => {
```
Remove the inner setTimeout line. Change `async` arrow to sync.

**`loadSinaBlogSearch`** — find:
```typescript
  await page.goto(buildSinaBlogSearchUrl(keyword));
  await page.wait(5);
  const data = await page.evaluate(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector('.result-item')) break;
        await sleep(500);
      }
```
Replace with:
```typescript
  await page.goto(buildSinaBlogSearchUrl(keyword));
  await page.wait({ selector: '.result-item', timeout: 8 });
  const data = await page.evaluate(`
    (() => {
```
Remove the `sleep` helper definition and the polling loop (they're replaced by the outer `wait({ selector })`). Change `async` to sync.

- [ ] **Step 6: Run full unit + adapter tests**

```bash
npx vitest run --project unit --project adapter
```
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/clis/medium/utils.ts src/clis/substack/utils.ts \
        src/clis/bloomberg/news.ts src/clis/sinablog/utils.ts
git commit -m "perf(adapters): replace wait(N)+inline-sleep with wait({ selector }) in medium/substack/bloomberg/sinablog"
```

---

## Task 10: Final verification and PR

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run --project unit --project adapter
```
Expected: All tests PASS with no regressions.

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Push and create PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "perf: smart wait — waitForCapture, wait({ selector }), daemon backoff" \
  --body "$(cat <<'EOF'
## Summary

Three layered performance + correctness improvements:

- **Layer 1 — `waitForCapture()`**: Fixes a correctness bug in INTERCEPT adapters where `wait(N)` (now DOM-stable-aware) could return before network captures arrive. Adds `waitForCapture(timeout)` to `IPage` — polls `window.__opencli_xhr` at 100ms intervals, resolves as soon as ≥1 capture exists. Applied to 36kr, twitter/search, followers, following, notifications, producthunt.
- **Layer 2 — `wait({ selector })`**: Extends `WaitOptions` with `selector?: string`. Adds `waitForSelectorJs()` to dom-helpers. Applied to 14 Twitter adapters (replacing `wait(5)` "React hydration" waits with precise element checks) and medium/substack/bloomberg/sinablog (removing duplicate inner `setTimeout` inside `evaluate()`).
- **Layer 3 — daemon backoff**: Replaces fixed 300ms poll with exponential backoff (50→100→200→400→800ms) in `_ensureDaemon()`. Cold-start first-success at ~150ms vs ~600ms.

## Expected gains
- 36kr hot/search: 6s → ~1–2s
- Twitter INTERCEPT commands: 5–8s → ~1–3s
- Twitter UI commands: 5s → ~0.5–2s
- Medium/Substack: 8s → ~1–3s
- Daemon cold-start: ~600ms → ~150ms

## Test plan
- [ ] `npx vitest run --project unit --project adapter` — all pass
- [ ] `npx tsc --noEmit` — no type errors
EOF
)"
```
