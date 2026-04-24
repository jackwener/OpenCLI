import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { WEREAD_UA, WEREAD_WEB_ORIGIN, WEREAD_DOMAIN } from './utils.js';

const WEB_API = `${WEREAD_WEB_ORIGIN}/web`;

function buildCookieHeader(cookies) {
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function postWebApiWithCookies(page, path, body) {
    const url = `${WEB_API}${path}`;
    const [apiCookies, domainCookies] = await Promise.all([
        page.getCookies({ url }),
        page.getCookies({ domain: WEREAD_DOMAIN }),
    ]);
    const merged = new Map();
    for (const c of domainCookies) merged.set(c.name, c);
    for (const c of apiCookies) merged.set(c.name, c);
    const cookieHeader = buildCookieHeader(Array.from(merged.values()));

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': WEREAD_UA,
            'Content-Type': 'application/json',
            'Origin': WEREAD_WEB_ORIGIN,
            'Referer': `${WEREAD_WEB_ORIGIN}/`,
            ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        },
        body: JSON.stringify(body),
    });

    if (resp.status === 401) {
        throw new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first');
    }

    let data;
    try {
        data = await resp.json();
    } catch {
        throw new CliError('PARSE_ERROR', `Invalid JSON response for ${path}`, 'WeRead may have returned an HTML error page');
    }

    if (data?.errcode === -2010 || data?.errcode === -2012) {
        throw new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first');
    }
    if (!resp.ok) {
        throw new CliError('FETCH_ERROR', `HTTP ${resp.status} for ${path}`, 'WeRead API may be temporarily unavailable');
    }
    return data;
}

async function postWebApi(path, body) {
    const url = `${WEB_API}${path}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': WEREAD_UA,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new CliError('FETCH_ERROR', `HTTP ${resp.status} for ${path}`, 'WeRead API may be temporarily unavailable');
    }
    try {
        return await resp.json();
    } catch {
        throw new CliError('PARSE_ERROR', `Invalid JSON response for ${path}`, 'WeRead may have returned an HTML error page');
    }
}

cli({
    site: 'weread',
    name: 'ai-outline',
    description: 'Get AI-generated outline for a book',
    domain: 'weread.qq.com',
    strategy: Strategy.COOKIE,
    defaultFormat: 'plain',
    args: [
        { name: 'book-id', positional: true, required: true, help: 'Book ID (from shelf or search results)' },
        { name: 'limit', type: 'int', default: 200, help: 'Max outline items to return' },
        { name: 'depth', type: 'int', default: 4, help: 'Max outline depth (2=topics, 3=key points, 4=details)' },
        { name: 'raw', type: 'boolean', default: false, help: 'Output structured rows (chapter/idx/level/text) for programmatic use' },
    ],
    columns: undefined,
    func: async (page, args) => {
        const bookId = String(args['book-id'] || '').trim();
        const rawMode = Boolean(args.raw);

        const chapterData = await postWebApiWithCookies(page, '/book/chapterInfos', {
            bookIds: [bookId],
            sinces: [0],
        });
        const chapters = chapterData?.data?.[0]?.updated ?? [];
        if (chapters.length === 0) {
            throw new CliError('NOT_FOUND', 'No chapters found for this book', 'Check that the book ID is correct');
        }

        const chapterUids = chapters.map((c) => c.chapterUid);
        const chapterNameMap = new Map();
        for (const c of chapters) {
            chapterNameMap.set(c.chapterUid, c.title ?? '');
        }

        const outlineData = await postWebApi('/book/outline', {
            bookId,
            chapterUids,
        });

        const itemsArray = outlineData?.itemsArray ?? [];
        const maxDepth = Number(args.depth);
        const rawRows = [];

        for (const entry of itemsArray) {
            const items = entry.items;
            if (!Array.isArray(items) || items.length === 0) continue;

            const chapterName = chapterNameMap.get(entry.chapterUid) ?? `Chapter ${entry.chapterUid}`;
            let lastL3Idx = '';
            let l4Counter = 0;

            for (const item of items) {
                const level = item.level ?? 1;
                if (level <= 1) continue;
                if (level > maxDepth) continue;

                let idx = item.uiIdx ?? '';
                if (level === 3 && idx) {
                    lastL3Idx = idx;
                    l4Counter = 0;
                }
                if (level === 4 && !idx && lastL3Idx) {
                    l4Counter++;
                    idx = `${lastL3Idx}.${l4Counter}`;
                }

                rawRows.push({ chapter: chapterName, idx, level, text: item.text ?? '' });
            }
        }

        if (rawRows.length === 0) {
            throw new CliError('NOT_FOUND', 'No AI outline available for this book', 'AI outlines may not be generated for all books');
        }

        if (rawMode) {
            return rawRows.slice(0, Number(args.limit));
        }

        const grouped = new Map();
        for (const row of rawRows) {
            if (!grouped.has(row.chapter)) grouped.set(row.chapter, []);
            grouped.get(row.chapter).push(row);
        }

        const results = [];
        for (const [chapter, rows] of grouped) {
            const lines = [`📖 ${chapter}`];
            for (const row of rows) {
                const indent = '  '.repeat(row.level - 2);
                const prefix = row.level === 2 ? `${row.idx}. ` : `${row.idx} `;
                lines.push(`${indent}${prefix}${row.text}`);
            }
            results.push({ outline: lines.join('\n') });
        }

        return results.slice(0, Number(args.limit));
    },
});
