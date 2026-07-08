/**
 * Xiaohongshu note — read full note content from a public note page.
 *
 * Extracts title, author, description text, and engagement metrics
 * (likes, collects, comment count) via DOM extraction.
 *
 * Requires a full Xiaohongshu note URL with xsec_token.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';
/**
 * Host-agnostic IIFE that scrapes note title / author / counts / tags from a
 * rendered note detail page. Exported so the rednote adapter can reuse the
 * exact same selector set without copying it.
 */
export const NOTE_EXTRACT_JS = `
      (() => {
        const bodyText = document.body?.innerText || ''
        const loginWall = /登录后查看|请登录/.test(bodyText)
        const notFound = /页面不见了|笔记不存在|无法浏览/.test(bodyText)
        const securityBlock = /安全限制|访问链接异常/.test(bodyText)
          || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href)

        const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim()

        const title = clean(document.querySelector('#detail-title, .title'))
        const desc = clean(document.querySelector('#detail-desc, .desc, .note-text'))
        const author = clean(document.querySelector('.username, .author-wrapper .name'))
        // Scope to .interact-container — the post's main interaction bar.
        // Without scoping, .like-wrapper / .chat-wrapper also match each
        // comment's like/reply buttons in the comment section, and
        // querySelector returns the FIRST match (a comment's count, not the
        // post's). The post's true counts live inside .interact-container.
        const likes = clean(document.querySelector('.interact-container .like-wrapper .count'))
        const collects = clean(document.querySelector('.interact-container .collect-wrapper .count'))
        const comments = clean(document.querySelector('.interact-container .chat-wrapper .count'))

        // Try to extract tags/topics
        const tags = []
        document.querySelectorAll('#detail-desc a.tag, #detail-desc a[href*="search_result"]').forEach(el => {
          const t = (el.textContent || '').trim()
          if (t) tags.push(t)
        })

        return { pageUrl: location.href, securityBlock, loginWall, notFound, title, desc, author, likes, collects, comments, tags }
      })()
    `;
export const command = cli({
    site: 'xiaohongshu',
    name: 'note',
    access: 'read',
    description: '获取小红书笔记正文和互动数据',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Full Xiaohongshu note URL with xsec_token' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        const url = buildNoteUrl(raw, { commandName: 'xiaohongshu note' });
        await page.goto(url);
        await page.wait({ time: 2 + Math.random() * 3 });
        const data = await page.evaluate(NOTE_EXTRACT_JS);
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('xiaohongshu/note', 'Unexpected evaluate response');
        }
        if (data.securityBlock) {
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Note content requires login');
        }
        if (data.notFound) {
            throw new EmptyResultError('xiaohongshu/note', `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
        }
        const d = data;
        // XHS renders placeholder text like "赞"/"收藏"/"评论" when count is 0;
        // normalize to '0' unless the value looks numeric.
        const numOrZero = (v) => /^\d+/.test(v) ? v : '0';
        // Title + author are always present on a real note page.
        // If both are missing, the page likely failed to load properly.
        if (!d.title && !d.author) {
            throw new EmptyResultError('xiaohongshu/note', 'The note page loaded without visible content. The note may be deleted or restricted.');
        }
        const rows = [
            { field: 'title', value: d.title || '' },
            { field: 'author', value: d.author || '' },
            { field: 'content', value: d.desc || '' },
            { field: 'likes', value: numOrZero(d.likes || '') },
            { field: 'collects', value: numOrZero(d.collects || '') },
            { field: 'comments', value: numOrZero(d.comments || '') },
        ];
        if (d.tags?.length) {
            rows.push({ field: 'tags', value: d.tags.join(', ') });
        }
        return rows;
    },
});
