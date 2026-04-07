/**
 * Jianyu search — browser DOM extraction from Jianyu bid search page.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

interface JianyuCandidate {
  title: string;
  url: string;
  date: string;
}

const SEARCH_ENTRY = 'https://www.jianyu360.cn/jylab/supsearch/index.html';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function buildSearchUrl(query: string): string {
  const url = new URL(SEARCH_ENTRY);
  url.searchParams.set('keywords', query.trim());
  url.searchParams.set('selectType', 'title');
  url.searchParams.set('searchGroup', '1');
  return url.toString();
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

function dedupeCandidates(items: JianyuCandidate[]): JianyuCandidate[] {
  const deduped: JianyuCandidate[] = [];
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
  site: 'jianyu',
  name: 'search',
  description: '搜索剑鱼标讯公告',
  domain: 'www.jianyu360.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword, e.g. "电梯"' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'title', 'date', 'url'],
  func: async (page, kwargs) => {
    const query = cleanText(kwargs.query);
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
    const searchUrl = buildSearchUrl(query);

    await page.goto(searchUrl);
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
          const month = String(match[2]).padStart(2, '0');
          const day = String(match[3]).padStart(2, '0');
          return match[1] + '-' + month + '-' + day;
        };
        const pickDateText = (node) => {
          let cursor = node;
          for (let i = 0; i < 4 && cursor; i++) {
            const text = clean(cursor.innerText || cursor.textContent || '');
            const date = parseDate(text);
            if (date) return date;
            cursor = cursor.parentElement;
          }
          return '';
        };

        const anchors = Array.from(
          document.querySelectorAll('a[href*="/nologin/content/"], a[href*="/content/"]'),
        );
        const rows = [];
        const seen = new Set();
        for (const anchor of anchors) {
          const url = toAbsolute(anchor.getAttribute('href') || anchor.href || '');
          const title = clean(anchor.textContent || '');
          if (!url || !title || title.length < 4) continue;
          const key = title + '\\t' + url;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            title,
            url,
            date: pickDateText(anchor),
          });
        }
        return rows;
      })()
    `);

    const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
    if (
      !Array.isArray(payload)
      && /(请先登录|登录后|未登录|验证码)/.test(pageText)
    ) {
      throw new AuthRequiredError(
        'www.jianyu360.cn',
        'Jianyu search results require login or human verification',
      );
    }

    const rows = Array.isArray(payload)
      ? payload
        .filter((item): item is JianyuCandidate => !!item && typeof item === 'object')
        .map((item) => ({
          title: cleanText(item.title),
          url: cleanText(item.url),
          date: normalizeDate(cleanText(item.date)),
        }))
        .filter((item) => item.title && item.url)
      : [];

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
  buildSearchUrl,
  normalizeDate,
  dedupeCandidates,
};

