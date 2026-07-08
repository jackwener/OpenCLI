// Xiaoe (小鹅通) content extractor — pulls rendered article text from a
// rich-text page (h5.xet.citv.cn).
//
// Replaces the legacy `pipeline:[]` form. Two real bugs in the legacy
// adapter, both silent:
//   1. The IIFE returned `{title, content, content_length, image_count,
//      images}` but `columns` declared `[title, content_length,
//      image_count]` — `content` (the text the adapter exists to
//      extract!) and `images` were silently dropped before reaching the
//      caller. The user got "this article has 1234 chars" with no way
//      to read those chars.
//   2. `JSON.stringify(images.slice(0, 20))` silently truncated to the
//      first 20 image URLs and never told the caller the slice
//      happened.
//
// New behavior:
//   - `func` form + `Strategy.COOKIE` + `browser:true` (the page is
//     gated behind a logged-in xiaoe session).
//   - Pure helpers `pickContentText` / `countXiaoeImages` are
//     module-level exports; the in-page IIFE embeds them via
//     `${fn.toString()}` while JSDOM tests call the same exports
//     directly against a hand-crafted fixture (same pattern as
//     dianping #1313 / hupu #1387).
//   - `content` is now a real column (the bug fix). `image_count` is
//     metadata that helps callers decide whether to re-render the
//     page for a JSON-image dump in a follow-up adapter.
//   - Empty-content extraction → `EmptyResultError` with a
//     login-likely hint (xiaoe routinely renders an empty shell when
//     the cookie has expired). No silent `return [{ content: '' }]`.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const CONTENT_SELECTORS = [
    '.rich-text-wrap',
    '.content-wrap',
    '.article-content',
    '.text-content',
    '.course-detail',
    '.detail-content',
    '[class*="richtext"]',
    '[class*="rich-text"]',
    '.ql-editor',
];
export const CONTENT_MIN_LENGTH = 50;

// Pure: walk `selectors` in order, return the trimmed text of the first
// element whose `.innerText` (with `.textContent` fallback for JSDOM)
// has more than `minLength` characters. Falls back to `<main>`, then
// `#app`, then `<body>` — same chain the legacy IIFE used.
export function pickContentText(doc, selectors, minLength = CONTENT_MIN_LENGTH) {
    for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        const text = ((el.innerText || el.textContent) || '').trim();
        if (text.length > minLength) return text;
    }
    const fallback = doc.querySelector('main')
        || doc.querySelector('#app')
        || doc.body;
    if (!fallback) return '';
    return ((fallback.innerText || fallback.textContent) || '').trim();
}

// Pure: count `<img>` elements whose src looks like a real xiaoe-hosted
// asset. `data:` URIs and non-xiaoe CDNs (avatars, ads) are excluded.
export function countXiaoeImages(doc) {
    let count = 0;
    const imgs = doc.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i += 1) {
        const src = imgs[i].getAttribute('src') || imgs[i].src || '';
        if (!src) continue;
        if (src.startsWith('data:')) continue;
        if (!src.includes('xiaoe')) continue;
        count += 1;
    }
    return count;
}

export function requireXiaoePageUrl(value, commandName) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        throw new ArgumentError('url is required (positional)');
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new ArgumentError(
            `invalid xiaoe URL: ${raw}`,
            `Example: opencli xiaoe ${commandName} https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx`,
        );
    }
    if (parsed.protocol !== 'https:') {
        throw new ArgumentError(
            `xiaoe URL must use https (got ${parsed.protocol.replace(':', '')})`,
            `Example: opencli xiaoe ${commandName} https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx`,
        );
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'h5.xet.citv.cn' && !host.endsWith('.h5.xet.citv.cn')) {
        throw new ArgumentError(
            `url must be on h5.xet.citv.cn or a shop subdomain (got ${parsed.hostname})`,
            `Example: opencli xiaoe ${commandName} https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx`,
        );
    }
    return parsed.toString();
}

export function buildContentScript() {
    return `
(() => {
  ${pickContentText.toString()}
  ${countXiaoeImages.toString()}
  const selectors = ${JSON.stringify(CONTENT_SELECTORS)};
  const title = document.title || '';
  const content = pickContentText(document, selectors, ${JSON.stringify(CONTENT_MIN_LENGTH)});
  const imageCount = countXiaoeImages(document);
  return [{
    title,
    content,
    content_length: content.length,
    image_count: imageCount,
  }];
})()
`;
}

async function getXiaoeContent(page, args) {
    const url = requireXiaoePageUrl(args.url, 'content');
    let rows;
    try {
        await page.goto(url, { waitUntil: 'load', settleMs: 6000 });
        rows = await page.evaluate(buildContentScript());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(
            `Failed to extract xiaoe content: ${message}`,
            'page may not have rendered or auth may be required',
        );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(
            'xiaoe/content',
            'No rows returned from page evaluator (page structure may have changed)',
        );
    }
    const row = rows[0];
    if (!row || typeof row.content !== 'string' || row.content.length === 0) {
        throw new EmptyResultError(
            'xiaoe/content',
            'No article content extracted — login session may have expired or the page renders an empty shell',
        );
    }
    return rows;
}

export const contentCommand = cli({
    site: 'xiaoe',
    name: 'content',
    access: 'read',
    description: '提取小鹅通图文页面内容为文本',
    domain: 'h5.xet.citv.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: '页面 URL' },
    ],
    columns: ['title', 'content', 'content_length', 'image_count'],
    func: getXiaoeContent,
});

export const __test__ = {
    buildContentScript,
};
