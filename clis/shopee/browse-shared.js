const PRODUCT_PATH_RE = /(?:-i\.\d+\.\d+$|\/product\/\d+\/\d+$)/i;
const BLOCKED_PATH_RE = /^\/(?:user\/account(?:\/|$)|buyer\/login(?:\/|$)|cart(?:\/|$)|checkout(?:\/|$)|purchase(?:\/|$)|portal\/settings(?:\/|$)|notifications(?:\/|$))/i;

export const DEFAULT_INSPECT_LIMIT = 20;
export const DEFAULT_BROWSE_STEPS = 3;
export const DEFAULT_DURATION_MIN = 0;
export const DEFAULT_SEARCH_TERMS = ['shoes', 'shirt'];

const PAGE_TYPE_WEIGHTS = {
  search: { product: 6, similar: 3, shop: 2, search: 1, other: 1 },
  product: { similar: 5, shop: 4, product: 2, search: 1, other: 1 },
  shop: { product: 5, similar: 3, search: 2, shop: 1, other: 1 },
  browse: { product: 3, similar: 3, shop: 2, search: 2, other: 1 },
};

export function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function clampInt(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function normalizeDwellRange(minValue, maxValue, defaults = [800, 2200]) {
  const min = clampInt(minValue, defaults[0], 0, 120000);
  const max = clampInt(maxValue, defaults[1], 0, 120000);
  return min <= max ? [min, max] : [max, min];
}

export function isMockHost(hostname) {
  const host = normalizeText(hostname).toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host.endsWith('.test')
    || host.endsWith('.local');
}

export function normalizeShopeeBrowseUrl(value, { allowMock = false } = {}) {
  const raw = normalizeText(value);
  if (!raw) throw new Error('Shopee browse/inspect URL is required.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!/shopee\./i.test(url.hostname) && !(allowMock && isMockHost(url.hostname))) {
    throw new Error('Shopee browse/inspect URL must use a Shopee host. Pass --mock to allow localhost or .test hosts.');
  }
  return url.toString();
}

export function absolutizeCandidateHref(href, currentUrl) {
  const raw = normalizeText(href);
  if (!raw) return '';
  try {
    const url = new URL(raw, currentUrl);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function isPublicBrowsePath(pathname) {
  return !BLOCKED_PATH_RE.test(normalizeText(pathname));
}

export function readCandidateText(anchor) {
  if (!anchor || typeof anchor.getAttribute !== 'function') return '';
  const aria = normalizeText(anchor.getAttribute('aria-label') || '');
  if (aria) return aria;
  const title = normalizeText(anchor.getAttribute('title') || '');
  if (title) return title;
  const imgAlt = normalizeText(anchor.querySelector?.('img[alt]')?.getAttribute?.('alt') || '');
  if (imgAlt) return imgAlt;
  return normalizeText(anchor.textContent || '');
}

export function inferCandidateKind(anchor, href) {
  const role = normalizeText(anchor?.getAttribute?.('data-opencli-role') || '').toLowerCase();
  if (role === 'product' || role === 'similar' || role === 'shop' || role === 'search') return role;

  const hrefLower = normalizeText(href).toLowerCase();
  if (anchor?.closest?.('[data-opencli-section="similar"], [data-opencli-role="similar"], .similar-products, .recommend-products')) {
    return 'similar';
  }
  if (anchor?.closest?.('[data-opencli-section="shop"], [data-opencli-role="shop"], .shop-home, .shop-page')) {
    return 'shop';
  }
  if (PRODUCT_PATH_RE.test(hrefLower)) return 'product';
  if (hrefLower.includes('/shop/')) return 'shop';
  if (hrefLower.includes('/search')) return 'search';
  return 'other';
}

export function inferPageType(currentUrl, candidates, document) {
  let pathname = '';
  try {
    pathname = new URL(currentUrl).pathname.toLowerCase();
  } catch {
    pathname = '';
  }

  const pageTypeAttr = normalizeText(
    document?.body?.getAttribute?.('data-opencli-page-type')
    || document?.documentElement?.getAttribute?.('data-opencli-page-type')
    || '',
  ).toLowerCase();
  if (pageTypeAttr === 'search' || pageTypeAttr === 'product' || pageTypeAttr === 'shop') {
    return pageTypeAttr;
  }
  if (pathname.includes('/search')) return 'search';
  if (PRODUCT_PATH_RE.test(pathname)) return 'product';
  if (pathname.includes('/shop/')) return 'shop';

  const counts = candidates.reduce((acc, candidate) => {
    acc[candidate.kind] = (acc[candidate.kind] || 0) + 1;
    return acc;
  }, {});

  if ((counts.product || 0) >= 2) return 'search';
  if ((counts.similar || 0) >= 1 || (counts.shop || 0) >= 1) return 'product';
  if ((counts.product || 0) >= 1 && (counts.shop || 0) === 0) return 'shop';
  return 'browse';
}

export function readPageTitle(document) {
  const selectors = [
    'meta[property="og:title"]',
    'h1',
    '[data-opencli-role="page-title"]',
    'title',
  ];
  for (const selector of selectors) {
    const node = document?.querySelector?.(selector);
    const content = normalizeText(
      selector.startsWith('meta[')
        ? node?.getAttribute?.('content') || ''
        : node?.textContent || '',
    );
    if (content) return content;
  }
  return normalizeText(document?.title || '');
}

export function detectBrowsePageIssue(document) {
  const bodyText = normalizeText(document?.body?.textContent || '');
  const normalizedBodyText = bodyText.toLowerCase();
  const unavailableTitle = normalizeText(
    document?.querySelector?.('h1')?.textContent
    || document?.title
    || '',
  );
  const normalizedUnavailableTitle = unavailableTitle.toLowerCase();
  const isUnavailableLoginWall = (
    /not logged in yet/.test(normalizedBodyText)
    || /log in to continue/.test(normalizedBodyText)
  ) && /head back to the homepage/.test(normalizedBodyText);
  if (
    isUnavailableLoginWall
    || (
      /page unavailable/.test(normalizedUnavailableTitle)
      && (
        /not logged in yet/.test(normalizedBodyText)
        || /log in to continue/.test(normalizedBodyText)
        || /head back to the homepage/.test(normalizedBodyText)
      )
    )
  ) {
    return {
      code: 'unlogin',
      title: unavailableTitle || 'Page Unavailable',
      message: bodyText || 'Looks like you are not logged in yet. Log in to continue or head back to the homepage.',
      retryLabel: '',
    };
  }

  const blocker = document?.querySelector?.('#NEW_CAPTCHA');
  if (blocker) {
    const title = normalizeText(
      blocker.querySelector?.('.eDksNk')?.textContent
      || blocker.querySelector?.('h1')?.textContent
      || '',
    );
    const message = normalizeText(
      blocker.querySelector?.('.T8fvru')?.textContent
      || blocker.textContent
      || '',
    );
    const retryLabel = normalizeText(
      blocker.querySelector?.('button')?.textContent
      || '',
    );
    return {
      code: 'new_captcha',
      title: title || '读取时出现问题',
      message: message || '抱歉，我们在读取时出现一些问题，请再试一次。',
      retryLabel,
    };
  }

  return null;
}

export function extractBrowseCandidatesFromDocument(document, currentUrl, limit = DEFAULT_INSPECT_LIMIT) {
  const resolvedLimit = clampInt(limit, DEFAULT_INSPECT_LIMIT, 1, 100);
  const current = new URL(currentUrl);
  const seen = new Set();
  const candidates = [];

  for (const anchor of Array.from(document?.querySelectorAll?.('a[href]') || [])) {
    const href = absolutizeCandidateHref(anchor.getAttribute('href') || '', currentUrl);
    if (!href || seen.has(href)) continue;
    if (/\/(?:cart|checkout|buyer\/login|logout)(?:[/?#]|$)/i.test(href)) continue;

    let target;
    try {
      target = new URL(href);
    } catch {
      continue;
    }
    if (!isPublicBrowsePath(target.pathname)) continue;

    const kind = inferCandidateKind(anchor, href);
    if (kind === 'other' && target.host !== current.host) continue;

    const text = readCandidateText(anchor);
    seen.add(href);
    candidates.push({
      kind,
      href,
      text,
      same_host: target.host === current.host,
    });
    if (candidates.length >= resolvedLimit) break;
  }

  return candidates;
}

export function parseSearchTerms(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  const raw = normalizeText(value);
  if (!raw) return [...DEFAULT_SEARCH_TERMS];
  const terms = raw.split(',').map(normalizeText).filter(Boolean);
  return terms.length ? terms : [...DEFAULT_SEARCH_TERMS];
}

export function buildSeedSearchUrls(startUrl, searchTerms = DEFAULT_SEARCH_TERMS) {
  const base = new URL(startUrl);
  return parseSearchTerms(searchTerms).map((term) => {
    const url = new URL('/search', base.origin);
    url.searchParams.set('keyword', term);
    return {
      kind: 'search',
      href: url.toString(),
      text: term,
      same_host: true,
    };
  });
}

export function createBrowseInspectPayload(document, currentUrl, limit = DEFAULT_INSPECT_LIMIT) {
  const issue = detectBrowsePageIssue(document);
  const candidates = extractBrowseCandidatesFromDocument(document, currentUrl, limit);
  return {
    url: currentUrl,
    title: readPageTitle(document),
    pageType: inferPageType(currentUrl, candidates, document),
    candidateCount: candidates.length,
    issue,
    mockSite: document?.body?.getAttribute?.('data-opencli-mock') === 'true'
      || document?.documentElement?.getAttribute?.('data-opencli-mock') === 'true',
    candidates,
  };
}

export function normalizeBrowseInspectPayload(payload, fallbackUrl, limit = DEFAULT_INSPECT_LIMIT) {
  const resolvedLimit = clampInt(limit, DEFAULT_INSPECT_LIMIT, 1, 100);
  const raw = payload && typeof payload === 'object' ? payload : {};
  const url = normalizeText(raw.url) || fallbackUrl;
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates
      .map((candidate) => ({
        kind: normalizeText(candidate?.kind).toLowerCase() || 'other',
        href: absolutizeCandidateHref(candidate?.href || '', url),
        text: normalizeText(candidate?.text),
        same_host: candidate?.same_host !== false,
      }))
      .filter((candidate) => candidate.href)
      .slice(0, resolvedLimit)
    : [];

  const pageType = normalizeText(raw.pageType).toLowerCase();
  const normalizedPageType = pageType === 'search' || pageType === 'product' || pageType === 'shop'
    ? pageType
    : inferPageType(url, candidates, null);

  return {
    url,
    title: normalizeText(raw.title),
    pageType: normalizedPageType,
    candidateCount: candidates.length,
    issue: raw.issue && typeof raw.issue === 'object'
      ? {
        code: normalizeText(raw.issue.code).toLowerCase() || 'page_issue',
        title: normalizeText(raw.issue.title),
        message: normalizeText(raw.issue.message),
        retryLabel: normalizeText(raw.issue.retryLabel),
      }
      : null,
    mockSite: raw.mockSite === true,
    candidates,
  };
}

export function pickBrowseCandidate(payload, visitedUrls = new Set(), randomFn = Math.random) {
  const visited = visitedUrls instanceof Set ? visitedUrls : new Set(visitedUrls || []);
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const available = candidates.filter((candidate) => (
    candidate
    && candidate.href
    && candidate.same_host !== false
    && !visited.has(candidate.href)
  ));
  if (!available.length) return null;

  const weights = PAGE_TYPE_WEIGHTS[payload?.pageType] || PAGE_TYPE_WEIGHTS.browse;
  const total = available.reduce((sum, candidate) => sum + (weights[candidate.kind] || 1), 0);
  let cursor = Math.max(0, Number(randomFn?.() ?? Math.random())) * total;

  for (const candidate of available) {
    cursor -= weights[candidate.kind] || 1;
    if (cursor <= 0) return candidate;
  }

  return available[available.length - 1];
}

export function buildBrowseInspectScript(limit = DEFAULT_INSPECT_LIMIT) {
  const resolvedLimit = clampInt(limit, DEFAULT_INSPECT_LIMIT, 1, 100);
  return `
    (() => {
      const DEFAULT_INSPECT_LIMIT = ${DEFAULT_INSPECT_LIMIT};
      const PRODUCT_PATH_RE = ${PRODUCT_PATH_RE};
      const BLOCKED_PATH_RE = ${BLOCKED_PATH_RE};
      const clampInt = ${clampInt.toString()};
      const isPublicBrowsePath = ${isPublicBrowsePath.toString()};
      const normalizeText = ${normalizeText.toString()};
      const absolutizeCandidateHref = ${absolutizeCandidateHref.toString()};
      const detectBrowsePageIssue = ${detectBrowsePageIssue.toString()};
      const readCandidateText = ${readCandidateText.toString()};
      const inferCandidateKind = ${inferCandidateKind.toString()};
      const inferPageType = ${inferPageType.toString()};
      const readPageTitle = ${readPageTitle.toString()};
      const extractBrowseCandidatesFromDocument = ${extractBrowseCandidatesFromDocument.toString()};
      const createBrowseInspectPayload = ${createBrowseInspectPayload.toString()};
      return createBrowseInspectPayload(document, window.location.href, ${resolvedLimit});
    })()
  `;
}

export const __test__ = {
  BLOCKED_PATH_RE,
  DEFAULT_BROWSE_STEPS,
  DEFAULT_DURATION_MIN,
  DEFAULT_INSPECT_LIMIT,
  DEFAULT_SEARCH_TERMS,
  PAGE_TYPE_WEIGHTS,
  absolutizeCandidateHref,
  buildBrowseInspectScript,
  buildSeedSearchUrls,
  clampInt,
  createBrowseInspectPayload,
  detectBrowsePageIssue,
  extractBrowseCandidatesFromDocument,
  inferCandidateKind,
  inferPageType,
  isMockHost,
  isPublicBrowsePath,
  normalizeBrowseInspectPayload,
  normalizeDwellRange,
  normalizeShopeeBrowseUrl,
  normalizeText,
  parseSearchTerms,
  pickBrowseCandidate,
  readCandidateText,
  readPageTitle,
};
