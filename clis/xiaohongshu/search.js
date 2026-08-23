/**
 * Xiaohongshu search — DOM-based extraction from search results page.
 * The previous Pinia store + XHR interception approach broke because
 * the API now returns empty items. This version navigates directly to
 * the search results page and extracts data from rendered DOM elements.
 * Ref: https://github.com/jackwener/opencli/issues/10
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
/**
 * Wait for search results or login wall using MutationObserver (max 5s).
 * Returns 'content' if note items appeared, 'login_wall' if login gate
 * detected, or 'timeout' if neither appeared within the deadline.
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
      if (/登录后查看搜索结果/.test(document.body?.innerText || '')) return 'login_wall';
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

function harvestOptionsForLimit(limit) {
    return {
        maxRounds: 12 + Math.ceil((limit - 1) * 48 / 99),
        budgetMs: 15_000 + Math.ceil((limit - 1) * 45_000 / 99),
        step: DEFAULT_HARVEST_STEP,
    };
}

export function noteKeyFromUrl(url) {
    if (typeof url !== 'string')
        return '';
    const match = url.match(/\/(?:search_result|explore|note)\/([0-9a-f]{24})(?=[?#/]|$)/i);
    return match ? match[1].toLowerCase() : '';
}

export function mergeHarvestedRow(acc, row) {
    const url = typeof row?.url === 'string' ? row.url : '';
    const key = noteKeyFromUrl(url) || url;
    if (!key)
        return acc;
    const prev = acc.get(key);
    if (!prev) {
        acc.set(key, { ...row });
        return acc;
    }
    for (const field of ['title', 'author', 'author_url']) {
        if (!prev[field] && row?.[field])
            prev[field] = row[field];
    }
    if ((!prev.likes || prev.likes === '0') && row?.likes && row.likes !== '0') {
        prev.likes = row.likes;
    }
    if (url.includes('xsec_token=') && !String(prev.url || '').includes('xsec_token=')) {
        prev.url = url;
    }
    return acc;
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
    if (state.atBottom && state.stalledRounds >= 3)
        return { stop: true, reason: 'exhausted' };
    if (!state.moved && state.stalledRounds >= 3)
        return { stop: true, reason: 'wedged' };
    // No-new-row plateaus alone are not terminal: XHS has stalled at
    // scrollTop=4500 / scrollHeight=6960 and then resumed loading.
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
        if (href.startsWith('http://') || href.startsWith('https://'))
            return href;
        if (href.startsWith('/'))
            return `https://${webHost}${href}`;
        return '';
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

/**
 * `page.evaluate` may return either the raw IIFE value or a
 * `{ session, data }` envelope depending on the browser-bridge version.
 * Adapter code that called `Array.isArray(payload)` directly on the
 * envelope silently received [] for every search. This helper normalizes
 * both shapes so callers can keep their Array.isArray checks unchanged.
 */
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
function requireHarvestPayload(payload) {
    const result = unwrapEvaluateResult(payload);
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.rows)) {
        throw new CommandExecutionError('Unexpected Xiaohongshu search harvest payload shape; expected an object with a rows array.');
    }
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
        const noteKeyFromUrl = ${noteKeyFromUrl.toString()};
        const mergeHarvestedRow = ${mergeHarvestedRow.toString()};
        const stripXhsAuthorDateSuffix = ${stripXhsAuthorDateSuffix.toString()};
        const extractSearchRows = ${extractSearchRows.toString()};
        const usableRowCount = ${usableRowCount.toString()};
        const shouldStopScrolling = ${shouldStopScrolling.toString()};
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const rootScroller = document.scrollingElement || document.documentElement || document.body;
        const isRootScroller = (el) =>
          !el || el === rootScroller || el === document.documentElement || el === document.body;
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
        const findScrollContainer = () => {
          let best = rootScroller;
          let bestRange = Math.max(0, rootScrollHeight() - rootClientHeight());
          const candidates = document.querySelectorAll(
            '.feeds-container, .search-container, .container, main, [class*="scroll"], [class*="feed"]'
          );
          for (const el of candidates) {
            if (isRootScroller(el)) continue;
            const style = getComputedStyle(el);
            if (!/(?:auto|scroll|overlay)/.test(style.overflowY || '')) continue;
            const range = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
            if (range > bestRange) {
              best = el;
              bestRange = range;
            }
          }
          return best;
        };
        const scrollContainer = findScrollContainer();
        const readScrollMetrics = () => {
          const rootTop = Math.max(
            window.scrollY || window.pageYOffset || 0,
            rootScroller?.scrollTop || 0,
            document.documentElement?.scrollTop || 0,
            document.body?.scrollTop || 0
          );
          if (!isRootScroller(scrollContainer)) {
            return {
              rootTop,
              containerTop: scrollContainer.scrollTop || 0,
              scrollTop: scrollContainer.scrollTop || 0,
              scrollHeight: scrollContainer.scrollHeight || 0,
              clientHeight: scrollContainer.clientHeight || 0,
            };
          }
          return {
            rootTop,
            containerTop: rootTop,
            scrollTop: rootTop,
            scrollHeight: rootScrollHeight(),
            clientHeight: rootClientHeight(),
          };
        };
        const scrollStep = Math.max(400, window.innerHeight || 0, configuredStep);
        const driveScroll = () => {
          if (typeof window.scrollBy === 'function') window.scrollBy(0, scrollStep);
          if (!isRootScroller(scrollContainer)) {
            scrollContainer.scrollTop += scrollStep;
          } else if (typeof window.scrollBy !== 'function' && rootScroller) {
            rootScroller.scrollTop += scrollStep;
          }
        };
        const acc = new Map();
        const startedAt = Date.now();
        let previousCollected = null;
        let previousUsable = null;
        let previousMetrics = null;
        let stalledRounds = 0;
        let cardCount = 0;
        let round = 0;
        let stopReason = '';
        let metrics = readScrollMetrics();
        let securityBlock = false;
        while (true) {
          round++;
          const currentRows = extractSearchRows(webHost);
          cardCount = currentRows.length;
          for (const row of currentRows) mergeHarvestedRow(acc, row);
          securityBlock = securityBlock ||
            /请求太频繁|访问频次异常|安全限制/.test(document.body?.innerText || '');
          metrics = readScrollMetrics();
          const moved = previousMetrics === null ||
            metrics.rootTop !== previousMetrics.rootTop ||
            metrics.containerTop !== previousMetrics.containerTop;
          const usable = usableRowCount(acc);
          // Backfilling a title on an already-known card is progress even when
          // no new card showed up, so both counters gate the stall detector.
          if (previousCollected !== null && acc.size === previousCollected && usable === previousUsable) {
            stalledRounds++;
          } else {
            stalledRounds = 0;
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
            stalledRounds,
            moved,
          });
          if (decision.stop) {
            stopReason = decision.reason;
            break;
          }
          previousCollected = acc.size;
          previousUsable = usable;
          previousMetrics = metrics;
          driveScroll();
          await wait(400 + Math.random() * 400);
        }
        const elapsedMs = Date.now() - startedAt;
        return {
          rows: Array.from(acc.values()),
          collected: acc.size,
          diag: {
            usable: usableRowCount(acc),
            scrollTop: metrics.scrollTop,
            scrollHeight: metrics.scrollHeight,
            clientHeight: metrics.clientHeight,
            cardCount,
            rounds: round,
            stopReason,
            elapsedMs,
            securityBlock,
          },
        };
      })()
    `;
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
    ],
    columns: ['rank', 'title', 'author', 'likes', 'published_at', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const keyword = encodeURIComponent(kwargs.query);
        await page.goto(`https://www.xiaohongshu.com/search_result?keyword=${keyword}&source=web_search_result_notes`);
        // Wait for search results to render (or login wall to appear).
        // Uses MutationObserver to resolve as soon as content appears,
        // instead of a fixed delay + blind retry.
        const waitResult = unwrapEvaluateResult(await page.evaluate(WAIT_FOR_CONTENT_JS));
        if (waitResult === 'login_wall') {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu search results are blocked behind a login wall');
        }
        const harvestOptions = harvestOptionsForLimit(limit);
        const harvest = requireHarvestPayload(await page.evaluate(buildScrollHarvestJs('www.xiaohongshu.com', limit, harvestOptions)));
        if (harvest.diag?.securityBlock) {
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu search was blocked by request-frequency or security controls.', 'Wait before retrying or use a different logged-in browser session.');
        }
        const data = harvest.rows;
        return data
            .filter((item) => item.title)
            .slice(0, limit)
            .map((item, i) => ({
            rank: i + 1,
            ...item,
            published_at: noteIdToDate(item.url),
        }));
    },
});
export const __test__ = {
    stripXhsAuthorDateSuffix,
};
