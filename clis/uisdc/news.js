import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError, getErrorMessage } from '@jackwener/opencli/errors';

const UISDC_NEWS_URL = 'https://www.uisdc.com/news';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function normalizeLimit(value) {
    const raw = value ?? DEFAULT_LIMIT;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('limit must be a positive integer', `Example: opencli uisdc news --limit ${DEFAULT_LIMIT}`);
    }
    if (limit > MAX_LIMIT) {
        throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`, `Example: opencli uisdc news --limit ${MAX_LIMIT}`);
    }
    return limit;
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function buildExtractUisdcNewsJs() {
    return `
      (() => {
        const cards = Array.from(document.querySelectorAll(
          '.news-list > .news-item:first-child > .item-content > .dubao-items > .dubao-item'
        ));
        if (cards.length === 0) {
          return {
            ok: false,
            reason: 'selector-missing',
            title: document.title || '',
            bodyText: (document.body?.innerText || document.body?.textContent || '').slice(0, 500),
          };
        }
        const rows = cards.map((el, index) => {
          const anchor = el.querySelector('a[href]');
          return {
            rank: index + 1,
            title: el.querySelector('.dubao-title')?.textContent || '',
            summary: el.querySelector('.dubao-content')?.textContent || '',
            url: anchor ? new URL(anchor.getAttribute('href'), location.href).href : '',
          };
        });
        return { ok: true, rows };
      })()
    `;
}

function toRows(payload, limit) {
    if (!payload || typeof payload !== 'object') {
        throw new CommandExecutionError('UISDC news page returned an unreadable payload');
    }
    if (!payload.ok) {
        const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : 'selector-drift';
        throw new CommandExecutionError(
            `UISDC news selector drift: ${reason}`,
            payload.title ? `Page title: ${payload.title}` : undefined,
        );
    }
    const rows = (Array.isArray(payload.rows) ? payload.rows : [])
        .map((row, index) => ({
            rank: index + 1,
            title: normalizeText(row.title),
            summary: normalizeText(row.summary),
            url: normalizeText(row.url),
        }))
        .filter((row) => row.title && row.url);
    if (rows.length === 0) {
        throw new EmptyResultError('uisdc news', 'UISDC news page loaded, but no news rows with title and URL were extracted.');
    }
    return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

async function loadUisdcNews(page, args) {
    const limit = normalizeLimit(args.limit);
    await page.goto(UISDC_NEWS_URL, { waitUntil: 'load', settleMs: 3000 });
    const payload = await page.evaluate(buildExtractUisdcNewsJs()).catch((error) => {
        throw new CommandExecutionError(`Failed to extract UISDC news: ${getErrorMessage(error)}`);
    });
    return toRows(payload, limit);
}

export const uisdcNewsCommand = cli({
    site: 'uisdc',
    name: 'news',
    access: 'read',
    description: '优设读报 - 最新 AI/设计行业新闻',
    domain: 'www.uisdc.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of news items to return (max ${MAX_LIMIT})` },
    ],
    columns: ['rank', 'title', 'summary', 'url'],
    func: loadUisdcNews,
});

export const __test__ = {
    buildExtractUisdcNewsJs,
    normalizeLimit,
    toRows,
};
