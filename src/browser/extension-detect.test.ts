import { describe, expect, it } from 'vitest';

import {
  MAYBE_BROWSER_SCRAPER_ID,
  isExpectedBrowserScraperId,
  isExpectedExtensionOrigin,
  parseExtensionIdFromOrigin,
} from './extension-detect.js';

describe('extension-detect', () => {
  it('extracts the extension id from a chrome-extension origin', () => {
    expect(parseExtensionIdFromOrigin(`chrome-extension://${MAYBE_BROWSER_SCRAPER_ID}`)).toBe(
      MAYBE_BROWSER_SCRAPER_ID,
    );
  });

  it('returns null for non-extension origins', () => {
    expect(parseExtensionIdFromOrigin('https://example.com')).toBeNull();
    expect(parseExtensionIdFromOrigin(undefined)).toBeNull();
  });

  it('matches only the expected browser scraper id', () => {
    expect(isExpectedBrowserScraperId(MAYBE_BROWSER_SCRAPER_ID)).toBe(true);
    expect(isExpectedBrowserScraperId('abcdefghijklmnopabcdefghijklmnop')).toBe(false);
  });

  it('matches only the expected extension origin', () => {
    expect(isExpectedExtensionOrigin(`chrome-extension://${MAYBE_BROWSER_SCRAPER_ID}`)).toBe(true);
    expect(isExpectedExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(false);
  });
});
