/**
 * CDP execution via chrome.debugger API (Chrome) or tabs API (Firefox).
 *
 * Chrome: uses chrome.debugger for full CDP access.
 * Firefox: uses browser.tabs.executeScript() for JS eval and
 *          browser.tabs.captureTab() for screenshots.
 */

import { CDP_VERSION, IS_FIREFOX } from './browser-compat';

const attached = new Set<number>();

const tabFrameContexts = new Map<number, Map<string, number>>();
const frameTargets = new Map<string, string>();
const frameTargetKeys = new Map<string, string>();
let frameTargetCleanupRegistered = false;

const CDP_RESPONSE_BODY_CAPTURE_LIMIT = 8 * 1024 * 1024;
const CDP_REQUEST_BODY_CAPTURE_LIMIT = 1 * 1024 * 1024;

/**
 * Whether to use the chrome.debugger API path.
 * On Firefox builds (IS_FIREFOX=true), we always use the Firefox-compatible path
 * even if chrome.debugger happens to exist in the environment.
 * On Chrome builds, we check if the API is actually available.
 */
const USE_DEBUGGER = !IS_FIREFOX && typeof chrome !== 'undefined' && typeof chrome.debugger !== 'undefined';

type NetworkCaptureEntry = {
  kind: 'cdp';
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBodyKind?: string;
  requestBodyPreview?: string;
  requestBodyFullSize?: number;
  requestBodyTruncated?: boolean;
  responseStatus?: number;
  responseContentType?: string;
  responseHeaders?: Record<string, string>;
  responsePreview?: string;
  responseBodyFullSize?: number;
  responseBodyTruncated?: boolean;
  timestamp: number;
};

type NetworkCaptureState = {
  patterns: string[];
  entries: NetworkCaptureEntry[];
  requestToIndex: Map<string, number>;
};

export type DownloadWaitResult = {
  downloaded: boolean;
  id?: number;
  filename?: string;
  url?: string;
  finalUrl?: string;
  mime?: string;
  totalBytes?: number;
  state?: string;
  danger?: string;
  error?: string;
  elapsedMs: number;
};

const networkCaptures = new Map<number, NetworkCaptureState>();

function isDebuggableUrl(url?: string): boolean {
  if (!url) return true;
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank' || url.startsWith('data:');
}

// ─── Firefox-compatible helpers ───────────────────────────────────────

/**
 * Get the browser API namespace. Firefox provides `browser` globally.
 * Chrome doesn't have `browser`, so we fall back to `chrome`.
 */
function getBrowserAPI(): any {
  return (typeof globalThis.browser !== 'undefined') ? globalThis.browser : chrome;
}

/**
 * Execute JS in a tab using Firefox's scripting API (MV3) or tabs API (MV2).
 * Returns the evaluated value.
 *
 * Execute a JS expression in a Firefox tab.
 *
 * Strategy (tried in order):
 * 1. world:'MAIN' — runs in the page's own JS context, bypassing
 *    content-script CSP eval restrictions (Firefox 128+).
 * 2. ISOLATED world with eval() wrapper — works on CSP-relaxed pages,
 *    about:blank, and Firefox <128.
 * 3. MV2 tabs.executeScript fallback.
 */
async function firefoxExecuteScript(tabId: number, expression: string): Promise<unknown> {
  const api = getBrowserAPI();

  if (api.scripting && typeof api.scripting.executeScript === 'function') {
    // ── Primary: MAIN world (bypasses page CSP for eval) ──
    try {
      const mainResults = await api.scripting.executeScript({
        target: { tabId },
        func: (expr: string) => {
          // eslint-disable-next-line no-eval
          return eval(expr);
        },
        args: [expression],
        // @ts-expect-error -- world:'MAIN' is Firefox 128+, not yet in type defs
        world: 'MAIN',
      });
      const mainRaw = mainResults?.[0]?.result;
      if (mainRaw !== null && mainRaw !== undefined && typeof mainRaw === 'object' && typeof mainRaw.then === 'function') {
        return await mainRaw;
      }
      if (mainRaw !== undefined) return mainRaw;
      // undefined from MAIN world means expression was void — acceptable
    } catch {
      // world:'MAIN' not supported (Firefox <128) or injection failed — fall through
    }

    // ── Fallback: ISOLATED world with eval wrapper ──
    const execInPage = (expr: string) => {
      return eval(expr); // eslint-disable-line no-eval
    };
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: execInPage,
      args: [expression],
    });
    const raw = results?.[0]?.result;
    if (raw !== null && raw !== undefined && typeof raw === 'object' && typeof raw.then === 'function') {
      return await raw;
    }
    return raw;
  }

  // Firefox MV2 fallback: use browser.tabs.executeScript
  const wrappedCode = `(async () => { return ${expression}; })().then(__r => { return JSON.stringify({ok:true,v:__r}); }).catch(__e => { return JSON.stringify({ok:false,e:String(__e)}); })`;

  const results = await api.tabs.executeScript(tabId, { code: wrappedCode });
  const raw = results?.[0];

  if (raw === null || raw === undefined) return raw;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.ok) return parsed.v;
      throw new Error(parsed.e);
    } catch (e) {
      if (e instanceof Error && !e.message.includes('JSON')) throw e;
      return raw;
    }
  }

  return raw;
}

/**
 * Capture a screenshot using Firefox's tabs.captureTab API.
 * Returns base64-encoded image data (without data URL prefix).
 */
async function firefoxCaptureTab(tabId: number, format: string, quality?: number): Promise<string> {
  const api = getBrowserAPI();
  const opts: any = {};
  if (format === 'jpeg' && quality !== undefined) {
    opts.quality = Math.max(0, Math.min(100, quality));
  }
  const dataUrl: string = await api.tabs.captureTab(tabId, opts);
  // dataUrl format: "data:image/png;base64,iVBOR..."
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

// ─── Core API ─────────────────────────────────────────────────────────

export async function ensureAttached(tabId: number, _aggressiveRetry: boolean = false): Promise<void> {
  // Firefox: no debugger to attach, just verify tab exists
  if (!USE_DEBUGGER) {
    try {
      await chrome.tabs.get(tabId);
    } catch {
      throw new Error(`Tab ${tabId} no longer exists`);
    }
    return;
  }

  // Chrome: attach via chrome.debugger
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isDebuggableUrl(tab.url)) {
      attached.delete(tabId);
      throw new Error(`Cannot debug tab ${tabId}: URL is ${tab.url ?? 'unknown'}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Cannot debug tab')) throw e;
    attached.delete(tabId);
    throw new Error(`Tab ${tabId} no longer exists`);
  }

  if (attached.has(tabId)) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1', returnByValue: true,
      });
      return;
    } catch {
      attached.delete(tabId);
    }
  }

  const MAX_ATTACH_RETRIES = _aggressiveRetry ? 5 : 2;
  const RETRY_DELAY_MS = _aggressiveRetry ? 1500 : 500;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) {
    try {
      try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
      lastError = '';
      break;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTACH_RETRIES) {
        console.warn(`[opencli] attach attempt ${attempt}/${MAX_ATTACH_RETRIES} failed: ${lastError}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!isDebuggableUrl(tab.url)) {
            lastError = `Tab URL changed to ${tab.url} during retry`;
            break;
          }
        } catch {
          lastError = `Tab ${tabId} no longer exists`;
        }
      }
    }
  }

  if (lastError) {
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

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch { /* some pages may not need explicit enable */ }
}

export async function evaluate(tabId: number, expression: string, aggressiveRetry: boolean = false): Promise<unknown> {
  // Firefox path: use tabs.executeScript
  if (!USE_DEBUGGER) {
    return firefoxExecuteScript(tabId, expression);
  }

  // Chrome path: use chrome.debugger
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
      const isNavigateError = msg.includes('Inspected target navigated') || msg.includes('Target closed');
      const isAttachError = isNavigateError || msg.includes('attach failed') || msg.includes('Debugger is not attached')
        || msg.includes('chrome-extension://');
      if (isAttachError && attempt < MAX_EVAL_RETRIES) {
        attached.delete(tabId);
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
 * Capture a screenshot. Returns base64-encoded image data.
 */
export async function screenshot(
  tabId: number,
  options: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean; width?: number; height?: number } = {},
): Promise<string> {
  const format = options.format ?? 'png';

  // Firefox path: use tabs.captureTab
  if (!USE_DEBUGGER) {
    if (options.fullPage) {
      console.warn('[opencli] fullPage screenshot is not supported on Firefox — capturing viewport only');
    }
    if (options.width || options.height) {
      console.warn('[opencli] viewport override is not supported on Firefox — capturing current viewport');
    }
    return firefoxCaptureTab(tabId, format, options.quality);
  }

  // Chrome path: use chrome.debugger CDP
  await ensureAttached(tabId);

  const fullPage = options.fullPage === true;
  const overrideWidth = options.width && options.width > 0 ? Math.ceil(options.width) : undefined;
  const overrideHeight = !fullPage && options.height && options.height > 0 ? Math.ceil(options.height) : undefined;
  const needsOverride = fullPage || overrideWidth !== undefined || overrideHeight !== undefined;

  if (needsOverride) {
    if (overrideWidth !== undefined && fullPage) {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
        mobile: false, width: overrideWidth, height: 0, deviceScaleFactor: 1,
      });
    }
    let finalWidth = overrideWidth ?? 0;
    let finalHeight = overrideHeight ?? 0;
    if (fullPage) {
      const metrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics') as {
        contentSize?: { width: number; height: number };
        cssContentSize?: { width: number; height: number };
      };
      const size = metrics.cssContentSize || metrics.contentSize;
      if (size) {
        if (finalWidth === 0) finalWidth = Math.ceil(size.width);
        finalHeight = Math.ceil(size.height);
      }
    }
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
      mobile: false, width: finalWidth, height: finalHeight, deviceScaleFactor: 1,
    });
  }

  try {
    const params: Record<string, unknown> = { format };
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = Math.max(0, Math.min(100, options.quality));
    }
    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', params) as {
      data: string;
    };
    return result.data;
  } finally {
    if (needsOverride) {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
  }
}

export async function setFileInputFiles(
  tabId: number,
  files: string[],
  selector?: string,
): Promise<void> {
  if (!USE_DEBUGGER) {
    throw new Error('setFileInputFiles is not supported on Firefox — use the file dialog manually or set files via JS injection');
  }

  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
  const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument') as {
    root: { nodeId: number };
  };
  const query = selector || 'input[type="file"]';
  const result = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
    nodeId: doc.root.nodeId, selector: query,
  }) as { nodeId: number };
  if (!result.nodeId) {
    throw new Error(`No element found matching selector: ${query}`);
  }
  await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
    files, nodeId: result.nodeId,
  });
}

// ─── Download handling ────────────────────────────────────────────────

function matchesDownloadPattern(item: chrome.downloads.DownloadItem, pattern: string): boolean {
  if (!pattern) return true;
  const haystack = [item.filename, item.url, item.finalUrl, item.mime].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(pattern.toLowerCase());
}

function downloadResult(item: chrome.downloads.DownloadItem, startedAt: number): DownloadWaitResult {
  return {
    downloaded: item.state === 'complete',
    id: item.id, filename: item.filename, url: item.url, finalUrl: item.finalUrl,
    mime: item.mime, totalBytes: item.totalBytes, state: item.state,
    danger: item.danger, error: item.error, elapsedMs: Date.now() - startedAt,
  };
}

export async function waitForDownload(pattern: string = '', timeoutMs: number = 30000): Promise<DownloadWaitResult> {
  const startedAt = Date.now();
  const timeout = Math.max(1, timeoutMs);

  return await new Promise<DownloadWaitResult>((resolve) => {
    let done = false;
    const inProgressIds = new Set<number>();
    const finish = (result: DownloadWaitResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };

    const inspectById = async (id: number) => {
      const items = await chrome.downloads.search({ id });
      const item = items[0];
      if (!item || !matchesDownloadPattern(item, pattern)) return;
      inProgressIds.add(id);
      if (item.state === 'complete' || item.state === 'interrupted') finish(downloadResult(item, startedAt));
    };

    const onCreated = (item: chrome.downloads.DownloadItem) => {
      if (!matchesDownloadPattern(item, pattern)) return;
      inProgressIds.add(item.id);
      if (item.state === 'complete' || item.state === 'interrupted') finish(downloadResult(item, startedAt));
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (!delta.id) return;
      if (!inProgressIds.has(delta.id) && !delta.filename && !delta.url) return;
      if (delta.filename?.current || delta.url?.current) {
        void inspectById(delta.id);
        return;
      }
      if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
        void inspectById(delta.id);
      }
    };
    const timer = setTimeout(() => {
      finish({
        downloaded: false, state: 'interrupted',
        error: `No download matched "${pattern || '*'}" within ${timeout}ms`,
        elapsedMs: Date.now() - startedAt,
      });
    }, timeout);

    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);

    void chrome.downloads.search({
      limit: 50, orderBy: ['-startTime'],
      startedAfter: new Date(startedAt - Math.max(timeout, 1000)).toISOString(),
    }).then((recent) => {
      if (done) return;
      const completed = recent.find((item) => item.state === 'complete' && matchesDownloadPattern(item, pattern));
      if (completed) { finish(downloadResult(completed, startedAt)); return; }
      for (const item of recent) {
        if (item.state === 'in_progress' && matchesDownloadPattern(item, pattern)) inProgressIds.add(item.id);
      }
    }).catch((err) => {
      finish({
        downloaded: false, state: 'interrupted',
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

// ─── Frame operations (Chrome only) ──────────────────────────────────

function frameTargetKey(tabId: number, frameId: string): string {
  return `${tabId}:${frameId}`;
}

function registerFrameTargetCleanup(): void {
  if (!USE_DEBUGGER || frameTargetCleanupRegistered) return;
  frameTargetCleanupRegistered = true;
  chrome.debugger.onEvent.addListener((_source, method, params: any) => {
    if (method === 'Target.detachedFromTarget') {
      clearFrameTarget(String(params?.targetId || ''));
    }
  });
}

function clearFrameTarget(targetId: string): void {
  if (!targetId) return;
  const key = frameTargetKeys.get(targetId);
  if (key) frameTargets.delete(key);
  frameTargetKeys.delete(targetId);
}

async function ensureFrameTarget(
  tabId: number, frameId: string, aggressiveRetry: boolean = false, targetUrl?: string,
): Promise<string> {
  if (!USE_DEBUGGER) throw new Error('Frame targeting is not supported on Firefox');
  registerFrameTargetCleanup();
  await ensureAttached(tabId, aggressiveRetry);
  const key = frameTargetKey(tabId, frameId);
  const existing = frameTargets.get(key);
  if (existing) return existing;

  await chrome.debugger.sendCommand({ tabId }, 'Target.setDiscoverTargets', { discover: true }).catch(() => {});
  await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: 'iframe', exclude: false }],
  }).catch(() => {});
  const targetId = await resolveFrameTargetId(tabId, frameId, targetUrl);
  try {
    await chrome.debugger.attach({ targetId } as chrome.debugger.Debuggee, CDP_VERSION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('Another debugger is already attached')) throw err;
  }
  frameTargets.set(key, targetId);
  frameTargetKeys.set(targetId, key);
  return targetId;
}

async function resolveFrameTargetId(tabId: number, frameId: string, targetUrl?: string): Promise<string> {
  const result = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargets').catch(() => null) as
    | { targetInfos?: Array<{ targetId?: string; id?: string; type?: string; url?: string }> }
    | null;
  const targets = result?.targetInfos ?? [];
  const frameTarget = targets.find((candidate) => {
    const candidateId = candidate.targetId || candidate.id;
    return candidate.type === 'iframe' && (candidateId === frameId || (!!targetUrl && candidate.url === targetUrl));
  });
  const targetId = frameTarget?.targetId || frameTarget?.id;
  if (targetId) return targetId;
  const candidates = targets.filter((t) => t.type === 'iframe')
    .map((t) => `${t.targetId || t.id || '?'} ${t.url || ''}`).join('; ');
  throw new Error(`No iframe target found for frame ${frameId}${targetUrl ? ` (${targetUrl})` : ''}. Candidates: ${candidates || 'none'}`);
}

export async function sendCommandInFrameTarget(
  tabId: number, frameId: string, method: string, params: Record<string, unknown> = {},
  aggressiveRetry: boolean = false, _timeoutMs: number = 30_000, targetUrl?: string,
): Promise<unknown> {
  const targetId = await ensureFrameTarget(tabId, frameId, aggressiveRetry, targetUrl);
  return chrome.debugger.sendCommand({ targetId } as chrome.debugger.Debuggee, method, params);
}

export async function insertText(tabId: number, text: string): Promise<void> {
  if (!USE_DEBUGGER) {
    // Firefox: use execCommand via tabs.executeScript
    await evaluate(tabId, `document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    return;
  }
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

export function registerFrameTracking(): void {
  if (!USE_DEBUGGER) return; // Not available on Firefox
  registerFrameTargetCleanup();
  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (!tabId) return;
    if (method === 'Runtime.executionContextCreated') {
      const context = params.context;
      if (!context?.auxData?.frameId || context.auxData.isDefault !== true) return;
      const frameId = context.auxData.frameId as string;
      if (!tabFrameContexts.has(tabId)) tabFrameContexts.set(tabId, new Map());
      tabFrameContexts.get(tabId)!.set(frameId, context.id);
    }
    if (method === 'Runtime.executionContextDestroyed') {
      const ctxId = params.executionContextId;
      const contexts = tabFrameContexts.get(tabId);
      if (contexts) {
        for (const [fid, cid] of contexts) {
          if (cid === ctxId) { contexts.delete(fid); break; }
        }
      }
    }
    if (method === 'Runtime.executionContextsCleared') {
      tabFrameContexts.delete(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabFrameContexts.delete(tabId);
  });
}

export async function getFrameTree(tabId: number): Promise<any> {
  if (!USE_DEBUGGER) throw new Error('getFrameTree is not supported on Firefox');
  await ensureAttached(tabId);
  return chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree');
}

export async function evaluateInFrame(
  tabId: number, expression: string, frameId: string, aggressiveRetry: boolean = false,
): Promise<unknown> {
  if (!USE_DEBUGGER) {
    // Firefox fallback: evaluate in main frame (limited)
    console.warn('[opencli] evaluateInFrame is not fully supported on Firefox — evaluating in main frame');
    return evaluate(tabId, expression);
  }

  await ensureAttached(tabId, aggressiveRetry);
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => {});

  const contexts = tabFrameContexts.get(tabId);
  const contextId = contexts?.get(frameId);

  if (contextId === undefined) {
    await sendCommandInFrameTarget(tabId, frameId, 'Runtime.enable', {}, aggressiveRetry).catch(() => undefined);
    const result = await sendCommandInFrameTarget(tabId, frameId, 'Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, aggressiveRetry) as {
      result?: { type: string; value?: unknown; description?: string; subtype?: string };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Eval error');
    }
    return result.result?.value;
  }

  const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression, contextId, returnByValue: true, awaitPromise: true,
  }) as {
    result?: { type: string; value?: unknown; description?: string; subtype?: string };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Eval error');
  }
  return result.result?.value;
}

// ─── Network capture (Chrome only) ──────────────────────────────────

function normalizeCapturePatterns(pattern?: string): string[] {
  return String(pattern || '').split('|').map((p) => p.trim()).filter(Boolean);
}

function shouldCaptureUrl(url: string | undefined, patterns: string[]): boolean {
  if (!url) return false;
  if (!patterns.length) return true;
  return patterns.some((p) => url.includes(p));
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[String(key)] = String(value);
  }
  return out;
}

function getOrCreateNetworkCaptureEntry(tabId: number, requestId: string, fallback?: {
  url?: string; method?: string; requestHeaders?: Record<string, string>;
}): NetworkCaptureEntry | null {
  const state = networkCaptures.get(tabId);
  if (!state) return null;
  const existingIndex = state.requestToIndex.get(requestId);
  if (existingIndex !== undefined) return state.entries[existingIndex] || null;
  const url = fallback?.url || '';
  if (!shouldCaptureUrl(url, state.patterns)) return null;
  const entry: NetworkCaptureEntry = {
    kind: 'cdp', url, method: fallback?.method || 'GET',
    requestHeaders: fallback?.requestHeaders || {}, timestamp: Date.now(),
  };
  state.entries.push(entry);
  state.requestToIndex.set(requestId, state.entries.length - 1);
  return entry;
}

export async function startNetworkCapture(tabId: number, pattern?: string): Promise<void> {
  if (!USE_DEBUGGER) throw new Error('Network capture is not supported on Firefox — requires CDP Network domain');
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  networkCaptures.set(tabId, {
    patterns: normalizeCapturePatterns(pattern), entries: [], requestToIndex: new Map(),
  });
}

export async function readNetworkCapture(tabId: number): Promise<NetworkCaptureEntry[]> {
  const state = networkCaptures.get(tabId);
  if (!state) return [];
  const entries = state.entries.slice();
  state.entries = [];
  state.requestToIndex.clear();
  return entries;
}

export function hasActiveNetworkCapture(tabId: number): boolean {
  return networkCaptures.has(tabId);
}

function clearFrameTargetsForTab(tabId: number): void {
  for (const [key, targetId] of [...frameTargets.entries()]) {
    if (!key.startsWith(`${tabId}:`)) continue;
    frameTargets.delete(key);
    frameTargetKeys.delete(targetId);
    if (USE_DEBUGGER) {
      chrome.debugger.detach({ targetId } as chrome.debugger.Debuggee).catch(() => {});
    }
  }
}

export async function detach(tabId: number): Promise<void> {
  clearFrameTargetsForTab(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  networkCaptures.delete(tabId);
  tabFrameContexts.delete(tabId);
  if (USE_DEBUGGER) {
    try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
  }
}

export function registerListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
    networkCaptures.delete(tabId);
    tabFrameContexts.delete(tabId);
    clearFrameTargetsForTab(tabId);
  });

  if (USE_DEBUGGER) {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) {
        attached.delete(source.tabId);
        networkCaptures.delete(source.tabId);
        tabFrameContexts.delete(source.tabId);
        clearFrameTargetsForTab(source.tabId);
        return;
      }
      if (source.targetId) clearFrameTarget(source.targetId);
    });

    chrome.tabs.onUpdated.addListener(async (tabId, info) => {
      if (info.url && !isDebuggableUrl(info.url)) {
        await detach(tabId);
      }
    });

    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      const tabId = source.tabId;
      if (!tabId) return;
      const state = networkCaptures.get(tabId);
      if (!state) return;
      const eventParams = params as Record<string, any> | undefined;

      if (method === 'Network.requestWillBeSent') {
        const requestId = String(eventParams?.requestId || '');
        const request = eventParams?.request as {
          url?: string; method?: string; headers?: Record<string, unknown>;
          postData?: string; hasPostData?: boolean;
        } | undefined;
        const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
          url: request?.url, method: request?.method, requestHeaders: normalizeHeaders(request?.headers),
        });
        if (!entry) return;
        entry.requestBodyKind = request?.hasPostData ? 'string' : 'empty';
        {
          const raw = String(request?.postData || '');
          const fullSize = raw.length;
          const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
          entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
          entry.requestBodyFullSize = fullSize;
          entry.requestBodyTruncated = truncated;
        }
        try {
          const postData = await chrome.debugger.sendCommand({ tabId }, 'Network.getRequestPostData', { requestId }) as { postData?: string };
          if (postData?.postData) {
            const raw = postData.postData;
            const fullSize = raw.length;
            const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
            entry.requestBodyKind = 'string';
            entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
            entry.requestBodyFullSize = fullSize;
            entry.requestBodyTruncated = truncated;
          }
        } catch { /* optional */ }
        return;
      }

      if (method === 'Network.responseReceived') {
        const requestId = String(eventParams?.requestId || '');
        const response = eventParams?.response as {
          url?: string; mimeType?: string; status?: number; headers?: Record<string, unknown>;
        } | undefined;
        const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, { url: response?.url });
        if (!entry) return;
        entry.responseStatus = response?.status;
        entry.responseContentType = response?.mimeType || '';
        entry.responseHeaders = normalizeHeaders(response?.headers);
        return;
      }

      if (method === 'Network.loadingFinished') {
        const requestId = String(eventParams?.requestId || '');
        const stateEntryIndex = state.requestToIndex.get(requestId);
        if (stateEntryIndex === undefined) return;
        const entry = state.entries[stateEntryIndex];
        if (!entry) return;
        try {
          const body = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }) as {
            body?: string; base64Encoded?: boolean;
          };
          if (typeof body?.body === 'string') {
            const fullSize = body.body.length;
            const truncated = fullSize > CDP_RESPONSE_BODY_CAPTURE_LIMIT;
            const stored = truncated ? body.body.slice(0, CDP_RESPONSE_BODY_CAPTURE_LIMIT) : body.body;
            entry.responsePreview = body.base64Encoded ? `base64:${stored}` : stored;
            entry.responseBodyFullSize = fullSize;
            entry.responseBodyTruncated = truncated;
          }
        } catch { /* optional */ }
      }
    });
  }
}
