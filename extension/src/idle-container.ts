// Every placeholder OpenCLI parks is its own idle page, so a restored placeholder
// is recognisable without trusting group titles, colors or numeric ids: no other
// origin can show it and it holds no user content. Only an idle, single-tab window
// is recoverable without claiming restored user content; its page carries a token
// that is rotated whenever a new placeholder is issued and consumed before reuse.
// A saved group containing an older marker is not ownership evidence.
const KEY = 'opencli_idle_interactive_v1';
const PAGE = 'idle.html';

/** The unmarked idle page: OpenCLI's, idle, and not recoverable after a restart. */
export function idlePageUrl(): string {
  return chrome.runtime.getURL(PAGE);
}

export function isIdlePage(url?: string): boolean {
  const page = idlePageUrl();
  return url === page || !!url?.startsWith(`${page}#`);
}

export async function idlePlaceholderUrl(): Promise<string | null> {
  const data = await chrome.storage.local.get(KEY);
  const token = data[KEY];
  return typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token)
    ? `${chrome.runtime.getURL(PAGE)}#${token}` : null;
}

export async function parkIdleInteractiveTab(tabId: number, windowId: number): Promise<string | null> {
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length !== 1 || tabs[0].id !== tabId) return null;
  const token = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY]: token });
  return `${chrome.runtime.getURL(PAGE)}#${token}`;
}

export async function consumeIdlePlaceholder(tab: chrome.tabs.Tab): Promise<void> {
  const url = await idlePlaceholderUrl();
  if (url && tab.url === url) {
    // A user may have begun navigating this tab since candidate discovery.
    if (tab.pendingUrl && tab.pendingUrl !== url) throw new Error('Idle OpenCLI tab is being navigated; retry the command.');
    await chrome.storage.local.remove(KEY);
  }
}

export async function findIdleInteractiveGroup(reservedTabs: Set<number>): Promise<chrome.tabGroups.TabGroup | null> {
  const url = await idlePlaceholderUrl();
  if (!url) return null;
  const tabs = (await chrome.tabs.query({})).filter(tab => tab.url === url && !tab.pendingUrl);
  // Duplicate restored markers are ambiguous. Never pick a window by numeric ID.
  if (tabs.length !== 1) return null;
  const tab = tabs[0];
  if (tab.id === undefined || reservedTabs.has(tab.id) || tab.incognito ||
      tab.groupId === undefined || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const window = await chrome.windows.get(tab.windowId);
  if (window.incognito || window.type !== 'normal') return null;
  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
  if (windowTabs.length !== 1 || windowTabs[0].id !== tab.id || windowTabs[0].url !== url || windowTabs[0].pendingUrl) return null;
  const group = await chrome.tabGroups.get(tab.groupId);
  return group.windowId === tab.windowId ? group : null;
}

/**
 * Close idle pages nothing will reuse: outside the live container windows, not
 * held by a lease and not the sole marked window a restart may adopt. A browser
 * restart or extension update clears the lease registry, so the placeholders it
 * restored would otherwise stay behind as windows of their own (#2202). Closing
 * an idle page never closes user content; a window left empty closes with it.
 */
export async function reclaimIdlePages(liveWindows: Set<number>, reservedTabs: Set<number>): Promise<number> {
  const recoverable = await findIdleInteractiveGroup(reservedTabs);
  const orphans = (await chrome.tabs.query({})).filter(tab =>
    tab.id !== undefined && !tab.incognito && isIdlePage(tab.url) &&
    (!tab.pendingUrl || isIdlePage(tab.pendingUrl)) &&
    !reservedTabs.has(tab.id) && !liveWindows.has(tab.windowId) &&
    tab.windowId !== recoverable?.windowId);
  let closed = 0;
  for (const tab of orphans) {
    // The tab may already be gone (closed by the user or another extension).
    if (await chrome.tabs.remove(tab.id!).then(() => true, () => false)) closed++;
  }
  return closed;
}
