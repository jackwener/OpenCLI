import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError, getErrorMessage } from '@jackwener/opencli/errors';

const AIBASE_DAILY_URL = 'https://www.aibase.com/zh/daily';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function normalizeLimit(value) {
    const raw = value ?? DEFAULT_LIMIT;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('limit must be a positive integer', `Example: opencli aibase news --limit ${DEFAULT_LIMIT}`);
    }
    if (limit > MAX_LIMIT) {
        throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`, `Example: opencli aibase news --limit ${MAX_LIMIT}`);
    }
    return limit;
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function buildExtractAibaseNewsJs() {
    return `
      (() => {
        const anchors = Array.from(document.querySelectorAll('.bg-white .grid a[href], a[href*="/zh/daily/"]'))
          .filter((anchor) => {
            const href = anchor.getAttribute('href') || '';
            const text = (anchor.innerText || anchor.textContent || '').trim();
            return text && href && !href.endsWith('/zh/daily') && !href.endsWith('/zh/daily/');
          });
        if (anchors.length === 0) {
          return {
            ok: false,
            reason: 'selector-missing',
            title: document.title || '',
            bodyText: (document.body?.innerText || document.body?.textContent || '').slice(0, 500),
          };
        }
        const seen = new Set();
        const rows = [];
        for (const anchor of anchors) {
          const url = new URL(anchor.getAttribute('href'), location.href).href;
          if (seen.has(url)) continue;
          seen.add(url);
          rows.push({
            rank: rows.length + 1,
            title: anchor.innerText || anchor.textContent || '',
            url,
          });
        }
        return { ok: true, rows };
      })()
    `;
}

function toRows(payload, limit) {
    if (!payload || typeof payload !== 'object') {
        throw new CommandExecutionError('AIbase daily page returned an unreadable payload');
    }
    if (!payload.ok) {
        const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : 'selector-drift';
        throw new CommandExecutionError(
            `AIbase daily selector drift: ${reason}`,
            payload.title ? `Page title: ${payload.title}` : undefined,
        );
    }
    const rows = (Array.isArray(payload.rows) ? payload.rows : [])
        .map((row, index) => ({
            rank: index + 1,
            title: normalizeText(row.title),
            url: normalizeText(row.url),
        }))
        .filter((row) => row.title && row.url);
    if (rows.length === 0) {
        throw new EmptyResultError('aibase news', 'AIbase daily page loaded, but no article rows with title and URL were extracted.');
    }
    return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

async function loadAibaseNews(page, args) {
    const limit = normalizeLimit(args.limit);
    await page.goto(AIBASE_DAILY_URL, { waitUntil: 'load', settleMs: 3000 });
    const payload = await page.evaluate(buildExtractAibaseNewsJs()).catch((error) => {
        throw new CommandExecutionError(`Failed to extract AIbase daily news: ${getErrorMessage(error)}`);
    });
    return toRows(payload, limit);
}

export const aibaseNewsCommand = cli({
    site: 'aibase',
    name: 'news',
    access: 'read',
    description: 'AIbase 日报 - 每天三分钟关注AI行业趋势',
    domain: 'www.aibase.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of news items to return (max ${MAX_LIMIT})` },
    ],
    columns: ['rank', 'title', 'url'],
    func: loadAibaseNews,
});

export const __test__ = {
    buildExtractAibaseNewsJs,
    normalizeLimit,
    toRows,
};
