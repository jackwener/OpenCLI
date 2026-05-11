// medium tag — Medium articles for a tag, newest first, via the public
// RSS feed at `https://medium.com/feed/tag/<tag>`.
//
// Complements existing `medium feed` (per-publication / per-user) and
// `medium search` by surfacing topical streams.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

const HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

function decodeHtml(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => HTML_ENTITIES[m] || m);
}

function extractTag(block, tag) {
    const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`));
    if (cdata) return cdata[1];
    const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return plain ? plain[1] : '';
}

function extractCategories(block) {
    const out = [];
    const re = /<category(?:[^>]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/category>/g;
    let m;
    while ((m = re.exec(block)) !== null) {
        const v = decodeHtml((m[1] ?? m[2] ?? '').trim());
        if (v) out.push(v);
    }
    return out;
}

function isoDateFromRfc822(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
}

function stripHtml(value) {
    return decodeHtml(String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function requireTag(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) {
        throw new ArgumentError('medium tag is required (e.g. "programming", "javascript")');
    }
    if (!TAG_PATTERN.test(s)) {
        throw new ArgumentError(
            `medium tag "${value}" is not valid`,
            'Tags are lowercase alphanumeric, optionally hyphenated (e.g. "machine-learning").',
        );
    }
    return s;
}

function requireBoundedInt(value, defaultValue, maxValue) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError('medium limit must be a positive integer');
    }
    if (n > maxValue) {
        throw new ArgumentError(`medium limit must be <= ${maxValue}`);
    }
    return n;
}

cli({
    site: 'medium',
    name: 'tag',
    access: 'read',
    description: 'Latest Medium articles tagged with a given keyword (RSS feed)',
    domain: 'medium.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'tag', positional: true, required: true, help: 'Lowercase tag slug (e.g. "programming", "machine-learning")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max articles (1-25 — single RSS page)' },
    ],
    columns: ['rank', 'title', 'author', 'description', 'categories', 'published', 'url'],
    func: async (args) => {
        const tag = requireTag(args.tag);
        const limit = requireBoundedInt(args.limit, 20, 25);
        const url = `https://medium.com/feed/tag/${tag}`;
        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'user-agent': 'opencli-medium-adapter (+https://github.com/jackwener/opencli)',
                    accept: 'application/rss+xml, application/xml',
                },
            });
        }
        catch (err) {
            throw new CommandExecutionError(
                `medium tag request failed: ${err?.message ?? err}`,
                'Check that medium.com is reachable from this network.',
            );
        }
        if (resp.status === 404) {
            throw new EmptyResultError('medium tag', `Medium tag "${tag}" does not exist.`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`medium tag returned HTTP ${resp.status}`);
        }
        const xml = await resp.text();
        const items = [];
        const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
            items.push(m[1]);
        }
        if (!items.length) {
            throw new EmptyResultError('medium tag', `Medium tag "${tag}" RSS feed has no items.`);
        }
        return items.slice(0, limit).map((block, i) => ({
            rank: i + 1,
            title: decodeHtml(extractTag(block, 'title')).trim(),
            author: decodeHtml(extractTag(block, 'dc:creator')).trim(),
            description: stripHtml(extractTag(block, 'description')),
            categories: extractCategories(block).join(', '),
            published: isoDateFromRfc822(decodeHtml(extractTag(block, 'pubDate')).trim()),
            url: decodeHtml(extractTag(block, 'link')).trim(),
        }));
    },
});
