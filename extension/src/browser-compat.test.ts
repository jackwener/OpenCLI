import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('browser-compat', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isExtensionOrigin', () => {
    it('accepts chrome-extension:// origins', async () => {
      const { isExtensionOrigin } = await import('./browser-compat');
      expect(isExtensionOrigin('chrome-extension://abc123')).toBe(true);
    });

    it('accepts moz-extension:// origins', async () => {
      const { isExtensionOrigin } = await import('./browser-compat');
      expect(isExtensionOrigin('moz-extension://abc123')).toBe(true);
    });

    it('rejects web origins', async () => {
      const { isExtensionOrigin } = await import('./browser-compat');
      expect(isExtensionOrigin('https://example.com')).toBe(false);
    });
  });

  describe('IS_FIREFOX', () => {
    it('is false by default (Chrome build)', async () => {
      const { IS_FIREFOX } = await import('./browser-compat');
      expect(IS_FIREFOX).toBe(false);
    });

    it('is true when __OPENCLI_FIREFOX__ is set', async () => {
      vi.stubGlobal('__OPENCLI_FIREFOX__', true);
      const { IS_FIREFOX } = await import('./browser-compat');
      expect(IS_FIREFOX).toBe(true);
    });
  });

  describe('CDP_VERSION', () => {
    it('returns 1.3 for Chrome', async () => {
      const { CDP_VERSION } = await import('./browser-compat');
      expect(CDP_VERSION).toBe('1.3');
    });

    it('returns 1.0 for Firefox', async () => {
      vi.stubGlobal('__OPENCLI_FIREFOX__', true);
      const { CDP_VERSION } = await import('./browser-compat');
      expect(CDP_VERSION).toBe('1.0');
    });
  });

  describe('tabGroups', () => {
    it('returns empty array from query when tabGroups is unavailable', async () => {
      // No chrome.tabGroups defined
      vi.stubGlobal('chrome', { tabs: {}, debugger: {} });
      const { tabGroups } = await import('./browser-compat');
      const result = await tabGroups.query({ windowId: 1 });
      expect(result).toEqual([]);
    });

    it('returns null from get when tabGroups is unavailable', async () => {
      vi.stubGlobal('chrome', { tabs: {}, debugger: {} });
      const { tabGroups } = await import('./browser-compat');
      const result = await tabGroups.get(1);
      expect(result).toBeNull();
    });

    it('delegates to chrome.tabGroups when available', async () => {
      const mockGroup = { id: 1, windowId: 1, title: 'test', color: 'orange' };
      vi.stubGlobal('chrome', {
        tabGroups: {
          query: vi.fn(async () => [mockGroup]),
          get: vi.fn(async () => mockGroup),
          update: vi.fn(async () => {}),
        },
      });
      const { tabGroups } = await import('./browser-compat');

      const queried = await tabGroups.query({ windowId: 1 });
      expect(queried).toEqual([mockGroup]);

      const got = await tabGroups.get(1);
      expect(got).toEqual(mockGroup);
    });
  });

  describe('isUnsupportedOnFirefox', () => {
    it('returns false for all commands on Chrome', async () => {
      const { isUnsupportedOnFirefox } = await import('./browser-compat');
      expect(isUnsupportedOnFirefox('Emulation.setDeviceMetricsOverride')).toBe(false);
      expect(isUnsupportedOnFirefox('Runtime.evaluate')).toBe(false);
    });

    it('returns true for unsupported commands on Firefox', async () => {
      vi.stubGlobal('__OPENCLI_FIREFOX__', true);
      const { isUnsupportedOnFirefox } = await import('./browser-compat');
      expect(isUnsupportedOnFirefox('Emulation.setDeviceMetricsOverride')).toBe(true);
      expect(isUnsupportedOnFirefox('Target.setDiscoverTargets')).toBe(true);
      expect(isUnsupportedOnFirefox('Input.insertText')).toBe(true);
      expect(isUnsupportedOnFirefox('DOM.setFileInputFiles')).toBe(true);
    });

    it('returns false for supported commands on Firefox', async () => {
      vi.stubGlobal('__OPENCLI_FIREFOX__', true);
      const { isUnsupportedOnFirefox } = await import('./browser-compat');
      expect(isUnsupportedOnFirefox('Runtime.evaluate')).toBe(false);
      expect(isUnsupportedOnFirefox('Page.captureScreenshot')).toBe(false);
    });
  });
});
