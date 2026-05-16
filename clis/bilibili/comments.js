/**
 * Bilibili comments — fetches comments via the official API.
 * Top-level comments come from /x/v2/reply/main (WBI-signed); with --parent,
 * the replies nested under a given comment come from /x/v2/reply/reply.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, resolveBvid } from './utils.js';
cli({
    site: 'bilibili',
    name: 'comments',
    access: 'read',
    description: '获取 B站视频评论（官方 API；用 --parent <rpid> 读取某条评论下的「楼中楼」回复）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Video BV ID (e.g. BV1WtAGzYEBm)' },
        { name: 'parent', type: 'int', help: 'rpid of a comment — fetch the replies under it instead of top-level comments' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'replies', 'time'],
    func: async (page, kwargs) => {
        const bvid = await resolveBvid(kwargs.bvid);
        const limit = Math.min(Number(kwargs.limit) || 20, 50);
        // Resolve bvid → aid (required by reply API)
        const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        const aid = view?.data?.aid;
        if (!aid)
            throw new Error(`Cannot resolve aid for bvid: ${bvid}`);
        const payload = kwargs.parent != null
            ? await apiGet(page, '/x/v2/reply/reply', {
                params: { oid: aid, type: 1, root: Number(kwargs.parent), pn: 1, ps: limit },
            })
            : await apiGet(page, '/x/v2/reply/main', {
                params: { oid: aid, type: 1, mode: 3, ps: limit },
                signed: true,
            });
        const replies = payload?.data?.replies ?? [];
        return replies.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            author: r.member?.uname ?? '',
            text: (r.content?.message ?? '').replace(/\n/g, ' ').trim(),
            likes: r.like ?? 0,
            replies: r.rcount ?? 0,
            time: new Date(r.ctime * 1000).toISOString().slice(0, 16).replace('T', ' '),
        }));
    },
});
