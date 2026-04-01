/**
 * CDP execution via chrome.debugger API.
 *
 * chrome.debugger only needs the "debugger" permission — no host_permissions.
 * It can attach to any http/https tab. Avoid chrome:// and chrome-extension://
 * tabs (resolveTabId in background.ts filters them).
 */

const attached = new Set<number>();

/** Internal blank page used when no user URL is provided. */
const BLANK_PAGE = 'data:text/html,<html></html>';
const FOREIGN_EXTENSION_URL_PREFIX = 'chrome-extension://';
const ATTACH_RECOVERY_DELAY_MS = 120;

export type AttachPolicy = {
  allowDomCleanup?: boolean;
};

/** Check if a URL can be attached via CDP — only allow http(s) and our internal blank page. */
function isDebuggableUrl(url?: string): boolean {
  if (!url) return true;  // empty/undefined = tab still loading, allow it
  return url.startsWith('http://') || url.startsWith('https://') || url === BLANK_PAGE;
}

type CleanupResult = { removed: number };

async function removeForeignExtensionEmbeds(tabId: number): Promise<CleanupResult> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    return { removed: 0 };
  }
  if (!chrome.scripting?.executeScript) return { removed: 0 };

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [`${FOREIGN_EXTENSION_URL_PREFIX}${chrome.runtime.id}/`],
      func: (ownExtensionPrefix: string) => {
        const extensionPrefix = 'chrome-extension://';
        const selectors = ['iframe', 'frame', 'embed', 'object'];
        const visitedRoots = new Set<Document | ShadowRoot>();
        const roots: Array<Document | ShadowRoot> = [document];
        let removed = 0;

        while (roots.length > 0) {
          const root = roots.pop();
          if (!root || visitedRoots.has(root)) continue;
          visitedRoots.add(root);

          for (const selector of selectors) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
              const src = node.getAttribute('src') || node.getAttribute('data') || '';
              if (!src.startsWith(extensionPrefix) || src.startsWith(ownExtensionPrefix)) continue;
              node.remove();
              removed++;
            }
          }

          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          let current = walker.nextNode();
          while (current) {
            const element = current as Element & { shadowRoot?: ShadowRoot | null };
            if (element.shadowRoot) roots.push(element.shadowRoot);
            current = walker.nextNode();
          }
        }

        return { removed };
      },
    });
    return result?.result ?? { removed: 0 };
  } catch {
    return { removed: 0 };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryAttach(tabId: number): Promise<void> {
  await chrome.debugger.attach({ tabId }, '1.3');
}

async function ensureAttached(tabId: number, policy: AttachPolicy = {}): Promise<void> {
  const allowDomCleanup = policy.allowDomCleanup !== false;

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

  try {
    await tryAttach(tabId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes('chrome-extension://')
      ? '. Tip: another Chrome extension may be interfering — try disabling other extensions'
      : '';
    if (msg.includes('chrome-extension://')) {
      if (!allowDomCleanup) {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
      const recoveryCleanup = await removeForeignExtensionEmbeds(tabId);
      if (recoveryCleanup.removed > 0) {
        console.warn(`[opencli] Removed ${recoveryCleanup.removed} foreign extension frame(s) after attach failure on tab ${tabId}`);
      }
      await delay(ATTACH_RECOVERY_DELAY_MS);
      try {
        await tryAttach(tabId);
      } catch {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
    } else if (msg.includes('Another debugger is already attached')) {
      try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
      try {
        await tryAttach(tabId);
      } catch {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
    } else {
      throw new Error(`attach failed: ${msg}${hint}`);
    }
  }
  attached.add(tabId);

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch {
    // Some pages may not need explicit enable
  }

  // Disable breakpoints so that `debugger;` statements in page code don't
  // pause execution.  Anti-bot scripts use `debugger;` traps to detect CDP —
  // they measure the time gap caused by the pause. Deactivating breakpoints
  // makes the engine skip `debugger;` entirely, neutralising the timing
  // side-channel without patching page JS.
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Debugger.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Debugger.setBreakpointsActive', { active: false });
  } catch {
    // Non-fatal: best-effort hardening
  }
}

export async function evaluate(tabId: number, expression: string, policy?: AttachPolicy): Promise<unknown> {
  await ensureAttached(tabId, policy);

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
}

export const evaluateAsync = evaluate;

/**
 * Capture a screenshot via CDP Page.captureScreenshot.
 * Returns base64-encoded image data.
 */
export async function screenshot(
  tabId: number,
  options: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } = {},
  policy?: AttachPolicy,
): Promise<string> {
  await ensureAttached(tabId, policy);

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
  policy?: AttachPolicy,
): Promise<void> {
  await ensureAttached(tabId, policy);

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

export async function detach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
}

export function registerListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) attached.delete(source.tabId);
  });
  // Invalidate attached cache when tab URL changes to non-debuggable
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.url && !isDebuggableUrl(info.url)) {
      await detach(tabId);
    }
  });
}
