// Shared helpers for the bbc adapters that hit BBC's public RSS feeds.
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const BBC_FEED_BASE = 'https://feeds.bbci.co.uk/news';
const UA = 'opencli-bbc-adapter (+https://github.com/jackwener/opencli)';

const HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

export function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => HTML_ENTITIES[m] || m);
}

/** Extract `<tag>…</tag>` (CDATA-aware) from a block. */
export function extractRssTag(block, tag) {
    const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`));
    if (cdata) return cdata[1];
    const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return plain ? plain[1] : '';
}

export function parseRssItems(xml) {
    const out = [];
    const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) {
        const block = m[1];
        out.push({
            title: decodeHtmlEntities(extractRssTag(block, 'title')).trim(),
            description: decodeHtmlEntities(extractRssTag(block, 'description')).trim(),
            link: decodeHtmlEntities(extractRssTag(block, 'link')).trim(),
            pubDate: decodeHtmlEntities(extractRssTag(block, 'pubDate')).trim(),
            guid: decodeHtmlEntities(extractRssTag(block, 'guid')).trim(),
        });
    }
    return out;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`bbc ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`bbc ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function bbcFetchRss(path, label) {
    const url = `${BBC_FEED_BASE}/${path}`;
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that feeds.bbci.co.uk is reachable from this network.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status} (${url})`);
    }
    return resp.text();
}

/** Convert RFC-822 pubDate to ISO `YYYY-MM-DD`; empty string on parse failure. */
export function pubDateToIso(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
}
