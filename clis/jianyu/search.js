/**
 * Jianyu search — browser DOM extraction from Jianyu bid search page.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { buildSearchCandidates, cleanText, dedupeCandidates, detectAuthPrompt, normalizeDate, searchRowsFromEntries, } from './shared/china-bid-search.js';
import { toProcurementSearchRecords } from './shared/procurement-contract.js';
const SITE = 'jianyu';
const DOMAIN = 'www.jianyu360.cn';
const SEARCH_ENTRY = 'https://www.jianyu360.cn/jylab/supsearch/index.html';
const SEARCH_ENTRIES = [
    SEARCH_ENTRY,
    'https://www.jianyu360.cn/list/stype/ZBGG.html',
    'https://www.jianyu360.cn/',
];
const SEARCH_INDEX_PROXY = 'https://r.jina.ai/http://duckduckgo.com/html/?q=';
const PROCUREMENT_TITLE_HINT = /(公告|招标|采购|中标|成交|项目|投标|结果|notice|tender|procurement|bidding)/i;
const AUTH_REQUIRED_HINT = /(请在下图依次点击|登录即可获得更多浏览权限|验证登录|请完成验证|图形验证码)/;
const NAVIGATION_PATH_PREFIXES = [
    '/product/',
    '/front/',
    '/helpcenter/',
    '/brand/',
    '/page_workdesktop/',
    '/list/',
    '/list/stype/',
    '/list/rmxm',
    '/big/page/',
    '/jylab/',
    '/tags/',
    '/sitemap',
    '/datasmt/',
    '/bank/',
    '/hj/',
    '/exhibition/',
    '/swordfish/page_big_pc/search/',
];
const BLOCKED_DETAIL_PATH_PREFIXES = [
    '/nologin/content/',
    '/article/bdprivate/',
];
const JIANYU_API_TYPES = ['fType', 'eType', 'vType', 'mType'];
export function buildSearchUrl(query) {
    const url = new URL(SEARCH_ENTRY);
    url.searchParams.set('keywords', query.trim());
    url.searchParams.set('selectType', 'title');
    url.searchParams.set('searchGroup', '1');
    return url.toString();
}
function siteSearchCandidates(query) {
    const preferred = buildSearchUrl(query);
    const fallbacks = buildSearchCandidates(query, SEARCH_ENTRIES, ['keywords', 'keyword', 'q', 'search', 'title']);
    const ordered = [];
    const seen = new Set();
    for (const candidate of [preferred, ...fallbacks]) {
        const value = cleanText(candidate);
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        ordered.push(value);
    }
    return ordered;
}
function isLikelyNavigationUrl(rawUrl) {
    const urlText = cleanText(rawUrl);
    if (!urlText)
        return true;
    try {
        const parsed = new URL(urlText);
        const path = cleanText(parsed.pathname).toLowerCase().replace(/\/+$/, '/') || '/';
        if (path === '/')
            return true;
        if (NAVIGATION_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)))
            return true;
        return false;
    }
    catch {
        return true;
    }
}
function classifyDetailStatus(rawUrl) {
    const urlText = cleanText(rawUrl);
    if (!urlText) {
        return {
            detail_status: 'blocked',
            detail_reason: 'missing_url',
        };
    }
    try {
        const parsed = new URL(urlText);
        const path = cleanText(parsed.pathname).toLowerCase().replace(/\/+$/, '/') || '/';
        if (path.includes('/jybx/')) {
            return {
                detail_status: 'ok',
                detail_reason: 'jybx_detail',
            };
        }
        if (BLOCKED_DETAIL_PATH_PREFIXES.some((prefix) => path.includes(prefix))) {
            return {
                detail_status: 'blocked',
                detail_reason: 'verification_or_paid_wall',
            };
        }
        if (isLikelyNavigationUrl(urlText)) {
            return {
                detail_status: 'entry_only',
                detail_reason: 'navigation_or_profile_entry',
            };
        }
        return {
            detail_status: 'entry_only',
            detail_reason: 'non_jybx_entry',
        };
    }
    catch {
        return {
            detail_status: 'blocked',
            detail_reason: 'invalid_url',
        };
    }
}
function extractNoticeId(rawUrl) {
    const value = cleanText(rawUrl);
    if (!value)
        return '';
    try {
        const parsed = new URL(value);
        const path = cleanText(parsed.pathname);
        const jybxMatched = path.match(/\/jybx\/([^/?#]+)\.html$/i);
        if (jybxMatched?.[1])
            return cleanText(jybxMatched[1]);
        const segments = path.split('/').filter(Boolean);
        const tail = cleanText(segments[segments.length - 1] || '');
        return cleanText(tail.replace(/\.html?$/i, ''));
    }
    catch {
        return '';
    }
}
function isWithinSinceDays(dateText, sinceDays, now = new Date()) {
    const normalized = normalizeDate(dateText);
    if (!normalized)
        return false;
    const timestamp = Date.parse(`${normalized}T00:00:00Z`);
    if (!Number.isFinite(timestamp))
        return false;
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const deltaDays = Math.floor((today - timestamp) / (24 * 3600 * 1000));
    return deltaDays >= 0 && deltaDays <= sinceDays;
}
function dedupeByNoticeKey(items) {
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
        const source = cleanText(item.source_id || '');
        const notice = cleanText(item.notice_id || '');
        const key = source && notice
            ? `${source}\t${notice}`
            : `${cleanText(item.title)}\t${cleanText(item.url)}`;
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}
function filterNavigationRows(query, items) {
    const queryTokens = cleanText(query).split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
    return items
        .map((item) => ({
        title: cleanText(item.title),
        url: cleanText(item.url),
        date: normalizeDate(cleanText(item.date)),
        contextText: cleanText(item.contextText),
    }))
        .filter((item) => {
        if (!item.title || !item.url)
            return false;
        const detailSignal = classifyDetailStatus(item.url);
        if (detailSignal.detail_status !== 'ok')
            return false;
        const haystack = `${item.title} ${item.contextText}`.toLowerCase();
        const hasQuery = queryTokens.length === 0 || queryTokens.some((token) => haystack.includes(token));
        const hasProcurementHint = PROCUREMENT_TITLE_HINT.test(`${item.title} ${item.contextText}`);
        const hasDate = !!item.date;
        if (!hasQuery)
            return false;
        if (!isLikelyNavigationUrl(item.url))
            return true;
        return hasDate && hasProcurementHint;
    });
}
async function isAuthRequired(page) {
    const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
    if (AUTH_REQUIRED_HINT.test(pageText))
        return true;
    return detectAuthPrompt(page);
}
function toAbsoluteJianyuUrl(rawUrl) {
    const value = cleanText(rawUrl);
    if (!value)
        return '';
    if (value.startsWith('http://') || value.startsWith('https://'))
        return value;
    if (value.startsWith('//'))
        return `https:${value}`;
    if (value.startsWith('/')) {
        try {
            return new URL(value, SEARCH_ENTRY).toString();
        }
        catch {
            return '';
        }
    }
    return '';
}
function extractDateFromJianyuUrl(rawUrl) {
    const value = cleanText(rawUrl);
    if (!value)
        return '';
    const matched = value.match(/\/(20\d{2})(\d{2})(\d{2})(?:[_/]|$)/);
    if (!matched)
        return '';
    return `${matched[1]}-${matched[2]}-${matched[3]}`;
}
function flattenStrings(input, depth = 0) {
    if (depth > 2 || input == null)
        return [];
    if (typeof input === 'string' || typeof input === 'number') {
        const text = cleanText(String(input));
        return text ? [text] : [];
    }
    if (Array.isArray(input)) {
        return input.flatMap((item) => flattenStrings(item, depth + 1));
    }
    if (typeof input === 'object') {
        return Object.values(input).flatMap((item) => flattenStrings(item, depth + 1));
    }
    return [];
}
function pickString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' || typeof value === 'number') {
            const text = cleanText(String(value));
            if (text)
                return text;
        }
    }
    return '';
}
function normalizeApiRow(item) {
    if (!item || typeof item !== 'object')
        return null;
    const record = item;
    const allStrings = flattenStrings(record);
    let url = toAbsoluteJianyuUrl(pickString(record, [
        'url',
        'detailUrl',
        'detailURL',
        'link',
        'href',
        'articleUrl',
        'newsUrl',
        'contentUrl',
        'jumpUrl',
        'sourceUrl',
    ]));
    if (!url) {
        const maybeUrl = allStrings.find((value) => /jianyu360\.cn|\/jybx\/|\/nologin\/content\//i.test(value)) || '';
        url = toAbsoluteJianyuUrl(maybeUrl);
    }
    let title = cleanText(pickString(record, [
        'title',
        'noticeTitle',
        'bidTitle',
        'projectName',
        'name',
        'articleTitle',
        'newsTitle',
        'tenderTitle',
        'contentTitle',
    ]));
    if (!title) {
        title = allStrings.find((value) => value.length >= 8 && PROCUREMENT_TITLE_HINT.test(value)) || '';
    }
    const date = normalizeDate(pickString(record, [
        'publishTime',
        'publishDate',
        'pubDate',
        'createTime',
        'time',
        'releaseTime',
        'date',
    ])) || extractDateFromJianyuUrl(url);
    const contextText = cleanText([
        pickString(record, ['content', 'summary', 'desc', 'description', 'buyer', 'winner', 'agency', 'industry']),
        ...allStrings.slice(0, 6),
    ].filter(Boolean).join(' '));
    if (!title || !url)
        return null;
    return {
        title,
        url,
        date,
        contextText,
    };
}
function parseSearchIndexMarkdown(markdown) {
    const rows = [];
    for (const line of markdown.split('\n')) {
        const text = line.trim();
        if (!text.startsWith('## ['))
            continue;
        const right = text.slice(3);
        const sep = right.lastIndexOf('](');
        if (sep <= 0 || !right.endsWith(')'))
            continue;
        const title = cleanText(right.slice(1, sep));
        const url = cleanText(right.slice(sep + 2, -1));
        if (!title || !url)
            continue;
        rows.push({ title, url });
    }
    return rows;
}
function unwrapDuckDuckGoUrl(rawUrl) {
    const candidate = cleanText(rawUrl);
    if (!candidate)
        return '';
    const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
    try {
        const parsed = new URL(normalized);
        const host = parsed.hostname.toLowerCase();
        if (!host.endsWith('duckduckgo.com'))
            return normalized;
        const uddg = parsed.searchParams.get('uddg');
        if (!uddg)
            return normalized;
        try {
            return decodeURIComponent(uddg);
        }
        catch {
            return uddg;
        }
    }
    catch {
        return '';
    }
}
function isJianyuHost(rawUrl) {
    const value = cleanText(rawUrl);
    if (!value)
        return false;
    try {
        return new URL(value).hostname.toLowerCase().endsWith('jianyu360.cn');
    }
    catch {
        return false;
    }
}
function buildIndexQueryVariants(query) {
    const tokens = cleanText(query).split(/\s+/).filter(Boolean);
    const values = [cleanText(query), ...tokens];
    const ordered = [];
    const seen = new Set();
    for (const value of values) {
        const text = cleanText(value);
        if (!text || seen.has(text))
            continue;
        seen.add(text);
        ordered.push(text);
    }
    return ordered;
}
async function fetchDuckDuckGoIndexRows(query, limit) {
    const results = [];
    const seen = new Set();
    for (const variant of buildIndexQueryVariants(query)) {
        if (results.length >= limit)
            break;
        const fullQuery = `site:jianyu360.cn ${variant}`;
        const url = `${SEARCH_INDEX_PROXY}${encodeURIComponent(fullQuery)}`;
        let responseText = '';
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'text/plain, text/markdown, */*',
                    'User-Agent': 'opencli-jianyu-search/1.0',
                },
            });
            if (!response.ok)
                continue;
            responseText = await response.text();
        }
        catch {
            continue;
        }
        const indexedRows = parseSearchIndexMarkdown(responseText);
        for (const row of indexedRows) {
            const unwrapped = unwrapDuckDuckGoUrl(row.url);
            const absoluteUrl = toAbsoluteJianyuUrl(unwrapped) || cleanText(unwrapped);
            if (!isJianyuHost(absoluteUrl))
                continue;
            const key = `${row.title}\t${absoluteUrl}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            results.push({
                title: cleanText(row.title),
                url: absoluteUrl,
                date: extractDateFromJianyuUrl(absoluteUrl),
                contextText: cleanText(`${row.title} ${variant}`),
            });
            if (results.length >= limit)
                break;
        }
    }
    return results;
}
async function fetchJianyuApiRows(page, query, limit) {
    try {
        await page.goto(buildSearchUrl(query));
        await page.wait(2);
        const payload = await page.evaluate(`
      (async () => {
        const now = Math.floor(Date.now() / 1000);
        const body = {
          searchGroup: 1,
          reqType: 'lastNews',
          pageNum: 1,
          pageSize: Math.max(20, Math.min(${Math.max(20, limit)}, 50)),
          keyWords: ${JSON.stringify(query)},
          searchMode: 0,
          bidField: '',
          publishTime: \`\${now - 3600 * 24 * 365 * 3}-\${now}\`,
          selectType: 'title,content',
          subtype: '',
          exclusionWords: '',
          buyer: '',
          winner: '',
          agency: '',
          industry: '',
          province: '',
          city: '',
          district: '',
          buyerClass: '',
          fileExists: '',
          price: '',
          buyerTel: '',
          winnerTel: '',
        };
        const responses = [];
        const types = ${JSON.stringify([...JIANYU_API_TYPES])};
        for (const type of types) {
          try {
            const response = await fetch('/jyapi/jybx/core/' + type + '/searchList', {
              method: 'POST',
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify(body),
            });
            let raw = null;
            try {
              raw = await response.json();
            } catch {
              raw = null;
            }
            const dataList = raw && raw.data && Array.isArray(raw.data.list) ? raw.data.list : [];
            responses.push({
              type,
              ok: response.ok,
              status: response.status,
              payload: {
                antiVerify: raw && typeof raw.antiVerify === 'number' ? raw.antiVerify : undefined,
                error_code: raw && typeof raw.error_code === 'number' ? raw.error_code : undefined,
                hasLogin: raw && typeof raw.hasLogin === 'boolean' ? raw.hasLogin : undefined,
                textVerify: raw && typeof raw.textVerify === 'string' ? raw.textVerify.slice(0, 16) : undefined,
                list: dataList,
              },
            });
          } catch {
            responses.push({
              type,
              ok: false,
              status: 0,
            });
          }
        }
        const challenge = responses.some((item) => item && item.payload && item.payload.antiVerify === -1);
        return { challenge, responses };
      })()
    `);
        const responses = Array.isArray(payload?.responses) ? payload.responses : [];
        const rows = collectApiRowsFromResponses(responses);
        const challenge = Boolean(payload?.challenge);
        return { rows, challenge };
    }
    catch {
        return { rows: [], challenge: false };
    }
}
function collectApiRowsFromResponses(responses) {
    const rows = [];
    const seen = new Set();
    for (const response of responses) {
        if (!response || typeof response !== 'object')
            continue;
        const meta = response;
        const body = meta.payload;
        if (!body || typeof body !== 'object')
            continue;
        const list = body.list;
        if (!Array.isArray(list))
            continue;
        for (const item of list) {
            const row = normalizeApiRow(item);
            if (!row)
                continue;
            const key = `${row.title}\t${row.url}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            rows.push(row);
        }
    }
    return rows;
}
cli({
    site: SITE,
    name: 'search',
    description: '搜索剑鱼标讯公告',
    domain: DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword, e.g. "procurement"' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
        { name: 'since_days', type: 'int', help: 'Only keep rows published within N days' },
    ],
    columns: ['rank', 'content_type', 'title', 'published_at', 'detail_status', 'project_code', 'budget_or_limit', 'url'],
    func: async (page, kwargs) => {
        const query = cleanText(kwargs.query);
        const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
        const rawSinceDays = Number(kwargs.since_days);
        const sinceDays = Number.isFinite(rawSinceDays) && rawSinceDays > 0
            ? Math.max(1, Math.min(rawSinceDays, 3650))
            : null;
        const apiResult = await fetchJianyuApiRows(page, query, limit);
        const mergedRows = dedupeCandidates(filterNavigationRows(query, apiResult.rows));
        const extractedRows = await searchRowsFromEntries(page, {
            query,
            candidateUrls: siteSearchCandidates(query),
            allowedHostFragments: ['jianyu360.cn'],
            limit,
        });
        const domRows = dedupeCandidates(filterNavigationRows(query, extractedRows));
        const rows = dedupeCandidates([...mergedRows, ...domRows]);
        if (rows.length === 0) {
            const indexedRows = await fetchDuckDuckGoIndexRows(query, limit);
            const filteredIndexedRows = dedupeCandidates(filterNavigationRows(query, indexedRows));
            if (filteredIndexedRows.length > 0) {
                const records = toProcurementSearchRecords(filteredIndexedRows, {
                    site: SITE,
                    query,
                    limit,
                });
                const enriched = dedupeByNoticeKey(records.map((row) => {
                    const detailSignal = classifyDetailStatus(row.url);
                    const publishedAt = normalizeDate(row.publish_time || row.date);
                    return {
                        ...row,
                        source_id: SITE,
                        notice_id: extractNoticeId(row.url),
                        published_at: publishedAt,
                        detail_status: detailSignal.detail_status,
                        detail_reason: detailSignal.detail_reason,
                    };
                }))
                    .filter((row) => row.detail_status === 'ok')
                    .filter((row) => sinceDays == null || isWithinSinceDays(row.published_at, sinceDays))
                    .slice(0, limit)
                    .map((row, index) => ({
                    ...row,
                    rank: index + 1,
                }));
                return enriched;
            }
            if (apiResult.challenge || await isAuthRequired(page)) {
                throw new AuthRequiredError(DOMAIN, '[taxonomy=selector_drift] site=jianyu command=search blocked by human verification / access challenge');
            }
        }
        const records = toProcurementSearchRecords(rows, {
            site: SITE,
            query,
            limit,
        });
        const enriched = dedupeByNoticeKey(records.map((row) => {
            const detailSignal = classifyDetailStatus(row.url);
            const publishedAt = normalizeDate(row.publish_time || row.date);
            return {
                ...row,
                source_id: SITE,
                notice_id: extractNoticeId(row.url),
                published_at: publishedAt,
                detail_status: detailSignal.detail_status,
                detail_reason: detailSignal.detail_reason,
            };
        }))
            .filter((row) => row.detail_status === 'ok')
            .filter((row) => sinceDays == null || isWithinSinceDays(row.published_at, sinceDays))
            .slice(0, limit)
            .map((row, index) => ({
            ...row,
            rank: index + 1,
        }));
        return enriched;
    },
});
export const __test__ = {
    buildSearchCandidates: siteSearchCandidates,
    buildSearchUrl,
    normalizeDate,
    dedupeCandidates,
    filterNavigationRows,
    parseSearchIndexMarkdown,
    unwrapDuckDuckGoUrl,
    extractDateFromJianyuUrl,
    normalizeApiRow,
    fetchJianyuApiRows,
    collectApiRowsFromResponses,
    classifyDetailStatus,
    extractNoticeId,
    isWithinSinceDays,
    dedupeByNoticeKey,
};
