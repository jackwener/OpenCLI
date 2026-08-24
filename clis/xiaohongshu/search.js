/**
 * Xiaohongshu search — DOM-based extraction from search results page.
 * The previous Pinia store + XHR interception approach broke because
 * the API now returns empty items. This version navigates directly to
 * the search results page and extracts data from rendered DOM elements.
 * Ref: https://github.com/jackwener/opencli/issues/10
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';
/**
 * Wait for search results or login wall using MutationObserver (max 5s).
 * Returns 'content' if note items appeared, a typed wall state when login or
 * risk controls appear, or 'timeout' if none appears within the deadline.
 *
 * Note-item detection tries the legacy `section.note-item` class first
 * (still observed in many sessions, including rednote) and falls back to
 * a `<section>` element containing a `/search_result/` or `/explore/`
 * link. Issue #1506 reports the class being dropped on some xhs renders.
 */
const WAIT_FOR_CONTENT_JS = `
  new Promise((resolve) => {
    const findNoteCard = () => document.querySelector(
      'section.note-item, section:has(a[href*="/search_result/"]), section:has(a[href*="/explore/"])'
    );
    const detect = () => {
      if (findNoteCard()) return 'content';
      const bodyText = document.body?.innerText || '';
      if (/登录后查看搜索结果/.test(bodyText) || document.querySelector('#login-btn')) return 'login_wall';
      if (/请求太频繁|访问频次异常|安全限制/.test(bodyText)) return 'security_block';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 5000);
  })
`;
const DEFAULT_HARVEST_STEP = 900;
const CONTENT_WAIT_SECONDS = 5;
const FILTER_SETTLE_SECONDS = 8;

const SEARCH_FILTERS = [
    {
        arg: 'sort', group: '排序依据', defaultValue: 'comprehensive',
        options: { comprehensive: '综合', latest: '最新', 'most-liked': '最多点赞', 'most-commented': '最多评论', 'most-collected': '最多收藏' },
    },
    {
        arg: 'note-type', group: '笔记类型', defaultValue: 'all',
        options: { all: '不限', video: '视频', image: '图文' },
    },
    {
        arg: 'publish-time', group: '发布时间', defaultValue: 'anytime',
        options: { anytime: '不限', day: '一天内', week: '一周内', 'half-year': '半年内' },
    },
    {
        arg: 'scope', group: '搜索范围', defaultValue: 'all',
        options: { all: '不限', seen: '已看过', unseen: '未看过', following: '已关注' },
    },
    {
        arg: 'location', group: '位置距离', defaultValue: 'all',
        options: { all: '不限', 'same-city': '同城', nearby: '附近' },
    },
];

function isCollapsedRender(diag) {
    return diag.cardCount > 1 &&
        diag.feedClientHeight === 0 &&
        diag.distinctCardTops === 1;
}

function harvestOptionsForLimit(limit) {
    return {
        maxRounds: 12 + Math.ceil((limit - 1) * 48 / 99),
        // Browser Bridge/CDP evaluates time out at 60s. Keep enough headroom
        // for serialization and transport even at --limit 100.
        budgetMs: 10_000 + Math.ceil((limit - 1) * 35_000 / 99),
        step: DEFAULT_HARVEST_STEP,
    };
}

export function noteUrlInfo(url, webHost = '') {
    if (typeof url !== 'string' || !url)
        return { key: '', signed: false };
    try {
        const parsed = new URL(url);
        const expectedHost = String(webHost || '').toLowerCase();
        if (parsed.protocol !== 'https:' || (expectedHost && parsed.hostname.toLowerCase() !== expectedHost)) {
            return { key: '', signed: false };
        }
        const match = parsed.pathname.match(/^\/(?:search_result|explore|note)\/([0-9a-f]{24})\/?$/i);
        return {
            key: match ? match[1].toLowerCase() : '',
            signed: Boolean(parsed.searchParams.get('xsec_token')?.trim()),
        };
    }
    catch {
        return { key: '', signed: false };
    }
}

export function noteKeyFromUrl(url, webHost = '') {
    return noteUrlInfo(url, webHost).key;
}

export function mergeHarvestedRow(acc, row, webHost = '') {
    const url = typeof row?.url === 'string' ? row.url : '';
    const info = noteUrlInfo(url, webHost);
    const key = info.key;
    if (!key)
        return false;
    const prev = acc.get(key);
    if (!prev) {
        acc.set(key, { ...row });
        return true;
    }
    let changed = false;
    for (const field of ['title', 'author', 'author_url']) {
        if (!prev[field] && row?.[field]) {
            prev[field] = row[field];
            changed = true;
        }
    }
    if ((!prev.likes || prev.likes === '0') && row?.likes && row.likes !== '0') {
        prev.likes = row.likes;
        changed = true;
    }
    if (info.signed && !noteUrlInfo(prev.url, webHost).signed) {
        prev.url = url;
        changed = true;
    }
    return changed;
}

/**
 * Counts rows that would survive the title filter applied after harvesting.
 * Masonry cards expose their link before their title, so a freshly discovered
 * card is not yet a usable result.
 */
export function usableRowCount(acc) {
    let count = 0;
    for (const row of acc.values()) {
        if (row?.title)
            count++;
    }
    return count;
}

export function shouldStopScrolling(state) {
    if (state.collected >= state.target)
        return { stop: true, reason: 'target' };
    if (state.elapsedMs >= state.budgetMs)
        return { stop: true, reason: 'budget' };
    if (state.round >= state.maxRounds)
        return { stop: true, reason: 'max-rounds' };
    if (state.idleRounds >= 3)
        return { stop: true, reason: state.atBottom ? 'exhausted' : 'wedged' };
    // No-new-row plateaus alone are not terminal. An idle round requires
    // both unchanged harvested data and unchanged scroll geometry, so a
    // slow height expansion or a still-moving viewport remains progress.
    return { stop: false, reason: '' };
}

/**
 * Extract approximate publish date from a Xiaohongshu note URL.
 * XHS note IDs follow MongoDB ObjectID format where the first 8 hex
 * characters encode a Unix timestamp (the moment the ID was generated,
 * which closely matches publish time but is not an official API field).
 * e.g. "697f6c74..." → 0x697f6c74 = 1769958516 → 2026-02-01
 */
export function noteIdToDate(url) {
    const match = url.match(/\/(?:search_result|explore|note)\/([0-9a-f]{24})(?=[?#/]|$)/i);
    if (!match)
        return '';
    const hex = match[1].substring(0, 8);
    const ts = parseInt(hex, 16);
    if (!ts || ts < 1_000_000_000 || ts > 4_000_000_000)
        return '';
    // Offset by UTC+8 (China Standard Time) so the date matches what XHS users see
    return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
export function stripXhsAuthorDateSuffix(value) {
    const text = (value || '').replace(/\s+/g, ' ').trim();
    const stripped = text.replace(/\s*(?:\d{1,2}天前|\d+小时前|\d+分钟前|\d+秒前|刚刚|昨天|前天|\d+周前|\d+个月前|\d{1,2}-\d{1,2}|\d{4}-\d{1,2}-\d{1,2})$/u, '').trim();
    return stripped || text;
}

function extractSearchRows(webHost) {
    const normalizeUrl = (href) => {
        if (!href)
            return '';
        try {
            const parsed = new URL(href, `https://${webHost}/`);
            if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== webHost.toLowerCase())
                return '';
            return parsed.href;
        }
        catch {
            return '';
        }
    };
    const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const isVisibleNote = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const results = [];
    const seen = new Set();
    // Note containers: legacy `section.note-item` first, fallback to any
    // `<section>` wrapping a search-result/explore link (#1506 reports the
    // class being dropped on some xhs renders).
    const collectNoteCards = () => {
        const classMatches = document.querySelectorAll('section.note-item');
        if (classMatches.length > 0)
            return classMatches;
        const sections = new Set();
        for (const a of document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')) {
            const section = a.closest('section');
            if (section)
                sections.add(section);
        }
        return sections;
    };
    for (const el of collectNoteCards()) {
        // Skip "related searches" sections
        if (el.classList?.contains('query-note-item'))
            continue;
        if (!isVisibleNote(el))
            continue;
        const titleEl = el.querySelector('.title, .note-title, a.title, .footer .title span');
        const nameEl = el.querySelector('a.author .name, .author-name, .nick-name, .name');
        const authorWrapEl = el.querySelector('a.author');
        let author = cleanText(nameEl?.textContent || '');
        if (!author && authorWrapEl) {
            const nameChild = authorWrapEl.querySelector('.name');
            author = nameChild ? cleanText(nameChild.textContent || '') : stripXhsAuthorDateSuffix(authorWrapEl.textContent || '');
        }
        const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
        // Prefer search_result link (preserves xsec_token) over generic /explore/ link
        const detailLinkEl = el.querySelector('a.cover.mask') ||
            el.querySelector('a[href*="/search_result/"]') ||
            el.querySelector('a[href*="/explore/"]') ||
            el.querySelector('a[href*="/note/"]');
        const authorLinkEl = el.querySelector('a.author, a[href*="/user/profile/"]');
        const url = normalizeUrl(detailLinkEl?.getAttribute('href') || '');
        if (!url)
            continue;
        const key = url;
        if (seen.has(key))
            continue;
        seen.add(key);
        // Fallback title: the new bare-section render keeps the note caption
        // inside the search_result anchor's first span, not in a class-named
        // .title element. Pull from there when the class-based pick is empty.
        let title = cleanText(titleEl?.textContent || '');
        if (!title) {
            const captionSpan = detailLinkEl?.querySelector('span');
            title = cleanText(captionSpan?.textContent || '');
        }
        results.push({
            title,
            author,
            likes: cleanText(likesEl?.textContent || '0'),
            url,
            author_url: normalizeUrl(authorLinkEl?.getAttribute('href') || ''),
        });
    }
    return results;
}

function isTrustedAuthorUrl(url, webHost) {
    if (url === '')
        return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' &&
            parsed.hostname.toLowerCase() === webHost.toLowerCase() &&
            /^\/user\/profile\/[^/]+\/?$/i.test(parsed.pathname);
    }
    catch {
        return false;
    }
}
function requireTrustedHarvestRow(row, index, webHost) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new CommandExecutionError(`Unexpected Xiaohongshu search harvest row ${index + 1} shape; expected an object.`);
    }
    for (const field of ['title', 'author', 'likes', 'url', 'author_url']) {
        if (typeof row[field] !== 'string') {
            throw new CommandExecutionError(`Unexpected Xiaohongshu search harvest row ${index + 1} shape; expected string ${field}.`);
        }
    }
    if (!noteUrlInfo(row.url, webHost).key) {
        throw new CommandExecutionError(`Unexpected Xiaohongshu search harvest row ${index + 1} URL; expected a trusted note URL.`);
    }
    if (!isTrustedAuthorUrl(row.author_url, webHost)) {
        throw new CommandExecutionError(`Unexpected Xiaohongshu search harvest row ${index + 1} author URL; expected a trusted profile URL.`);
    }
    return row;
}
function requireHarvestPayload(payload, webHost) {
    const result = unwrapEvaluateResult(payload);
    const diag = result?.diag;
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.rows) ||
        !diag || typeof diag !== 'object' || Array.isArray(diag) ||
        typeof diag.securityBlock !== 'boolean' || typeof diag.stopReason !== 'string' ||
        !Number.isFinite(diag.scrollHeight) || diag.scrollHeight < 0 ||
        !Number.isFinite(diag.clientHeight) || diag.clientHeight < 0 ||
        !Number.isSafeInteger(diag.cardCount) || diag.cardCount < 0 ||
        !(diag.feedClientHeight === null || (Number.isFinite(diag.feedClientHeight) && diag.feedClientHeight >= 0)) ||
        !Number.isSafeInteger(diag.distinctCardTops) || diag.distinctCardTops < 0) {
        throw new CommandExecutionError('Unexpected Xiaohongshu search harvest payload shape; expected rows plus typed diagnostics.');
    }
    result.rows = result.rows.map((row, index) => requireTrustedHarvestRow(row, index, webHost));
    return result;
}
export function parseLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between 1 and 100, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1 || parsed > 100) {
        throw new ArgumentError(`--limit must be between 1 and 100, got ${parsed}`);
    }
    return parsed;
}

function resolveSearchFilters(kwargs) {
    return SEARCH_FILTERS.map((definition) => {
        const value = kwargs[definition.arg] ?? definition.defaultValue;
        const option = typeof value === 'string' ? definition.options[value] : undefined;
        if (!option) {
            throw new ArgumentError(
                `--${definition.arg} must be one of: ${Object.keys(definition.options).join(', ')}, got ${JSON.stringify(value)}`,
            );
        }
        return {
            group: definition.group,
            option,
            capability: value === definition.defaultValue
                ? ''
                : definition.arg === 'location'
                    ? 'location'
                    : definition.arg === 'scope'
                        ? 'account'
                        : '',
        };
    });
}

function buildApplySearchFiltersJs(requestedFilters) {
    return `
      (async () => {
        const requestedFilters = ${JSON.stringify(requestedFilters)};
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const text = (element) => (element?.textContent || '').replace(/\\s+/g, '').trim();
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden';
        };
        const visibleMatches = (root, selector) =>
          Array.from(root.querySelectorAll(selector)).filter(visible);
        const authBlocked = () => /登录后查看搜索结果/.test(document.body?.innerText || '') ||
          visible(document.querySelector('#login-btn'));
        const locationBlocked = () => /请开启浏览器地理位置权限/.test(document.body?.innerText || '');
        const panels = () => visibleMatches(document, '.search-layout__top > .filter > .filter-panel');
        const triggers = () => visibleMatches(document, '.search-layout__top > .filter');

        const openPanel = async () => {
          let clicked = false;
          for (let attempt = 0; attempt < 16; attempt++) {
            if (authBlocked()) return { status: 'auth', detail: 'login_wall' };
            const currentPanels = panels();
            if (currentPanels.length === 1) return { status: 'ok', panel: currentPanels[0] };
            if (currentPanels.length > 1) return { status: 'layout', detail: 'ambiguous_filter_panel' };
            const currentTriggers = triggers();
            if (currentTriggers.length > 1) return { status: 'layout', detail: 'ambiguous_filter_trigger' };
            if (!clicked && currentTriggers.length === 1) {
              currentTriggers[0].click();
              clicked = true;
            }
            await sleep(100);
          }
          return { status: 'layout', detail: 'filter_panel_not_found' };
        };

        const findOption = (panel, request) => {
          const groups = visibleMatches(panel, '.filters').filter((group) => {
            const label = Array.from(group.children).find((child) => child.tagName === 'SPAN');
            return text(label) === request.group;
          });
          if (groups.length !== 1) {
            return { status: 'layout', detail: groups.length ? 'ambiguous_group' : 'group_not_found' };
          }
          const options = visibleMatches(groups[0], '.tag-container > .tags')
            .filter((option) => text(option) === request.option);
          if (options.length !== 1) {
            return { status: 'layout', detail: options.length ? 'ambiguous_option' : 'option_not_found' };
          }
          return { status: 'ok', option: options[0] };
        };
        const isActive = (option) => option.classList.contains('active');
        const ready = () => visibleMatches(document, 'section.note-item, section:has(a[href*="/search_result/"]), section:has(a[href*="/explore/"]), .search-empty-wrapper').length > 0;
        const busy = () => visibleMatches(
          document,
          '.search-layout__main [aria-busy="true"], .search-layout__main [class*="skeleton"], .search-layout__main [class*="loading"]',
        ).length > 0;
        const snapshot = () => {
          const rows = visibleMatches(document, 'section.note-item, section:has(a[href*="/search_result/"]), section:has(a[href*="/explore/"])')
            .map((row) => {
              const anchor = row.querySelector('a[href*="/search_result/"], a[href*="/explore/"]');
              return [anchor?.getAttribute('href') || '', text(row)];
            });
          const feed = document.querySelector('.feeds-container');
          return JSON.stringify([
            rows,
            visibleMatches(document, '.search-empty-wrapper').length,
            document.documentElement?.scrollHeight || 0,
            feed ? feed.clientHeight : null,
          ]);
        };

        for (const request of requestedFilters) {
          const opened = await openPanel();
          if (opened.status !== 'ok') return opened;
          let found = findOption(opened.panel, request);
          if (found.status !== 'ok') {
            if (request.capability === 'location') return { status: 'location', detail: found.detail };
            if (request.capability === 'account') return { status: 'capability', detail: found.detail };
            return found;
          }
          if (isActive(found.option)) {
            continue;
          }

          const clickedAt = Date.now();
          found.option.click();
          let becameActive = false;
          while (Date.now() - clickedAt < 2500) {
            if (authBlocked()) return { status: 'auth', detail: 'login_wall' };
            if (locationBlocked()) return { status: 'location', detail: 'geolocation_denied' };
            const currentPanels = panels();
            if (currentPanels.length === 1) {
              found = findOption(currentPanels[0], request);
              if (found.status === 'ok' && isActive(found.option)) {
                becameActive = true;
                break;
              }
            }
            await sleep(100);
          }
          if (!becameActive) {
            if (request.capability === 'location') return { status: 'location', detail: 'chip_not_active' };
            if (request.capability === 'account') return { status: 'capability', detail: 'chip_not_active' };
            return { status: 'inactive', detail: request.group + '/' + request.option };
          }

          let stableSamples = 0;
          let previousSnapshot = '';
          while (Date.now() - clickedAt < ${FILTER_SETTLE_SECONDS * 1000}) {
            const currentSnapshot = snapshot();
            if (Date.now() - clickedAt >= 1500 && ready() && !busy()) {
              stableSamples = currentSnapshot === previousSnapshot ? stableSamples + 1 : 1;
              previousSnapshot = currentSnapshot;
              if (stableSamples >= 3) break;
            }
            else {
              stableSamples = 0;
              previousSnapshot = '';
            }
            await sleep(200);
          }
          if (stableSamples < 3) {
            return { status: 'timeout', detail: request.group + '/' + request.option };
          }
          const finalPanels = panels();
          const finalFound = finalPanels.length === 1 ? findOption(finalPanels[0], request) : null;
          if (!finalFound || finalFound.status !== 'ok' || !isActive(finalFound.option)) {
            return { status: 'inactive', detail: request.group + '/' + request.option };
          }
        }
        return { status: 'ok' };
      })()
    `;
}

function requireFilterApplication(payload) {
    const result = unwrapEvaluateResult(payload);
    if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
        throw new CommandExecutionError('Unexpected Xiaohongshu search filter result shape.');
    }
    if (result.status === 'ok') {
        return;
    }
    const detail = typeof result.detail === 'string' ? result.detail : 'unknown';
    if (result.status === 'auth') {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu search filters require a logged-in browser session');
    }
    if (result.status === 'timeout') {
        throw new TimeoutError(`xiaohongshu search filter ${detail}`, FILTER_SETTLE_SECONDS);
    }
    if (result.status === 'location') {
        throw new CommandExecutionError(`Xiaohongshu location filter was not applied (${detail}); enable browser geolocation permission.`);
    }
    if (result.status === 'capability') {
        throw new CommandExecutionError(`Xiaohongshu account-scoped filter was unavailable (${detail}); verify login and account access.`);
    }
    if (result.status === 'inactive') {
        throw new CommandExecutionError(`Xiaohongshu search filter chip did not become active (${detail}).`);
    }
    throw new CommandExecutionError(`Xiaohongshu search filter layout did not match the expected visible panel (${detail}).`);
}
/**
 * Build a "scroll until enough or plateaued" IIFE used in place of a fixed
 * `autoScroll({ times: N })`. Xiaohongshu's search results page lazy-loads
 * ~5-7 notes per scroll, so the previous `times: 2` capped extraction at
 * ~13 items regardless of `--limit` (see #1471). This helper drives scrolls
 * dynamically:
 *
 *   - count visible `section.note-item` rows (excluding related-search
 *     `.query-note-item` rows)
 *   - if count >= targetCount → break (got enough)
 *   - if two consecutive scrolls add no new rows → break (DOM plateaued,
 *     no more lazy-load available)
 *   - hard cap at `maxScrolls` iterations (default 15) to bound runtime
 *
 * Exported so the rednote adapter (same DOM shape) can reuse it.
 */
export function buildScrollUntilJs(targetCount, maxScrolls = 15) {
    if (!Number.isSafeInteger(targetCount) || targetCount < 1) {
        throw new ArgumentError(`targetCount must be a positive integer, got ${JSON.stringify(targetCount)}`);
    }
    if (!Number.isSafeInteger(maxScrolls) || maxScrolls < 1) {
        throw new ArgumentError(`maxScrolls must be a positive integer, got ${JSON.stringify(maxScrolls)}`);
    }
    return `
      (async () => {
        const isVisibleNote = (el) => {
          if (el.classList.contains('query-note-item')) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        // Note containers: legacy \`section.note-item\` first, fallback to
        // any \`<section>\` that wraps a search-result/explore note link
        // (#1506 reports the class being dropped on some xhs renders).
        const collectNoteCards = () => {
          const classMatches = document.querySelectorAll('section.note-item');
          if (classMatches.length > 0) return classMatches;
          const sections = new Set();
          for (const a of document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')) {
            const section = a.closest('section');
            if (section) sections.add(section);
          }
          return sections;
        };
        const countItems = () => {
          let count = 0;
          for (const el of collectNoteCards()) {
            if (isVisibleNote(el)) count++;
          }
          return count;
        };

        let lastCount = countItems();
        let plateauRounds = 0;
        for (let i = 0; i < ${maxScrolls}; i++) {
          if (countItems() >= ${targetCount}) break;
          const lastHeight = document.body.scrollHeight;
          window.scrollTo(0, lastHeight);
          await new Promise((resolve) => {
            let to;
            const ob = new MutationObserver(() => {
              if (document.body.scrollHeight > lastHeight) {
                clearTimeout(to);
                ob.disconnect();
                setTimeout(resolve, 200);
              }
            });
            ob.observe(document.body, { childList: true, subtree: true });
            to = setTimeout(() => { ob.disconnect(); resolve(null); }, 2500);
          });
          const newCount = countItems();
          if (newCount === lastCount) {
            plateauRounds++;
            if (plateauRounds >= 2) break;
          } else {
            plateauRounds = 0;
            lastCount = newCount;
          }
        }
        return countItems();
      })()
    `;
}
/**
 * Build the search-result extraction IIFE. The web host is baked into the
 * `normalizeUrl` fallback so relative `/explore/...` hrefs resolve to a full
 * URL on the calling site. Exported so the rednote adapter can call it with
 * `www.rednote.com` without duplicating the selector logic.
 */
export function buildSearchExtractJs(webHost) {
    return `
      (() => {
        const stripXhsAuthorDateSuffix = ${stripXhsAuthorDateSuffix.toString()};
        const extractSearchRows = ${extractSearchRows.toString()};
        return extractSearchRows(${JSON.stringify(webHost)});
      })()
    `;
}

export function buildScrollHarvestJs(webHost, targetCount, options = {}) {
    const maxRounds = options.maxRounds ?? 30;
    const budgetMs = options.budgetMs ?? 30_000;
    const step = options.step ?? DEFAULT_HARVEST_STEP;
    if (!Number.isSafeInteger(targetCount) || targetCount < 1) {
        throw new ArgumentError(`targetCount must be a positive integer, got ${JSON.stringify(targetCount)}`);
    }
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
        throw new ArgumentError(`maxRounds must be a positive integer, got ${JSON.stringify(maxRounds)}`);
    }
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        throw new ArgumentError(`budgetMs must be a positive number, got ${JSON.stringify(budgetMs)}`);
    }
    if (!Number.isFinite(step) || step < 0) {
        throw new ArgumentError(`step must be a non-negative number, got ${JSON.stringify(step)}`);
    }
    return `
      (async () => {
        const targetCount = ${targetCount};
        const maxRounds = ${maxRounds};
        const budgetMs = ${budgetMs};
        const configuredStep = ${step};
        const webHost = ${JSON.stringify(webHost)};
        const noteUrlInfo = ${noteUrlInfo.toString()};
        const mergeHarvestedRow = ${mergeHarvestedRow.toString()};
        const stripXhsAuthorDateSuffix = ${stripXhsAuthorDateSuffix.toString()};
        const extractSearchRows = ${extractSearchRows.toString()};
        const usableRowCount = ${usableRowCount.toString()};
        const shouldStopScrolling = ${shouldStopScrolling.toString()};
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const rootScroller = document.scrollingElement || document.documentElement || document.body;
        const rootScrollHeight = () => Math.max(
          rootScroller?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0
        );
        const rootClientHeight = () => Math.max(
          window.innerHeight || 0,
          rootScroller?.clientHeight || 0,
          document.documentElement?.clientHeight || 0
        );
        const readScrollMetrics = () => {
          const rootTop = Math.max(
            window.scrollY || window.pageYOffset || 0,
            rootScroller?.scrollTop || 0,
            document.documentElement?.scrollTop || 0,
            document.body?.scrollTop || 0
          );
          return {
            rootTop,
            scrollTop: rootTop,
            scrollHeight: rootScrollHeight(),
            clientHeight: rootClientHeight(),
          };
        };
        const driveScroll = (metrics) => {
          // Never advance farther than one viewport. A larger step can skip a
          // complete virtualized frame before it is harvested.
          const viewport = metrics.clientHeight || configuredStep;
          const scrollStep = Math.max(1, Math.min(configuredStep, viewport));
          if (typeof window.scrollBy === 'function') {
            window.scrollBy(0, scrollStep);
          } else if (rootScroller) {
            rootScroller.scrollTop += scrollStep;
          }
        };
        const acc = new Map();
        const startedAt = Date.now();
        let previousMetrics = null;
        let idleRounds = 0;
        let cardCount = 0;
        let round = 0;
        let stopReason = '';
        let metrics = readScrollMetrics();
        let securityBlock = false;
        while (true) {
          round++;
          securityBlock = /请求太频繁|访问频次异常|安全限制/.test(document.body?.innerText || '');
          if (securityBlock) {
            stopReason = 'security-block';
            metrics = readScrollMetrics();
            break;
          }
          const currentRows = extractSearchRows(webHost);
          cardCount = currentRows.length;
          let dataChanged = false;
          for (const row of currentRows) {
            if (mergeHarvestedRow(acc, row, webHost)) dataChanged = true;
          }
          metrics = readScrollMetrics();
          const geometryChanged = previousMetrics === null ||
            metrics.scrollTop !== previousMetrics.scrollTop ||
            metrics.scrollHeight !== previousMetrics.scrollHeight ||
            metrics.clientHeight !== previousMetrics.clientHeight;
          const usable = usableRowCount(acc);
          if (previousMetrics !== null && !dataChanged && !geometryChanged) {
            idleRounds++;
          } else {
            idleRounds = 0;
          }
          const atBottom = metrics.scrollHeight <= metrics.clientHeight + 2 ||
            metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 8;
          const elapsedMs = Date.now() - startedAt;
          const decision = shouldStopScrolling({
            // Untitled cards are dropped after the loop, so counting them
            // toward the target would silently shrink the result set.
            collected: usable,
            target: targetCount,
            round,
            maxRounds,
            elapsedMs,
            budgetMs,
            atBottom,
            idleRounds,
          });
          if (decision.stop) {
            stopReason = decision.reason;
            break;
          }
          previousMetrics = metrics;
          driveScroll(metrics);
          // At the bottom, give lazy loading a full second before counting an
          // idle round. Mid-page frames need only a short render settle.
          await wait(atBottom ? 1000 : 500);
        }
        const elapsedMs = Date.now() - startedAt;
        const classMatches = document.querySelectorAll('section.note-item');
        let diagnosticCards = classMatches;
        if (classMatches.length === 0) {
          const sections = new Set();
          for (const anchor of document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"]')) {
            const section = anchor.closest('section');
            if (section) sections.add(section);
          }
          diagnosticCards = sections;
        }
        const distinctCardTops = new Set();
        for (const card of diagnosticCards) {
          if (card.classList?.contains('query-note-item')) continue;
          distinctCardTops.add(Math.round(card.getBoundingClientRect().top));
        }
        const feedContainer = document.querySelector('.feeds-container');
        return {
          rows: Array.from(acc.values()),
          collected: acc.size,
          diag: {
            usable: usableRowCount(acc),
            scrollTop: metrics.scrollTop,
            scrollHeight: metrics.scrollHeight,
            clientHeight: metrics.clientHeight,
            cardCount,
            feedClientHeight: feedContainer ? feedContainer.clientHeight : null,
            distinctCardTops: distinctCardTops.size,
            rounds: round,
            stopReason,
            elapsedMs,
            securityBlock,
          },
        };
      })()
    `;
}

async function collectSearchHarvest(page, limit, requestedFilters) {
    const waitResult = unwrapEvaluateResult(await page.evaluate(WAIT_FOR_CONTENT_JS));
    if (waitResult === 'login_wall') {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu search results are blocked behind a login wall');
    }
    if (waitResult === 'security_block') {
        throw new CliError('SECURITY_BLOCK', 'Xiaohongshu search was blocked by request-frequency or security controls.', 'Wait before retrying or use a different logged-in browser session.');
    }
    if (waitResult === 'timeout') {
        throw new TimeoutError('xiaohongshu search content', CONTENT_WAIT_SECONDS);
    }
    if (waitResult !== 'content') {
        throw new CommandExecutionError('Unexpected Xiaohongshu search wait payload shape.');
    }
    requireFilterApplication(await page.evaluate(buildApplySearchFiltersJs(requestedFilters)));
    const harvestOptions = harvestOptionsForLimit(limit);
    const harvest = requireHarvestPayload(await page.evaluate(buildScrollHarvestJs('www.xiaohongshu.com', limit, harvestOptions)), 'www.xiaohongshu.com');
    if (harvest.diag.securityBlock) {
        throw new CliError('SECURITY_BLOCK', 'Xiaohongshu search was blocked by request-frequency or security controls.', 'Wait before retrying or use a different logged-in browser session.');
    }
    return harvest;
}

async function replaceCollapsedTab(page, url) {
    if (typeof page.getActivePage !== 'function' || typeof page.newTab !== 'function' ||
        typeof page.setActivePage !== 'function' || typeof page.selectTab !== 'function' ||
        typeof page.closeTab !== 'function') {
        throw new CommandExecutionError(
            'Xiaohongshu search rendered in a collapsed tab, but this browser session cannot replace the failed target.',
            'Retry the command in a Browser Bridge session that supports tab replacement.',
        );
    }
    const previousPage = page.getActivePage();
    if (!previousPage) {
        throw new CommandExecutionError('Xiaohongshu search cannot identify the collapsed browser target for safe replacement.');
    }
    let freshPage;
    try {
        freshPage = await page.newTab(url);
        if (!freshPage) {
            throw new Error('newTab returned no page identity');
        }
        page.setActivePage(freshPage);
        await page.closeTab(previousPage);
    }
    catch (error) {
        const cleanupErrors = [];
        if (freshPage) {
            let restoredPrevious = false;
            try {
                await page.selectTab(previousPage);
                restoredPrevious = true;
            }
            catch (cleanupError) {
                cleanupErrors.push(cleanupError?.message ?? String(cleanupError));
            }
            if (restoredPrevious) {
                try {
                    await page.closeTab(freshPage);
                }
                catch (cleanupError) {
                    cleanupErrors.push(cleanupError?.message ?? String(cleanupError));
                }
            }
            else {
                // If the old target disappeared despite the original error,
                // keep the fresh preferred target bound for --keep-tab.
                page.setActivePage(freshPage);
            }
        }
        const cleanupContext = cleanupErrors.length > 0
            ? ` Cleanup also failed: ${cleanupErrors.join('; ')}.`
            : '';
        throw new CommandExecutionError(
            `Failed to replace collapsed Xiaohongshu search tab: ${error?.message ?? String(error)}.${cleanupContext}`,
        );
    }
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'search',
    access: 'read',
    description: '搜索小红书笔记',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
        { name: 'sort', type: 'string', default: 'comprehensive', choices: ['comprehensive', 'latest', 'most-liked', 'most-commented', 'most-collected'], help: 'Sort order' },
        { name: 'note-type', type: 'string', default: 'all', choices: ['all', 'video', 'image'], help: 'Note type' },
        { name: 'publish-time', type: 'string', default: 'anytime', choices: ['anytime', 'day', 'week', 'half-year'], help: 'Publish time range' },
        { name: 'scope', type: 'string', default: 'all', choices: ['all', 'seen', 'unseen', 'following'], help: 'Search scope' },
        { name: 'location', type: 'string', default: 'all', choices: ['all', 'same-city', 'nearby'], help: 'Location distance' },
    ],
    columns: ['rank', 'title', 'author', 'likes', 'published_at', 'url'],
    func: async (page, kwargs) => {
        try {
            const limit = parseLimit(kwargs.limit);
            const requestedFilters = resolveSearchFilters(kwargs);
            const keyword = encodeURIComponent(kwargs.query);
            const url = `https://www.xiaohongshu.com/search_result?keyword=${keyword}&source=web_search_result_notes`;
            await page.goto(url);
            let harvest = await collectSearchHarvest(page, limit, requestedFilters);
            if (isCollapsedRender(harvest.diag)) {
                await replaceCollapsedTab(page, url);
                harvest = await collectSearchHarvest(page, limit, requestedFilters);
                if (isCollapsedRender(harvest.diag)) {
                    throw new CommandExecutionError(
                        'Xiaohongshu search masonry remained collapsed after one fresh-tab recovery.',
                        'Retry later or use a different logged-in browser session.',
                    );
                }
            }
            const rows = harvest.rows
                .filter((item) => item.title)
                .slice(0, limit);
            if (rows.length === 0) {
                throw new EmptyResultError('xiaohongshu search', 'No usable notes were rendered for this query.');
            }
            return rows
                .map((item, i) => ({
                rank: i + 1,
                ...item,
                published_at: noteIdToDate(item.url),
            }));
        }
        catch (err) {
            if (err instanceof CliError)
                throw err;
            throw new CommandExecutionError(`Xiaohongshu search failed: ${err?.message ?? String(err)}`);
        }
    },
});
export const __test__ = {
    harvestOptionsForLimit,
    stripXhsAuthorDateSuffix,
};
