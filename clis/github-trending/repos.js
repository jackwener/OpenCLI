// github-trending — repositories from https://github.com/trending (public HTML, no auth).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const SINCE = {
    daily: 'daily',
    weekly: 'weekly',
    monthly: 'monthly',
};

function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
    return String(value ?? '').replace(/<[^>]*>/g, '');
}

function parseCount(value) {
    if (value == null) return null;
    const digits = String(value).replace(/[,\s]/g, '');
    if (!/^\d+$/.test(digits)) return null;
    return Number(digits);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertCount(value, field, repo) {
    const count = parseCount(value);
    if (count == null) {
        throw new CommandExecutionError(`github-trending parser drift: missing ${field} for ${repo}`);
    }
    return count;
}

function hasExplicitEmptyTrending(html) {
    return /don.t have any trending repositories/i.test(stripTags(html))
        || /no trending repositories/i.test(stripTags(html));
}

function parseTrendingHtml(html, limit) {
    const blocks = Array.from(String(html ?? '').matchAll(/<article\b[^>]*class="[^"]*\bBox-row\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g))
        .map((match) => match[1]);
    const rows = [];

    if (blocks.length === 0) {
        if (hasExplicitEmptyTrending(html)) return rows;
        throw new CommandExecutionError('github-trending parser drift: no repository rows found');
    }

    for (const raw of blocks) {
        const block = raw;

        const nameMatch = block.match(/<h2\b[\s\S]*?href="\/([^"/?#]+\/[^"/?#]+)"/);
        if (!nameMatch) {
            throw new CommandExecutionError('github-trending parser drift: missing repository link');
        }
        const repo = decodeHtmlEntities(nameMatch[1]).trim();
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
            throw new CommandExecutionError(`github-trending parser drift: invalid repository identity "${repo}"`);
        }

        const descMatch = block.match(/<p class="col-9 color-fg-muted[^"]*">([\s\S]*?)<\/p>/);
        const description = descMatch
            ? decodeHtmlEntities(stripTags(descMatch[1]).replace(/\s+/g, ' ')).trim()
            : '';

        const langMatch = block.match(/<span itemprop="programmingLanguage">([\s\S]*?)<\/span>/);
        const language = langMatch ? decodeHtmlEntities(stripTags(langMatch[1])).trim() : null;

        const escapedRepo = escapeRegExp(repo);
        const starsMatch = block.match(new RegExp(`<a\\b[^>]*href="/${escapedRepo}/stargazers"[^>]*>([\\s\\S]*?)</a>`));
        const forksMatch = block.match(new RegExp(`<a\\b[^>]*href="/${escapedRepo}/forks"[^>]*>([\\s\\S]*?)</a>`));
        const sinceMatch = block.match(/([\d,]+)\s+stars\s+(?:today|this week|this month)/i);

        rows.push({
            repo,
            description,
            language,
            stars: assertCount(starsMatch ? stripTags(starsMatch[1]) : null, 'stars', repo),
            forks: assertCount(forksMatch ? stripTags(forksMatch[1]) : null, 'forks', repo),
            starsSince: assertCount(sinceMatch?.[1], 'period stars', repo),
            url: `https://github.com/${repo}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'github-trending',
    name: 'repos',
    access: 'read',
    description: 'GitHub Trending repositories (public, no login). Filter by --language and --since.',
    domain: 'github.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'since', type: 'string', default: 'daily', help: 'Time range: daily / weekly / monthly' },
        { name: 'language', type: 'string', default: '', help: 'Filter by programming language slug, e.g. python, rust, "c++"' },
        { name: 'limit', type: 'int', default: 25, help: 'Number of repositories to return (max 25)' },
    ],
    columns: ['rank', 'repo', 'description', 'language', 'stars', 'forks', 'starsSince', 'url'],
    func: async (args) => {
        const sinceKey = String(args.since ?? 'daily').toLowerCase();
        const since = SINCE[sinceKey];
        if (!since) {
            throw new ArgumentError(`Unknown --since "${sinceKey}". Valid: ${Object.keys(SINCE).join(', ')}`);
        }

        const n = Number(args.limit ?? 25);
        if (!Number.isInteger(n) || n <= 0) {
            throw new ArgumentError('--limit must be a positive integer');
        }
        if (n > 25) {
            throw new ArgumentError('--limit must be <= 25 (GitHub Trending lists at most 25 repositories)');
        }
        const limit = n;

        const language = String(args.language ?? '').trim();
        const path = language ? `/trending/${encodeURIComponent(language)}` : '/trending';
        const url = new URL(`https://github.com${path}`);
        url.searchParams.set('since', since);

        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; opencli/github-trending)',
                    Accept: 'text/html',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`github-trending request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`github-trending request failed: HTTP ${resp.status}`);
        }

        const html = await resp.text();
        const rows = parseTrendingHtml(html, limit);
        if (rows.length === 0) {
            throw new EmptyResultError('github-trending', language
                ? `no trending repositories for language "${language}" (${since})`
                : `no trending repositories (${since})`);
        }

        return rows.map((row, index) => ({
            rank: index + 1,
            repo: row.repo,
            description: row.description,
            language: row.language,
            stars: row.stars,
            forks: row.forks,
            starsSince: row.starsSince,
            url: row.url,
        }));
    },
});
