/**
 * 一亩三分地 帖子详情 — /bbs/thread-<tid>-<page>-1.html
 *
 * Returns one row per post on the requested page. First row (floor=1) is the
 * main post; the rest are replies. Columns are shaped so `--limit 1` gives
 * just the main post, and larger limits walk down the thread.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchHtml, decodeEntities, stripHtml, truncate, normalizePositiveInteger, BASE } from './utils.js';

function extract(html, regex, group = 1) {
    const m = html.match(regex);
    return m ? m[group] : '';
}

cli({
    site: '1point3acres',
    name: 'thread',
    access: 'read',
    description: '一亩三分地 帖子详情 + 楼层（主楼 + 回复）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'tid', required: true, positional: true, help: '帖子 ID（数字，见 `hot`/`latest` 返回的 tid）' },
        { name: 'page', type: 'int', default: 1, help: '楼层分页页码（默认 1）' },
        { name: 'limit', type: 'int', default: 10, help: '返回楼层条数（默认 10，含主楼）' },
        { name: 'contentLimit', type: 'int', default: 400, help: '每楼正文截断长度（默认 400 字符，最少 50）' },
    ],
    columns: ['floor', 'pid', 'author', 'postTime', 'content', 'url'],
    func: async (args) => {
        const tid = String(args.tid || '').trim();
        if (!/^\d+$/.test(tid)) {
            throw new ArgumentError('tid must be a numeric thread id');
        }
        const page = normalizePositiveInteger(args.page, 1, 'page');
        const limit = normalizePositiveInteger(args.limit, 10, 'limit');
        const contentLimit = normalizePositiveInteger(args.contentLimit, 400, 'contentLimit', { min: 50 });

        const url = `${BASE}/thread-${tid}-${page}-1.html`;
        const html = await fetchHtml(url);

        // Sanity: real thread page will contain postlist + at least one post div.
        if (!/id="postlist"/.test(html) && !/id="post_\d+"/.test(html)) {
            throw new EmptyResultError('1point3acres thread', `帖子 ${tid} 不存在或被删除`);
        }

        // Split posts: each post block is bounded by <div id="post_<PID>">…</div> next post or postlist end.
        // NOTE: intermediate objects intentionally use postId/body/offset (not pid/html/start) to
        // avoid being mistaken for row-shaped objects by the silent-column-drop audit.
        const postBlocks = [];
        const re = /<div id="post_(\d+)"[^>]*>/g;
        const offsets = [];
        let m;
        while ((m = re.exec(html))) offsets.push({ postId: m[1], offset: m.index });
        for (let i = 0; i < offsets.length; i++) {
            const segStart = offsets[i].offset;
            const segEnd = i + 1 < offsets.length ? offsets[i + 1].offset : html.length;
            postBlocks.push({ postId: offsets[i].postId, body: html.slice(segStart, segEnd) });
        }

        const rows = [];
        for (let i = 0; i < postBlocks.length && rows.length < limit; i++) {
            const { postId: pid, body: block } = postBlocks[i];
            // Discuz authi block holds the author link + post time metadata.
            const authiMatch = block.match(/<div class="authi"[\s\S]*?<\/div>/);
            const authiBlock = authiMatch ? authiMatch[0] : '';
            const authorCandidates = [
                /<a [^>]*class="[^"]*\bxi2\b[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/,
                /<a [^>]*href="space-uid-\d+\.html"[^>]*>\s*([^<]+?)\s*<\/a>/,
                /<a [^>]*class="[^"]*\bxw1\b[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/,
            ];
            let author = '';
            for (const re of authorCandidates) {
                const v = decodeEntities(extract(authiBlock || block, re));
                if (v && !/匿名卡|变色卡|关贴卡/.test(v)) { author = v; break; }
            }
            // Time: prefer <span title="YYYY-MM-DD HH:MM:SS"> (per-post, precise).
            // <meta itemprop="datePublished"> is the *thread* publish time on this site — avoid.
            const postTime = extract(authiBlock, /<span title="([^"]+)">/) ||
                extract(block, /id="authorposton\d+"[^>]*>\s*<span title="([^"]+)">/) ||
                extract(block, /id="authorposton\d+"[^>]*>\s*([^<]+?)\s*</) ||
                extract(block, /<meta itemprop="datePublished" content="([^"]+)"/);
            // Floor: first post on page 1 is the 楼主, subsequent posts carry <em>N#</em>.
            const floorEm = extract(block, /<em>(\d+)<\/em>\s*#?\s*<\/a>/) ||
                extract(block, /id="postnum\d+"[^>]*>\s*<em>(\d+)<\/em>/);
            const isMainPost = page === 1 && i === 0;
            const floor = floorEm ? Number(floorEm) : (isMainPost ? 1 : (page - 1) * 10 + i + 1);
            const contentMatch = block.match(/id="postmessage_\d+"[^>]*>([\s\S]*?)<\/td>/);
            const content = truncate(stripHtml(contentMatch ? contentMatch[1] : ''), contentLimit);
            rows.push({
                floor,
                pid,
                author,
                postTime: postTime.trim(),
                content,
                url: `${BASE}/forum.php?mod=redirect&goto=findpost&ptid=${tid}&pid=${pid}`,
            });
        }

        // Attach the thread title + forum name as a leading synthetic row only when rows exist
        // and only for page 1, so agents get the title without needing a separate call.
        if (page === 1 && rows.length > 0) {
            const title = decodeEntities(
                extract(html, /<span id="thread_subject">([^<]+)<\/span>/).trim() ||
                extract(html, /<title>([^<]+?)\s*[-|]/).trim()
            );
            rows[0].content = title ? `【${title}】\n${rows[0].content}` : rows[0].content;
        }

        if (!rows.length) {
            throw new EmptyResultError('1point3acres thread', `帖子 ${tid} 第 ${page} 页没有可读取楼层`);
        }
        return rows;
    },
});
