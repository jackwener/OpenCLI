/**
 * Page identity mapping — targetId ↔ tabId.
 *
 * targetId is the cross-layer page identity (CDP target UUID).
 * tabId is an internal Chrome Tabs API routing detail — never exposed outside the extension.
 *
 * Lifecycle:
 *   - Cache populated lazily via chrome.debugger.getTargets()
 *   - Evicted on tab close (chrome.tabs.onRemoved)
 *   - Miss triggers full refresh; refresh miss → hard error (no guessing)
 *
 * Firefox note: chrome.debugger.getTargets() may not include tabId.
 * In that case we fall back to matching tabs by URL via chrome.tabs.query().
 */

import { IS_FIREFOX } from './browser-compat';

const targetToTab = new Map<string, number>();
const tabToTarget = new Map<number, string>();

/**
 * Resolve targetId for a given tabId.
 * Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
 * Throws if no targetId can be found (page may have been destroyed).
 */
export async function resolveTargetId(tabId: number): Promise<string> {
  const cached = tabToTarget.get(tabId);
  if (cached) return cached;

  await refreshMappings();

  const result = tabToTarget.get(tabId);
  if (!result) throw new Error(`No targetId for tab ${tabId} — page may have been closed`);
  return result;
}

/**
 * Resolve tabId for a given targetId.
 * Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
 * Throws if no tabId can be found — never falls back to guessing.
 */
export async function resolveTabId(targetId: string): Promise<number> {
  const cached = targetToTab.get(targetId);
  if (cached !== undefined) return cached;

  await refreshMappings();

  const result = targetToTab.get(targetId);
  if (result === undefined) throw new Error(`Page not found: ${targetId} — stale page identity`);
  return result;
}

/**
 * Remove mappings for a closed tab.
 * Called from chrome.tabs.onRemoved listener.
 */
export function evictTab(tabId: number): void {
  const targetId = tabToTarget.get(tabId);
  if (targetId) targetToTab.delete(targetId);
  tabToTarget.delete(tabId);
}

/**
 * Full refresh of targetId ↔ tabId mappings from chrome.debugger.getTargets().
 *
 * Firefox fallback: if getTargets() does not return tabId, we attempt to
 * match targets to tabs by URL. This is less precise but works for the
 * common case where each tab has a unique URL.
 */
async function refreshMappings(): Promise<void> {
  targetToTab.clear();
  tabToTarget.clear();

  // Firefox: chrome.debugger is not available — match by URL
  if (IS_FIREFOX || typeof chrome.debugger === 'undefined') {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.id !== undefined) {
        // Use tab ID as both key and value since we don't have CDP target IDs
        targetToTab.set(String(tab.id), tab.id);
        tabToTarget.set(tab.id, String(tab.id));
      }
    }
    return;
  }

  // Chrome: use chrome.debugger.getTargets()
  const targets = await chrome.debugger.getTargets();
  const pageTargets = targets.filter((t) => t.type === 'page');
  const hasTabIds = pageTargets.some((t) => t.tabId !== undefined);

  if (hasTabIds) {
    // Chrome path: targets include tabId directly
    for (const t of pageTargets) {
      if (t.tabId !== undefined) {
        targetToTab.set(t.id, t.tabId);
        tabToTarget.set(t.tabId, t.id);
      }
    }
    return;
  }

  // Fallback: match by URL
  if (IS_FIREFOX) {
    const tabs = await chrome.tabs.query({});
    const urlToTabId = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.url && tab.id !== undefined) {
        urlToTabId.set(tab.url, tab.id);
      }
    }
    for (const t of pageTargets) {
      const url = (t as any).url as string | undefined;
      if (url) {
        const tabId = urlToTabId.get(url);
        if (tabId !== undefined) {
          targetToTab.set(t.id, tabId);
          tabToTarget.set(tabId, t.id);
        }
      }
    }
  }
}
