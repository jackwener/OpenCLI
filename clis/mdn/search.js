// mdn search — search MDN Web Docs.
//
// Hits `https://developer.mozilla.org/api/v1/search?q=…&locale=…`. Returns a
// row per matched doc with title, slug-derived id, summary preview, and the
// canonical MDN URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const MDN_BASE = 'https://developer.mozilla.org';
const UA = 'opencli-mdn-adapter (+https://github.com/jackwener/opencli)';
const ALLOWED_LOCALES = new Set(['en-US', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN', 'zh-TW']);

function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`mdn ${label} cannot be empty`);
    return s;
}

function requireBoundedInt(value, defaultValue, maxValue) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError('mdn limit must be a positive integer');
    }
    if (n > maxValue) {
        throw new ArgumentError(`mdn limit must be <= ${maxValue}`);
    }
    return n;
}

function requireLocale(value) {
    const s = String(value ?? 'en-US').trim();
    if (!ALLOWED_LOCALES.has(s)) {
        throw new ArgumentError(
            `mdn locale "${value}" is not supported`,
            `Allowed locales: ${[...ALLOWED_LOCALES].join(' / ')}`,
        );
    }
    return s;
}

cli({
    site: 'mdn',
    name: 'search',
    access: 'read',
    description: 'Search MDN Web Docs by keyword',
    domain: 'developer.mozilla.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "fetch", "flexbox", "Array.prototype.map")' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
        { name: 'locale', default: 'en-US', help: 'Doc locale (en-US default; de / es / fr / ja / ko / pt-BR / ru / zh-CN / zh-TW)' },
    ],
    columns: ['rank', 'title', 'slug', 'locale', 'summary', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 10, 50);
        const locale = requireLocale(args.locale);
        const url = `${MDN_BASE}/api/v1/search?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}&size=${limit}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
        }
        catch (err) {
            throw new CommandExecutionError(`mdn search request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'mdn search returned HTTP 429 (rate limited)',
                'MDN throttles bursty traffic; wait a few seconds and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`mdn search returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`mdn search returned malformed JSON: ${err?.message ?? err}`);
        }
        const docs = Array.isArray(body?.documents) ? body.documents : [];
        if (!docs.length) {
            throw new EmptyResultError('mdn search', `No MDN results matched "${query}" (locale ${locale}).`);
        }
        return docs.slice(0, limit).map((doc, i) => ({
            rank: i + 1,
            title: String(doc.title ?? ''),
            slug: String(doc.slug ?? ''),
            locale: String(doc.locale ?? locale),
            summary: String(doc.summary ?? '').replace(/\s+/g, ' ').trim(),
            url: doc.mdn_url ? `${MDN_BASE}${doc.mdn_url}` : '',
        }));
    },
});
