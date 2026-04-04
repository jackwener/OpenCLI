import { ArgumentError } from '../../errors.js';
import type { IPage } from '../../types.js';

/**
 * Normalize an IMDb title or person input to a bare ID.
 * Accepts bare IDs, desktop URLs, mobile URLs, and URLs with language prefixes or query params.
 */
export function normalizeImdbId(input: string, prefix: 'tt' | 'nm'): string {
  const trimmed = input.trim();
  const barePattern = new RegExp(`^${prefix}\\d{7,8}$`);
  if (barePattern.test(trimmed)) {
    return trimmed;
  }

  const pathPattern = new RegExp(`/(?:[a-z]{2}/)?(?:title|name)/(${prefix}\\d{7,8})(?:[/?#]|$)`, 'i');
  const pathMatch = trimmed.match(pathPattern);
  if (pathMatch) {
    return pathMatch[1];
  }

  throw new ArgumentError(
    `Invalid IMDb ID: "${input}"`,
    `Expected ${prefix === 'tt' ? 'title' : 'name'} ID like ${prefix === 'tt' ? 'tt1375666' : 'nm0634240'} or an IMDb URL`,
  );
}

/**
 * Convert an ISO 8601 duration string to a short human-readable format for table display.
 * Example: PT2H28M -> 2h 28m.
 */
export function formatDuration(iso: string): string {
  if (!iso) {
    return '';
  }

  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) {
    return '';
  }

  const parts: string[] = [];
  if (match[1]) {
    parts.push(`${match[1]}h`);
  }
  if (match[2]) {
    parts.push(`${match[2]}m`);
  }
  return parts.join(' ');
}

/**
 * Force an IMDb page URL to use the English language parameter,
 * reducing structural differences across localized pages.
 */
export function forceEnglishUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('language', 'en-US');
  return parsed.toString();
}

/**
 * Normalize IMDb title-type payloads that may be represented as an object,
 * a raw string, or an empty text field with only an internal id.
 */
export function normalizeImdbTitleType(input: unknown): string {
  const raw = (() => {
    if (typeof input === 'string') return input;
    if (!input || typeof input !== 'object') return '';
    const value = input as Record<string, unknown>;
    return typeof value.text === 'string' && value.text.trim()
      ? value.text
      : typeof value.id === 'string'
        ? value.id
        : '';
  })().trim();

  if (!raw) return '';

  const known: Record<string, string> = {
    movie: 'Movie',
    short: 'Short',
    video: 'Video',
    tvEpisode: 'TV Episode',
    tvMiniSeries: 'TV Mini Series',
    tvMovie: 'TV Movie',
    tvSeries: 'TV Series',
    tvShort: 'TV Short',
    tvSpecial: 'TV Special',
    videoGame: 'Video Game',
  };

  return known[raw] ?? raw;
}

/**
 * Extract structured JSON-LD data from the page.
 * Accepts a single type string or an array of types to match against @type.
 */
export async function extractJsonLd(page: IPage, type?: string | string[]): Promise<Record<string, unknown> | null> {
  const filterTypes = type ? (Array.isArray(type) ? type : [type]) : [];
  return page.evaluate(`
    (function() {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      var wantedTypes = ${JSON.stringify(filterTypes)};

      function matchesType(data) {
        if (wantedTypes.length === 0) {
          return true;
        }
        if (!data || typeof data !== 'object') {
          return false;
        }
        if (wantedTypes.indexOf(data['@type']) !== -1) {
          return true;
        }
        if (Array.isArray(data['@type'])) {
          for (var t = 0; t < data['@type'].length; t++) {
            if (wantedTypes.indexOf(data['@type'][t]) !== -1) return true;
          }
        }
        return false;
      }

      function findMatch(data) {
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            var itemMatch = findMatch(data[i]);
            if (itemMatch) {
              return itemMatch;
            }
          }
          return null;
        }

        if (!data || typeof data !== 'object') {
          return null;
        }

        if (matchesType(data)) {
          return data;
        }

        if (Array.isArray(data['@graph'])) {
          return findMatch(data['@graph']);
        }

        return null;
      }

      for (var i = 0; i < scripts.length; i++) {
        try {
          var parsed = JSON.parse(scripts[i].textContent || 'null');
          var match = findMatch(parsed);
          if (match) {
            return match;
          }
        } catch (error) {
          void error;
        }
      }

      return null;
    })()
  `);
}

/**
 * Poll until the current IMDb page path matches the expected entity/search path.
 */
export async function waitForImdbPath(page: IPage, pathPattern: string, timeoutMs: number = 15000): Promise<boolean> {
  const result = await page.evaluate(`
    (async function() {
      var deadline = Date.now() + ${timeoutMs};
      var pattern = new RegExp(${JSON.stringify(pathPattern)}, 'i');
      while (Date.now() < deadline) {
        if (pattern.test(window.location.pathname)) {
          return true;
        }
        await new Promise(function(resolve) { setTimeout(resolve, 250); });
      }
      return pattern.test(window.location.pathname);
    })()
  `);
  return Boolean(result);
}

/**
 * Wait until IMDb search results (or the search UI state) has rendered.
 */
export async function waitForImdbSearchReady(page: IPage, timeoutMs: number = 15000): Promise<boolean> {
  const result = await page.evaluate(`
    (async function() {
      var deadline = Date.now() + ${timeoutMs};

      function hasSearchResults() {
        var nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
          try {
            var nextData = JSON.parse(nextDataEl.textContent || 'null');
            var pageProps = nextData && nextData.props && nextData.props.pageProps;
            var titleResults = (pageProps && pageProps.titleResults && pageProps.titleResults.results) || [];
            var nameResults = (pageProps && pageProps.nameResults && pageProps.nameResults.results) || [];
            if (titleResults.length > 0 || nameResults.length > 0) {
              return true;
            }
          } catch (error) {
            void error;
          }
        }

        if (document.querySelector('a[href*="/title/"], a[href*="/name/"]')) {
          return true;
        }

        var body = document.body ? (document.body.textContent || '') : '';
        return body.includes('No results found for') || body.includes('No exact matches');
      }

      while (Date.now() < deadline) {
        if (hasSearchResults()) {
          return true;
        }
        await new Promise(function(resolve) { setTimeout(resolve, 250); });
      }

      return hasSearchResults();
    })()
  `);
  return Boolean(result);
}

/**
 * Wait until IMDb review cards (or the page review summary) has rendered.
 */
export async function waitForImdbReviewsReady(page: IPage, timeoutMs: number = 15000): Promise<boolean> {
  const result = await page.evaluate(`
    (async function() {
      var deadline = Date.now() + ${timeoutMs};

      function hasReviewContent() {
        if (document.querySelector('article.user-review-item, [data-testid="review-card-parent"], [data-testid="tturv-total-reviews"]')) {
          return true;
        }
        var body = document.body ? (document.body.textContent || '') : '';
        return body.includes('No user reviews') || body.includes('Review this title');
      }

      while (Date.now() < deadline) {
        if (hasReviewContent()) {
          return true;
        }
        await new Promise(function(resolve) { setTimeout(resolve, 250); });
      }

      return hasReviewContent();
    })()
  `);
  return Boolean(result);
}

/**
 * Read the current IMDb entity id from the page URL/canonical metadata.
 */
export async function getCurrentImdbId(page: IPage, prefix: 'tt' | 'nm'): Promise<string> {
  const result = await page.evaluate(`
    (function() {
      var pattern = new RegExp('(${prefix}\\\\d{7,8})', 'i');
      var candidates = [
        window.location.pathname || '',
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
        document.querySelector('meta[property="og:url"]')?.getAttribute('content') || ''
      ];

      for (var i = 0; i < candidates.length; i++) {
        var match = candidates[i].match(pattern);
        if (match) {
          return match[1];
        }
      }
      return '';
    })()
  `);

  return typeof result === 'string' ? result : '';
}

/**
 * Detect whether the current page is an IMDb bot-challenge or verification page.
 */
export async function isChallengePage(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (function() {
      var title = document.title || '';
      var body = document.body ? (document.body.textContent || '') : '';
      return title.includes('Robot Check') ||
        title.includes('Are you a robot') ||
        title.includes('JavaScript is disabled') ||
        body.includes('captcha') ||
        body.includes('verify that you are human') ||
        body.includes('not a robot');
    })()
  `);

  return Boolean(result);
}
