export const MAYBE_BROWSER_SCRAPER_ID = 'gjfgacldoekdalepfgdonkjfngmliogc';

export function parseExtensionIdFromOrigin(origin: string | null | undefined): string | null {
  const value = typeof origin === 'string' ? origin.trim() : '';
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'chrome-extension:') return null;
    const extensionId = parsed.hostname.trim();
    return extensionId || null;
  } catch {
    return null;
  }
}

export function isExpectedBrowserScraperId(extensionId: string | null | undefined): boolean {
  return typeof extensionId === 'string'
    && extensionId.trim() === MAYBE_BROWSER_SCRAPER_ID;
}

export function isExpectedExtensionOrigin(origin: string | null | undefined): boolean {
  return isExpectedBrowserScraperId(parseExtensionIdFromOrigin(origin));
}
