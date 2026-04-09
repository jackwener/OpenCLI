import {
  type ProcurementSearchCandidateRaw,
  cleanText,
  normalizeDate,
} from './procurement-contract.js';

export type BidSearchCandidate = ProcurementSearchCandidateRaw;

export { cleanText, normalizeDate };

export function dedupeCandidates(items: BidSearchCandidate[]): BidSearchCandidate[] {
  const deduped: BidSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${cleanText(item.title)}\t${cleanText(item.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function withQuery(baseUrl: string, key: string, query: string): string | null {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(key, query);
    return url.toString();
  } catch {
    return null;
  }
}

export function buildSearchCandidates(
  query: string,
  baseEntries: string[],
  queryKeys: string[] = ['keyword', 'keywords', 'q', 'search', 'title'],
): string[] {
  const keyword = cleanText(query);
  const candidates: string[] = [];
  if (keyword) {
    for (const entry of baseEntries) {
      for (const key of queryKeys) {
        const withKeyword = withQuery(entry, key, keyword);
        if (withKeyword) candidates.push(withKeyword);
      }
    }
  }
  candidates.push(...baseEntries);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const value = cleanText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

export async function detectAuthPrompt(page: any): Promise<boolean> {
  const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
  return /(请先登录|未登录|登录后|验证码|人机验证|权限不足|无权限|请完善信息后访问)/.test(pageText);
}

export async function searchRowsFromEntries(
  page: any,
  {
    query,
    candidateUrls,
    allowedHostFragments,
    limit,
  }: {
    query: string;
    candidateUrls: string[];
    allowedHostFragments: string[];
    limit: number;
  },
): Promise<BidSearchCandidate[]> {
  const queryText = cleanText(query);
  const rows: BidSearchCandidate[] = [];

  for (const targetUrl of candidateUrls) {
    await page.goto(targetUrl);
    await page.wait(2);

    const payload = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const parseDate = (text) => {
          const normalized = clean(text);
          const match = normalized.match(/(20\\d{2})[.\\-/年](\\d{1,2})[.\\-/月](\\d{1,2})/);
          if (!match) return '';
          return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
        };
        const toAbsolute = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return new URL(href, window.location.origin).toString();
          return '';
        };

        const token = ${JSON.stringify(queryText)};
        const tokenParts = token.split(/\\s+/).filter(Boolean).map((part) => part.toLowerCase());
        const allowedHosts = ${JSON.stringify(allowedHostFragments.map((item) => item.toLowerCase()))};
        const procurementHints = ['招标', '采购', '公告', '项目', '中标', '成交', '询价', '竞价', '比选', '投标', 'notice', 'tender', 'procurement', 'bidding'];
        const rowSelectors = [
          'table tbody tr',
          'table tr',
          'ul li',
          'ol li',
          'article',
          'section',
          '.list li',
          '.notice li',
          '[class*="list"] li',
          '[class*="notice"] li',
          '[class*="item"]',
          '[class*="row"]',
        ];

        const rowNodes = [];
        const rowSeen = new Set();
        for (const selector of rowSelectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            const text = clean(node.innerText || node.textContent || '');
            if (!text || text.length < 8) continue;
            const lowerText = text.toLowerCase();
            const hasDate = /(20\\d{2})[.\\-/年](\\d{1,2})[.\\-/月](\\d{1,2})/.test(text);
            const hasHint = procurementHints.some((hint) => lowerText.includes(hint));
            const hasQuery = tokenParts.length === 0 || tokenParts.some((part) => lowerText.includes(part));
            if (!hasDate && !hasHint && !hasQuery) continue;
            if (rowSeen.has(node)) continue;
            rowSeen.add(node);
            rowNodes.push(node);
          }
        }

        const rows = [];
        const seen = new Set();
        for (const node of rowNodes) {
          const contextText = clean(node.innerText || node.textContent || '');
          const contextLower = contextText.toLowerCase();
          const hasHint = procurementHints.some((hint) => contextLower.includes(hint));
          const hasQuery = tokenParts.length === 0 || tokenParts.some((part) => contextLower.includes(part));
          if (!hasHint && !hasQuery) continue;

          const anchors = Array.from(node.querySelectorAll('a[href]'));
          for (const anchor of anchors) {
            const title = clean(anchor.textContent || '');
            if (!title || title.length < 4) continue;
            const url = toAbsolute(anchor.getAttribute('href') || anchor.href || '');
            if (!url) continue;
            const lowerUrl = url.toLowerCase();
            const hostMatched = allowedHosts.length === 0 || allowedHosts.some((item) => lowerUrl.includes(item));
            if (!hostMatched) continue;

            const key = title + '\\t' + url;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
              title,
              url,
              date: parseDate(contextText),
              contextText,
            });
          }
        }
        return rows;
      })()
    `);

    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const candidate: BidSearchCandidate = {
          title: cleanText(row.title),
          url: cleanText(row.url),
          date: normalizeDate(cleanText(row.date)),
          contextText: cleanText(row.contextText),
        };
        if (!candidate.title || !candidate.url) continue;
        rows.push(candidate);
      }
    }

    if (rows.length >= limit) break;
  }

  return dedupeCandidates(rows).slice(0, limit);
}
