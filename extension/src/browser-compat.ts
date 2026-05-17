/**
 * Browser compatibility layer for Chrome/Firefox unified codebase.
 *
 * Abstracts platform differences:
 * - Tab Groups API (Chrome-only)
 * - Extension origin prefix (chrome-extension:// vs moz-extension://)
 * - CDP protocol version
 */

declare const __OPENCLI_FIREFOX__: boolean | undefined;

/** Whether the current build targets Firefox. */
export const IS_FIREFOX: boolean = typeof __OPENCLI_FIREFOX__ !== 'undefined' && __OPENCLI_FIREFOX__ === true;

/** CDP protocol version — Chrome uses 1.3, Firefox accepts 1.0. */
export const CDP_VERSION: string = IS_FIREFOX ? '1.0' : '1.3';

/** Extension origin prefix for the current platform. */
export const EXTENSION_ORIGIN_PREFIX: string = IS_FIREFOX ? 'moz-extension://' : 'chrome-extension://';

/**
 * Check whether a given origin string belongs to a browser extension.
 * Accepts both chrome-extension:// and moz-extension:// for cross-platform daemon support.
 */
export function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
}

/**
 * Tab Groups compatibility wrapper.
 *
 * Firefox does not support chrome.tabGroups. All operations gracefully
 * degrade to no-ops or empty results so the rest of the codebase works
 * unchanged on both platforms.
 */
export const tabGroups = {
  async get(groupId: number): Promise<chrome.tabGroups.TabGroup | null> {
    if (typeof chrome.tabGroups === 'undefined') return null;
    try {
      return await chrome.tabGroups.get(groupId);
    } catch {
      return null;
    }
  },

  async query(info: chrome.tabGroups.QueryInfo): Promise<chrome.tabGroups.TabGroup[]> {
    if (typeof chrome.tabGroups === 'undefined') return [];
    try {
      return await chrome.tabGroups.query(info);
    } catch {
      return [];
    }
  },

  async update(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<void> {
    if (typeof chrome.tabGroups === 'undefined') return;
    try {
      await chrome.tabGroups.update(groupId, props);
    } catch { /* ignore */ }
  },

  async move(groupId: number, props: chrome.tabGroups.MoveProperties): Promise<void> {
    if (typeof chrome.tabGroups === 'undefined') return;
    try {
      await chrome.tabGroups.move(groupId, props);
    } catch { /* ignore */ }
  },
};

/**
 * Check if a CDP command is likely unsupported on Firefox.
 * Used for graceful degradation — callers can catch and provide fallback behavior.
 */
export function isUnsupportedOnFirefox(method: string): boolean {
  if (!IS_FIREFOX) return false;
  const unsupported = [
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
    'Target.setDiscoverTargets',
    'Target.setAutoAttach',
    'Target.getTargets',
    'Input.insertText',
    'DOM.setFileInputFiles',
    'DOM.enable',
    'DOM.getDocument',
    'DOM.querySelector',
  ];
  return unsupported.includes(method);
}
