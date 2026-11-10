/**
 * Utility functions for browser operations
 */

type EvaluateFunction = (...args: never[]) => unknown;

function describeJsonError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Serialize a function-form page.evaluate call for CDP Runtime.evaluate.
 *
 * Functions execute in the browser page context, so they cannot close over
 * Node-side variables. Pass external values as JSON-serializable args instead.
 */
export function serializeFunctionForEval(fn: EvaluateFunction, args: readonly unknown[] = []): string {
  const source = fn.toString().trim();
  const isFunctionSource = /^(async\s+)?function[\s(]/.test(source)
    || /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(source);
  if (!isFunctionSource || source.includes('[native code]')) {
    throw new Error('page.evaluate(fn) requires a serializable arrow/function expression');
  }

  let serializedArgs: string;
  try {
    serializedArgs = JSON.stringify(args);
  } catch (err) {
    throw new Error(`page.evaluate arguments must be JSON-serializable: ${describeJsonError(err)}`);
  }
  if (serializedArgs === undefined) {
    throw new Error('page.evaluate arguments must be JSON-serializable');
  }

  return `(${source})(...${serializedArgs})`;
}

/**
 * Wrap JS code for CDP Runtime.evaluate:
 * - Already an IIFE `(...)()` → send as-is
 * - Arrow/function literal → wrap as IIFE `(code)()`
 * - `new Promise(...)` or raw expression → send as-is (expression)
 */
export function wrapForEval(js: string): string {
  if (typeof js !== 'string') return 'undefined';
  const code = js.trim();
  if (!code) return 'undefined';

  // Already an IIFE: `(async () => { ... })()` or `(function() {...})()`
  if (/^\([\s\S]*\)\s*\(.*\)\s*$/.test(code)) return code;

  // Arrow function: `() => ...` or `async () => ...`
  if (/^(async\s+)?(\([^)]*\)|[A-Za-z_]\w*)\s*=>/.test(code)) return `(${code})()`;

  // Function declaration: `function ...` or `async function ...`
  if (/^(async\s+)?function[\s(]/.test(code)) return `(${code})()`;

  // Everything else: bare expression, `new Promise(...)`, etc. → evaluate directly
  return code;
}

export function buildEvaluateExpression(input: string | EvaluateFunction, args: readonly unknown[] = []): string {
  if (typeof input === 'function') {
    return serializeFunctionForEval(input, args);
  }
  if (args.length > 0) {
    throw new Error('page.evaluate string input does not accept args; use page.evaluate(fn, ...args) instead');
  }
  return wrapForEval(input);
}

/**
 * Chrome occasionally answers `chrome.tabs.update` with "Navigation rejected."
 * for a tab the automation session already holds (seen on LinkedIn profile
 * hops since 2026-09-14; google/images had the same failure). The tab is not
 * dead — a fresh tab navigates fine — so retry there instead of failing the
 * whole command. Any other error is rethrown untouched.
 *
 * The retry never releases the lease (closeWindow): that dropped the page
 * identity the adapter still held and churned the owned window, which on
 * 2026-09-14 surfaced as a new visible browser window mid-run.
 */
export function isNavigationRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Navigation rejected/i.test(message);
}

interface ResilientPage {
  goto(url: string, options?: Record<string, unknown>): Promise<void>;
  newTab?: (url: string) => Promise<string | null | undefined>;
  setActivePage?: (pageId: string) => Promise<void> | void;
  evaluate?: (js: string) => Promise<unknown>;
}

const LANDING_TIMEOUT_MS = 15_000;
const LANDING_POLL_MS = 250;
const LANDING_STATE_JS = '({ href: location.href, ready: document.readyState })';

/**
 * The fallback tab starts on about:blank and loads on its own schedule, so an adapter that reads
 * it at once sees an empty page. On 2026-09-17 and 09-18 every LinkedIn content search did exactly
 * that: the navigation was rejected, the new tab was still blank when the adapter read it about a
 * second later, and the run reported selector drift. Return once the tab shows a web page (http or
 * https, so not about:blank and not a chrome-error:// page) that has finished loading. At the 15s
 * bound the extension's own navigate uses, a web page that is still loading counts as landed, as
 * it does there: throwing would fail a command whose page did arrive, including the read-back after
 * a real LinkedIn invite. Only a tab that never reached a web page is a navigation failure.
 *
 * Where the tab landed is deliberately not checked against the requested URL: redirects are normal
 * (lnkd.in short links, LinkedIn's authwall), and the adapters already check the page they read.
 */
async function waitForLanding(page: ResilientPage, url: string): Promise<void> {
  if (typeof page.evaluate !== 'function') return;
  const deadline = Date.now() + LANDING_TIMEOUT_MS;
  let lastHref = 'unknown';
  for (;;) {
    try {
      let state = await page.evaluate(LANDING_STATE_JS) as { href?: unknown; ready?: unknown; data?: unknown; session?: unknown } | null;
      if (state && typeof state === 'object' && 'session' in state && 'data' in state) {
        state = state.data as typeof state;
      }
      if (state && typeof state.href === 'string') {
        lastHref = state.href;
        if (isWebPage(state.href) && state.ready === 'complete') return;
      }
    } catch {
      // The target is being replaced mid-navigation; ask again.
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, LANDING_POLL_MS));
  }
  if (isWebPage(lastHref)) return;
  throw new Error(`Navigation never landed: ${url} — the fallback tab still showed ${lastHref} after ${LANDING_TIMEOUT_MS / 1000}s`);
}

function isWebPage(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export async function gotoResilient(page: ResilientPage, url: string, options?: Record<string, unknown>): Promise<void> {
  // Forward options only when given so adapters' `goto(url)` contract (and their tests) hold.
  const go = () => (options === undefined ? page.goto(url) : page.goto(url, options));
  try {
    await go();
    return;
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
  }
  try {
    await go();
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
    if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
      const pageId = await page.newTab(url);
      if (pageId) {
        await page.setActivePage(pageId);
        await waitForLanding(page, url);
        return;
      }
    }
    throw error;
  }
}
