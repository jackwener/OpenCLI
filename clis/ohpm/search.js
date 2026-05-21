import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const OHPM_HOME = 'https://ohpm.openharmony.cn/';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLimit(value) {
    const limit = Number(value ?? DEFAULT_LIMIT);

    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError(
            'limit must be a positive integer',
            `Example: opencli ohpm search axios --limit ${DEFAULT_LIMIT}`,
        );
    }

    if (limit > MAX_LIMIT) {
        throw new ArgumentError(
            `limit must be <= ${MAX_LIMIT}`,
            `Example: opencli ohpm search axios --limit ${MAX_LIMIT}`,
        );
    }

    return limit;
}

function normalizePackage(raw, index) {
    const item = raw?.package ?? raw;
    const links = item?.links ?? raw?.links ?? {};
    const name = normalizeText(item?.name ?? raw?.name ?? raw?.packageName ?? raw?.pkgName);

    if (!name) return null;

    return {
        rank: index + 1,
        name,
        version: normalizeText(item?.version ?? raw?.version ?? raw?.latestVersion),
        description: normalizeText(item?.description ?? raw?.description ?? raw?.summary),
        author: normalizeText(
            item?.publisher?.username ??
            item?.publisher?.email ??
            item?.author?.name ??
            item?.author ??
            raw?.authorName ??
            raw?.author,
        ),
        url: normalizeText(
            links?.npm ??
            item?.url ??
            raw?.url ??
            `https://ohpm.openharmony.cn/#/cn/detail/${encodeURIComponent(name)}`,
        ),
    };
}

function pickArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.objects)) return payload.objects;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.list)) return payload.data.list;
    if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
    if (Array.isArray(payload?.result)) return payload.result;
    if (Array.isArray(payload?.result?.list)) return payload.result.list;
    if (Array.isArray(payload?.packages)) return payload.packages;
    if (Array.isArray(payload?.list)) return payload.list;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return [];
}

function normalizePackages(payload, limit) {
    return pickArray(payload)
        .map(normalizePackage)
        .filter(Boolean)
        .slice(0, limit)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildSearchScript(query, limit) {
    return `
        (async () => {
            const query = ${JSON.stringify(query)};
            const limit = ${JSON.stringify(limit)};
            const origin = location.origin;
            const endpoints = [
                origin + '/ohpm/-/v1/search?text=' + encodeURIComponent(query) + '&size=' + limit,
                origin + '/ohpm/v1/search?keyword=' + encodeURIComponent(query) + '&pageNo=1&pageSize=' + limit,
                origin + '/api/package/search?keyword=' + encodeURIComponent(query) + '&pageNo=1&pageSize=' + limit,
                origin + '/api/packages?keyword=' + encodeURIComponent(query) + '&pageNo=1&pageSize=' + limit,
            ];

            for (const url of endpoints) {
                try {
                    const response = await fetch(url, {
                        headers: { accept: 'application/json, text/plain, */*' },
                    });
                    const contentType = response.headers.get('content-type') || '';
                    if (!response.ok || !contentType.includes('json')) continue;
                    const json = await response.json();
                    return { source: url, payload: json };
                } catch {
                    // Try the next known endpoint shape.
                }
            }

            const input = Array.from(document.querySelectorAll('input')).find((el) => {
                const text = [el.placeholder, el.name, el.id, el.className].join(' ').toLowerCase();
                return text.includes('search') || text.includes('搜索') || text.includes('keyword');
            });

            if (input) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                setter?.call(input, query);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const rows = [];
            const seen = new Set();

            const text = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();

            for (const anchor of anchors) {
                const href = anchor.getAttribute('href') || '';
                const label = text(anchor);
                const url = new URL(href, location.href).href;
                const nearby = anchor.closest('li, .card, .el-card, [class*=card], [class*=item], [class*=package]') || anchor.parentElement;
                const body = text(nearby);
                const haystack = (label + ' ' + body + ' ' + href).toLowerCase();

                if (!label || seen.has(label)) continue;
                if (query && !haystack.includes(query.toLowerCase())) continue;
                if (!href.includes('detail') && !href.includes('package') && !label.startsWith('@')) continue;

                seen.add(label);
                rows.push({
                    name: label,
                    version: '',
                    description: body.replace(label, '').trim().slice(0, 240),
                    author: '',
                    url,
                });
            }

            return { source: 'dom', payload: { rows } };
        })()
    `;
}

cli({
    site: 'ohpm',
    name: 'search',
    access: 'read',
    description: 'Search OpenHarmony OHPM third-party packages',
    domain: 'ohpm.openharmony.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Package keyword' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of packages, max ${MAX_LIMIT}` },
    ],
    columns: ['rank', 'name', 'version', 'description', 'author', 'url'],

    func: async (page, args) => {
        const query = normalizeText(args.query);
        const limit = normalizeLimit(args.limit);

        if (!query) {
            throw new ArgumentError(
                'query is required',
                'Example: opencli ohpm search axios --limit 10',
            );
        }

        await page.goto(OHPM_HOME);

        let result;
        try {
            result = await page.evaluate(buildSearchScript(query, limit));
        } catch (error) {
            throw new CommandExecutionError(
                `Failed to search OHPM packages: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const rows = normalizePackages(result?.payload, limit);

        if (rows.length === 0) {
            throw new EmptyResultError(
                'ohpm search',
                `No OHPM packages matched "${query}". The site may have changed its API or rendered markup.`,
            );
        }

        return rows;
    },
});
