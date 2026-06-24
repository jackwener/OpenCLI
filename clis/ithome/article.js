/**
 * ithome article — full text of an IT之家 article.
 *
 * Fetches the SSR page `www.ithome.com/0/<dir>/<id>.htm` and reads the title,
 * keywords and the `post_content` body, returned as a readable 标题 / 标签 /
 * 正文 field-value sheet (one row per body paragraph). Takes a newsid (from
 * `news` / `rank`) or a full article URL.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ARTICLE_COLUMNS,
    clean,
    stripHtml,
    normalizeArticle,
    ihFetchHtml,
} from './utils.js';

/**
 * Pure parser: article HTML → [{field, value}] rows. Exported for unit testing.
 *
 * Emits 标题 (from <title>, minus the " - IT之家" suffix) and 标签 (the keywords
 * meta), then one 正文 row per `<p>` paragraph inside `post_content`. The body
 * region is bounded before the related/comment sections so their text isn't
 * scraped.
 */
export function parseArticleRows(html) {
    const text = String(html || '');
    const rows = [];

    const title = clean(text.match(/<title>([\s\S]*?)<\/title>/)?.[1]).replace(/\s*-\s*IT之家\s*$/, '');
    if (title) rows.push({ field: '标题', value: title });

    const kw = clean(text.match(/<meta[^>]+name="keywords"[^>]+content="([^"]*)"/i)?.[1]);
    if (kw) rows.push({ field: '标签', value: kw });

    const start = text.search(/class="post_content/);
    if (start >= 0) {
        let seg = text.slice(start);
        const end = seg.search(/id="commentlist"|class="related|class="comment|<\/article>/);
        if (end > 0) seg = seg.slice(0, end);
        const paras = [...seg.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
            .map((m) => stripHtml(m[1]))
            .filter((t) => t && t.length > 1);
        for (const p of paras) rows.push({ field: '正文', value: p });
        // Fallback: no <p> structure — dump the whole body as one paragraph.
        if (paras.length === 0) {
            const body = stripHtml(seg);
            if (body) rows.push({ field: '正文', value: body });
        }
    }
    return rows;
}

cli({
    site: 'ithome',
    name: 'article',
    access: 'read',
    aliases: ['read'],
    description: 'IT之家文章正文（按 newsid 或文章 URL 返回标题 / 标签 / 正文段落）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'article', required: true, positional: true, help: 'newsid（来自 news/rank）或文章 URL，如 www.ithome.com/0/968/068.htm' },
    ],
    columns: ARTICLE_COLUMNS,
    func: async (args) => {
        const { url, newsid } = normalizeArticle(args.article);
        const html = await ihFetchHtml(url, `article ${newsid}`);
        const rows = parseArticleRows(html);
        const hasBody = rows.some((r) => r.field === '正文');
        if (!hasBody) {
            throw new EmptyResultError(
                `ithome article ${newsid}`,
                'No article body found — the newsid/URL may be wrong or the article was removed.',
            );
        }
        return rows;
    },
});
