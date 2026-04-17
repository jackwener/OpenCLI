import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const GITEE_SEARCH_URL = 'https://gitee.com/search';
const GITEE_SEARCH_WIDGET = 'wong1slagnlmzwvsu5ya';
const GITEE_SEARCH_API = `https://so.gitee.com/v1/search/widget/${GITEE_SEARCH_WIDGET}`;
const MAX_LIMIT = 50;
function clampLimit(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed))
        return 10;
    return Math.max(1, Math.min(parsed, MAX_LIMIT));
}
function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeStars(value) {
    let raw = '';
    if (typeof value === 'number')
        raw = String(value);
    else if (typeof value === 'string')
        raw = value;
    else if (Array.isArray(value) && value.length > 0)
        raw = String(value[0] ?? '');
    const compact = normalizeText(raw).replace(/\s+/g, '');
    if (!compact)
        return '-';
    const match = compact.match(/\d+(?:[.,]\d+)?(?:[kKmMwW]|\u4E07)?/);
    return match ? match[0] : '-';
}
function getFirstText(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number')
        return String(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === 'string' || typeof item === 'number') {
                return String(item);
            }
        }
    }
    return '';
}
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function normalizeUrl(value) {
    try {
        const parsed = new URL(value, 'https://gitee.com');
        const host = parsed.hostname.toLowerCase();
        if (host !== 'gitee.com' && host !== 'www.gitee.com')
            return null;
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length !== 2)
            return null;
        return `https://gitee.com/${parts[0]}/${parts[1]}`;
    }
    catch {
        return null;
    }
}
cli({
    site: 'gitee',
    name: 'search',
    description: 'Search repositories on Gitee',
    domain: 'gitee.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 50)' },
    ],
    columns: ['rank', 'name', 'language', 'stars', 'description', 'url'],
    func: async (page, args) => {
        const keyword = String(args.keyword ?? '').trim();
        if (!keyword) {
            throw new CliError('INVALID_ARGUMENT', 'Keyword is required', 'Provide a search keyword');
        }
        const limit = clampLimit(args.limit);
        const encodedKeyword = encodeURIComponent(keyword);
        const searchUrl = `${GITEE_SEARCH_URL}?q=${encodedKeyword}&type=repository`;
        const fetchSize = Math.max(10, limit);
        const apiUrl = new URL(GITEE_SEARCH_API);
        apiUrl.searchParams.set('q', keyword);
        apiUrl.searchParams.set('from', '0');
        apiUrl.searchParams.set('size', String(fetchSize));
        await page.goto(searchUrl);
        await page.wait(2);
        const response = await fetch(apiUrl.toString(), {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0',
                Referer: searchUrl,
            },
        });
        if (!response.ok) {
            throw new CliError('REQUEST_FAILED', `Failed to request Gitee search API: ${response.status}`, 'Try again later or verify network access to so.gitee.com');
        }
        const payload = await response.json();
        const payloadRecord = asRecord(payload);
        const hitsRecord = asRecord(payloadRecord?.hits);
        const rawRows = Array.isArray(hitsRecord?.hits) ? hitsRecord.hits : [];
        if (rawRows.length === 0) {
            throw new CliError('NOT_FOUND', 'No Gitee repository search results found', 'Try a different keyword or check whether Gitee search API changed');
        }
        const seen = new Set();
        const rows = [];
        for (let i = 0; i < rawRows.length && rows.length < limit; i++) {
            const row = asRecord(rawRows[i]);
            const fields = asRecord(row?.fields);
            if (!fields)
                continue;
            const name = normalizeText(getFirstText(fields.title));
            const repoUrl = normalizeUrl(getFirstText(fields.url));
            if (!name || !repoUrl)
                continue;
            if (seen.has(repoUrl))
                continue;
            seen.add(repoUrl);
            rows.push({
                rank: rows.length + 1,
                name,
                language: normalizeText(getFirstText(fields.langs)) || '-',
                description: normalizeText(getFirstText(fields.description)) || '-',
                stars: normalizeStars(fields['count.star']),
                url: repoUrl,
            });
        }
        if (rows.length === 0) {
            throw new CliError('NOT_FOUND', 'No valid Gitee repository results parsed', 'Try a different keyword or check whether Gitee search API changed');
        }
        return rows;
    },
});
