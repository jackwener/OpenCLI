/**
 * PowerChina search — browser DOM extraction with multi-entry URL probing.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

interface PowerchinaCandidate {
  title: string;
  url: string;
  date: string;
}

const SEARCH_ENTRIES = [
  'https://bid.powerchina.cn/search',
  'https://bid.powerchina.cn/',
];

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function normalizeDate(raw: string): string {
  const normalized = cleanText(raw);
  const match = normalized.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) return '';
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildSearchCandidates(query: string): string[] {
  const keyword = query.trim();
  if (!keyword) return [...SEARCH_ENTRIES];
  const encoded = encodeURIComponent(keyword);
  return [
    `https://bid.powerchina.cn/search?keyword=${encoded}`,
    `https://bid.powerchina.cn/search?keywords=${encoded}`,
    `https://bid.powerchina.cn/search?q=${encoded}`,
    ...SEARCH_ENTRIES,
  ];
}

function dedupeCandidates(items: PowerchinaCandidate[]): PowerchinaCandidate[] {
  const deduped: PowerchinaCandidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.title}\t${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

cli({
  site: 'powerchina',
  name: 'search',
  description: '搜索中国电建阳光采购公告',
  domain: 'bid.powerchina.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword, e.g. "procurement"' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'title', 'date', 'url'],
  func: async (page, kwargs) => {
    const query = cleanText(kwargs.query);
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
    const entries = buildSearchCandidates(query);

    const rows: PowerchinaCandidate[] = [];
    for (const targetUrl of entries) {
      await page.goto(targetUrl);
      await page.wait(2);

      const payload = await page.evaluate(`
        (() => {
          const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
          const toAbsolute = (href) => {
            if (!href) return '';
            if (href.startsWith('http://') || href.startsWith('https://')) return href;
            if (href.startsWith('/')) return new URL(href, window.location.origin).toString();
            return '';
          };
          const parseDate = (text) => {
            const normalized = clean(text);
            const match = normalized.match(/(20\\d{2})[.\\-/年](\\d{1,2})[.\\-/月](\\d{1,2})/);
            if (!match) return '';
            return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
          };

          const sourceText = clean(document.body ? document.body.innerText : '');
          const token = ${JSON.stringify(query)};
          const tokenParts = token.split(/\\s+/).filter(Boolean);

          const rows = [];
          const seen = new Set();
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const anchor of anchors) {
            const title = clean(anchor.textContent || '');
            if (!title || title.length < 4) continue;
            const url = toAbsolute(anchor.getAttribute('href') || anchor.href || '');
            if (!url) continue;
            const haystack = (title + ' ' + sourceText).toLowerCase();
            const matched = tokenParts.length === 0
              || tokenParts.some((part) => haystack.includes(part.toLowerCase()));
            if (!matched) continue;
            const key = title + '\\t' + url;
            if (seen.has(key)) continue;
            seen.add(key);
            const parentText = clean((anchor.closest('tr, li, div, article') || anchor).innerText || '');
            rows.push({
              title,
              url,
              date: parseDate(parentText),
            });
          }
          return rows;
        })()
      `);

      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (!item || typeof item !== 'object') continue;
          const candidate = {
            title: cleanText((item as Record<string, unknown>).title),
            url: cleanText((item as Record<string, unknown>).url),
            date: normalizeDate(cleanText((item as Record<string, unknown>).date)),
          };
          if (!candidate.title || !candidate.url) continue;
          rows.push(candidate);
        }
      }

      if (rows.length >= limit) break;
    }

    if (rows.length === 0) {
      const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
      if (/(请先登录|未登录|登录后|验证码)/.test(pageText)) {
        throw new AuthRequiredError(
          'bid.powerchina.cn',
          'PowerChina search requires login or human verification',
        );
      }
    }

    return dedupeCandidates(rows)
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        title: item.title,
        date: item.date,
        url: item.url,
      }));
  },
});

export const __test__ = {
  normalizeDate,
  buildSearchCandidates,
  dedupeCandidates,
};
