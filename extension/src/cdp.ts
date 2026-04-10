/**
 * CDP execution via chrome.debugger API.
 *
 * chrome.debugger only needs the "debugger" permission — no host_permissions.
 * It can attach to any http/https tab. Avoid chrome:// and chrome-extension://
 * tabs (resolveTabId in background.ts filters them).
 */

const attached = new Set<number>();

type ConsoleMessage = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp?: number;
  source?: 'console-api' | 'exception';
};

type NetworkCaptureEntry = {
  kind: 'cdp';
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBodyKind?: string;
  requestBodyPreview?: string;
  responseStatus?: number;
  responseContentType?: string;
  responseHeaders?: Record<string, string>;
  responsePreview?: string;
  timestamp: number;
};

type NetworkCaptureState = {
  patterns: string[];
  entries: NetworkCaptureEntry[];
  requestToIndex: Map<string, number>;
  pendingBodyFetches: Set<Promise<void>>;
  consoleErrors: ConsoleMessage[];
  consoleOther: ConsoleMessage[];
  armed: boolean;
};

const networkCaptures = new Map<number, NetworkCaptureState>();
const captureIntents = new Map<number, { patterns: string[] }>();
/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
function isDebuggableUrl(url?: string): boolean {
  if (!url) return true;  // empty/undefined = tab still loading, allow it
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank' || url.startsWith('data:');
}

async function cleanupForeignExtensionSurface(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        document.querySelectorAll('iframe[src^="chrome-extension://"], [src^="chrome-extension://"]')
          .forEach((node) => node.remove());
      },
    });
  } catch {
    // Best-effort cleanup only.
  }
}

export async function ensureAttached(tabId: number, aggressiveRetry: boolean = false): Promise<void> {
  // Verify the tab URL is debuggable before attempting attach
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isDebuggableUrl(tab.url)) {
      // Invalidate cache if previously attached
      attached.delete(tabId);
      throw new Error(`Cannot debug tab ${tabId}: URL is ${tab.url ?? 'unknown'}`);
    }
  } catch (e) {
    // Re-throw our own error, catch only chrome.tabs.get failures
    if (e instanceof Error && e.message.startsWith('Cannot debug tab')) throw e;
    attached.delete(tabId);
    throw new Error(`Tab ${tabId} no longer exists`);
  }

  if (attached.has(tabId)) {
    // Verify the debugger is still actually attached by sending a harmless command
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1', returnByValue: true,
      });
      return; // Still attached and working
    } catch {
      // Stale cache entry — need to re-attach
      attached.delete(tabId);
    }
  }

  // Retry attach up to 3 times — other extensions (1Password, Playwright MCP Bridge)
  // can temporarily interfere with chrome.debugger. A short delay usually resolves it.
  // Normal commands: 2 retries, 500ms delay (fast fail for non-browser use)
  // Browser commands: 5 retries, 1500ms delay (aggressive, tolerates extension interference)
  const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
  const RETRY_DELAY_MS = aggressiveRetry ? 1500 : 500;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) {
    try {
      // Force detach first to clear any stale state from other extensions
      try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
      await chrome.debugger.attach({ tabId }, '1.3');
      lastError = '';
      break; // Success
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTACH_RETRIES) {
        if (lastError.includes('chrome-extension://')) {
          await cleanupForeignExtensionSurface(tabId);
        }
        console.warn(`[opencli] attach attempt ${attempt}/${MAX_ATTACH_RETRIES} failed: ${lastError}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        // Re-verify tab URL before retrying (it may have changed)
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!isDebuggableUrl(tab.url)) {
            lastError = `Tab URL changed to ${tab.url} during retry`;
            break; // Don't retry if URL became un-debuggable
          }
        } catch {
          // Tab is gone — don't fail early here.
          // Later retry layers can re-resolve a fresh automation tab/window.
          lastError = `Tab ${tabId} no longer exists`;
          // Don't break; fall through to retry
        }
      }
    }
  }

  if (lastError) {
    // Log detailed diagnostics for debugging extension conflicts
    let finalUrl = 'unknown';
    let finalWindowId = 'unknown';
    try {
      const tab = await chrome.tabs.get(tabId);
      finalUrl = tab.url ?? 'undefined';
      finalWindowId = String(tab.windowId);
    } catch { /* tab gone */ }
    console.warn(`[opencli] attach failed for tab ${tabId}: url=${finalUrl}, windowId=${finalWindowId}, error=${lastError}`);

    const hint = lastError.includes('chrome-extension://')
      ? '. Tip: another Chrome extension may be interfering — try disabling other extensions'
      : '';
    throw new Error(`attach failed: ${lastError}${hint}`);
  }
  attached.add(tabId);

  const state = networkCaptures.get(tabId);
  if (captureIntents.has(tabId) && !state?.armed) {
    try {
      // armCapture() re-enables Runtime/Network and reinstalls listeners, so
      // the generic Runtime.enable call below is intentionally skipped here.
      await armCapture(tabId);
    } catch (error) {
      console.warn(`[opencli] failed to rearm capture for tab ${tabId}: ${error}`);
    }
    return;
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch {
    // Some pages may not need explicit enable
  }
}

export async function evaluate(tabId: number, expression: string, aggressiveRetry: boolean = false): Promise<unknown> {
  // Retry the entire evaluate (attach + command).
  // Normal: 2 retries. Browser: 3 retries (tolerates extension interference).
  const MAX_EVAL_RETRIES = aggressiveRetry ? 3 : 2;
  for (let attempt = 1; attempt <= MAX_EVAL_RETRIES; attempt++) {
    try {
      await ensureAttached(tabId, aggressiveRetry);

      const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }) as {
        result?: { type: string; value?: unknown; description?: string; subtype?: string };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };

      if (result.exceptionDetails) {
        const errMsg = result.exceptionDetails.exception?.description
          || result.exceptionDetails.text
          || 'Eval error';
        throw new Error(errMsg);
      }

      return result.result?.value;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry on attach/debugger errors, not on JS eval errors
      const isNavigateError = msg.includes('Inspected target navigated') || msg.includes('Target closed');
      const isAttachError = isNavigateError || msg.includes('attach failed') || msg.includes('Debugger is not attached')
        || msg.includes('chrome-extension://');
      if (isAttachError && attempt < MAX_EVAL_RETRIES) {
        attached.delete(tabId); // Force re-attach on next attempt
        // SPA navigations recover quickly; debugger detach needs longer
        const retryMs = isNavigateError ? 200 : 500;
        await new Promise(resolve => setTimeout(resolve, retryMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error('evaluate: max retries exhausted');
}

export const evaluateAsync = evaluate;

/**
 * Capture a screenshot via CDP Page.captureScreenshot.
 * Returns base64-encoded image data.
 */
export async function screenshot(
  tabId: number,
  options: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } = {},
): Promise<string> {
  await ensureAttached(tabId);

  const format = options.format ?? 'png';

  // For full-page screenshots, get the full page dimensions first
  if (options.fullPage) {
    // Get full page metrics
    const metrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics') as {
      contentSize?: { width: number; height: number };
      cssContentSize?: { width: number; height: number };
    };
    const size = metrics.cssContentSize || metrics.contentSize;
    if (size) {
      // Set device metrics to full page size
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
        mobile: false,
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
        deviceScaleFactor: 1,
      });
    }
  }

  try {
    const params: Record<string, unknown> = { format };
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = Math.max(0, Math.min(100, options.quality));
    }

    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', params) as {
      data: string; // base64-encoded
    };

    return result.data;
  } finally {
    // Reset device metrics if we changed them for full-page
    if (options.fullPage) {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
  }
}

/**
 * Set local file paths on a file input element via CDP DOM.setFileInputFiles.
 * This bypasses the need to send large base64 payloads through the message channel —
 * Chrome reads the files directly from the local filesystem.
 *
 * @param tabId - Target tab ID
 * @param files - Array of absolute local file paths
 * @param selector - CSS selector to find the file input (optional, defaults to first file input)
 */
export async function setFileInputFiles(
  tabId: number,
  files: string[],
  selector?: string,
): Promise<void> {
  await ensureAttached(tabId);

  // Enable DOM domain (required for DOM.querySelector and DOM.setFileInputFiles)
  await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');

  // Get the document root
  const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument') as {
    root: { nodeId: number };
  };

  // Find the file input element
  const query = selector || 'input[type="file"]';
  const result = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: query,
  }) as { nodeId: number };

  if (!result.nodeId) {
    throw new Error(`No element found matching selector: ${query}`);
  }

  // Set files directly via CDP — Chrome reads from local filesystem
  await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
    files,
    nodeId: result.nodeId,
  });
}

export async function insertText(
  tabId: number,
  text: string,
): Promise<void> {
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

function normalizeCapturePatterns(pattern?: string): string[] {
  return String(pattern || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function shouldCaptureUrl(url: string | undefined, patterns: string[]): boolean {
  if (!url) return false;
  if (!patterns.length) return true;
  return patterns.some((pattern) => url.includes(pattern));
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[String(key)] = String(value);
  }
  return out;
}

function resetNetworkBuffers(state: NetworkCaptureState): void {
  state.entries = [];
  state.requestToIndex.clear();
  state.pendingBodyFetches = new Set();
}

function resetConsoleBuffers(state: NetworkCaptureState): void {
  state.consoleErrors = [];
  state.consoleOther = [];
}

function normalizeConsoleLevel(type: string): ConsoleMessage['level'] | null {
  switch (type) {
    case 'warning':
      return 'warn';
    case 'verbose':
      return 'debug';
    case 'log':
    case 'warn':
    case 'error':
    case 'info':
    case 'debug':
      return type;
    default:
      return null;
  }
}

function pushConsoleMessage(state: NetworkCaptureState, message: ConsoleMessage): void {
  const bucket = message.level === 'error' || message.level === 'warn'
    ? state.consoleErrors
    : state.consoleOther;
  bucket.push(message);
  const limit = bucket === state.consoleErrors ? 200 : 300;
  if (bucket.length > limit) bucket.shift();
}

async function armCapture(tabId: number): Promise<void> {
  const patterns = captureIntents.get(tabId)?.patterns ?? networkCaptures.get(tabId)?.patterns ?? [];
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  const existing = networkCaptures.get(tabId);
  networkCaptures.set(tabId, {
    patterns,
    entries: existing?.entries ?? [],
    requestToIndex: existing?.requestToIndex ?? new Map(),
    pendingBodyFetches: existing?.pendingBodyFetches ?? new Set(),
    consoleErrors: existing?.consoleErrors ?? [],
    consoleOther: existing?.consoleOther ?? [],
    armed: true,
  });
}

function getOrCreateNetworkCaptureEntry(tabId: number, requestId: string, fallback?: {
  url?: string;
  method?: string;
  requestHeaders?: Record<string, string>;
}): NetworkCaptureEntry | null {
  const state = networkCaptures.get(tabId);
  if (!state) return null;
  const existingIndex = state.requestToIndex.get(requestId);
  if (existingIndex !== undefined) {
    return state.entries[existingIndex] || null;
  }
  const url = fallback?.url || '';
  if (!shouldCaptureUrl(url, state.patterns)) return null;
  const entry: NetworkCaptureEntry = {
    kind: 'cdp',
    url,
    method: fallback?.method || 'GET',
    requestHeaders: fallback?.requestHeaders || {},
    timestamp: Date.now(),
  };
  state.entries.push(entry);
  state.requestToIndex.set(requestId, state.entries.length - 1);
  return entry;
}

export async function startNetworkCapture(
  tabId: number,
  pattern?: string,
): Promise<void> {
  const patterns = normalizeCapturePatterns(pattern);
  captureIntents.set(tabId, { patterns });

  const existing = networkCaptures.get(tabId);
  if (existing) {
    existing.patterns = patterns;
    resetNetworkBuffers(existing);
  }

  await ensureAttached(tabId);

  const state = networkCaptures.get(tabId);
  if (state?.armed) return;
  await armCapture(tabId);
  resetNetworkBuffers(networkCaptures.get(tabId)!);
}

async function ensureCaptureReadable(tabId: number): Promise<NetworkCaptureState | undefined> {
  const state = networkCaptures.get(tabId);
  if (!captureIntents.has(tabId) || state?.armed) return state;
  await ensureAttached(tabId);
  const refreshed = networkCaptures.get(tabId);
  if (captureIntents.has(tabId) && !refreshed?.armed) {
    throw new Error(`capture rearm failed for tab ${tabId}`);
  }
  return refreshed;
}

export async function readNetworkCapture(tabId: number): Promise<NetworkCaptureEntry[]> {
  const state = await ensureCaptureReadable(tabId);
  if (!state) return [];
  if (state.pendingBodyFetches.size > 0) {
    await Promise.allSettled([...state.pendingBodyFetches]);
  }
  const entries = state.entries.slice();
  state.entries = [];
  state.requestToIndex.clear();
  return entries;
}

export async function readConsoleCapture(tabId: number): Promise<ConsoleMessage[]> {
  const state = await ensureCaptureReadable(tabId);
  if (!state) return [];
  // Console capture is intentionally non-draining so callers can inspect the
  // full rolling session log, unlike readNetworkCapture(), which drains new
  // network entries after each read.
  return [...state.consoleErrors, ...state.consoleOther]
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

export async function stopCapture(tabId: number): Promise<void> {
  captureIntents.delete(tabId);
  networkCaptures.delete(tabId);
}

export async function detach(tabId: number): Promise<void> {
  const state = networkCaptures.get(tabId);
  const preserveCapture = captureIntents.has(tabId);
  if (state) {
    state.armed = false;
    state.requestToIndex.clear();
    if (!preserveCapture) {
      resetNetworkBuffers(state);
      resetConsoleBuffers(state);
      networkCaptures.delete(tabId);
    }
  }
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
}

export function hasCaptureIntent(tabId: number): boolean {
  return captureIntents.has(tabId);
}

export function registerListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
    captureIntents.delete(tabId);
    networkCaptures.delete(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attached.delete(source.tabId);
      const state = networkCaptures.get(source.tabId);
      if (!state) return;
      state.armed = false;
      state.requestToIndex.clear();
      if (!captureIntents.has(source.tabId)) {
        resetNetworkBuffers(state);
        resetConsoleBuffers(state);
        networkCaptures.delete(source.tabId);
      }
    }
  });
  // Invalidate attached cache when tab URL changes to non-debuggable
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.url && !isDebuggableUrl(info.url)) {
      await detach(tabId);
    }
  });
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    const tabId = source.tabId;
    if (!tabId) return;
    const state = networkCaptures.get(tabId);
    if (!state?.armed) return;

    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params?.requestId || '');
      const request = params?.request as {
        url?: string;
        method?: string;
        headers?: Record<string, unknown>;
        postData?: string;
        hasPostData?: boolean;
      } | undefined;
      const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
        url: request?.url,
        method: request?.method,
        requestHeaders: normalizeHeaders(request?.headers),
      });
      if (!entry) return;
      entry.requestBodyKind = request?.hasPostData ? 'string' : 'empty';
      entry.requestBodyPreview = String(request?.postData || '').slice(0, 4000);
      try {
        const postData = await chrome.debugger.sendCommand({ tabId }, 'Network.getRequestPostData', { requestId }) as { postData?: string };
        if (postData?.postData) {
          entry.requestBodyKind = 'string';
          entry.requestBodyPreview = postData.postData.slice(0, 4000);
        }
      } catch {
        // Optional; some requests do not expose postData.
      }
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = String(params?.requestId || '');
      const response = params?.response as {
        url?: string;
        mimeType?: string;
        status?: number;
        headers?: Record<string, unknown>;
      } | undefined;
      const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
        url: response?.url,
      });
      if (!entry) return;
      entry.responseStatus = response?.status;
      entry.responseContentType = response?.mimeType || '';
      entry.responseHeaders = normalizeHeaders(response?.headers);
      return;
    }

    if (method === 'Network.loadingFinished') {
      const requestId = String(params?.requestId || '');
      const stateEntryIndex = state.requestToIndex.get(requestId);
      if (stateEntryIndex === undefined) return;
      const entry = state.entries[stateEntryIndex];
      if (!entry) return;
      const bodyFetch = (async () => {
        try {
          const body = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }) as {
            body?: string;
            base64Encoded?: boolean;
          };
          if (typeof body?.body === 'string') {
            entry.responsePreview = body.base64Encoded
              ? `base64:${body.body.slice(0, 4000)}`
              : body.body.slice(0, 4000);
          }
        } catch {
          // Optional; bodies are unavailable for some requests (e.g. uploads).
        }
      })();
      state.pendingBodyFetches.add(bodyFetch);
      void bodyFetch.finally(() => {
        state.pendingBodyFetches.delete(bodyFetch);
      });
      return;
    }

    if (method === 'Runtime.consoleAPICalled') {
      const consoleParams = params as {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        timestamp?: number;
      };
      const level = normalizeConsoleLevel(String(consoleParams.type || ''));
      if (!level) return;
      const text = (consoleParams.args || [])
        .map((arg) => arg.value !== undefined ? String(arg.value) : String(arg.description || ''))
        .join(' ');
      pushConsoleMessage(state, {
        level,
        text,
        timestamp: consoleParams.timestamp,
        source: 'console-api',
      });
      return;
    }

    if (method === 'Runtime.exceptionThrown') {
      const exceptionParams = params as {
        timestamp?: number;
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };
      pushConsoleMessage(state, {
        level: 'error',
        text: exceptionParams.exceptionDetails?.exception?.description
          || exceptionParams.exceptionDetails?.text
          || 'Unknown exception',
        timestamp: exceptionParams.timestamp,
        source: 'exception',
      });
    }
  });
}
