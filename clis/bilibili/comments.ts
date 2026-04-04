/**
 * Bilibili comments — fetches top-level replies via the official API with WBI signing.
 * Uses the /x/v2/reply/main endpoint which is stable and doesn't depend on DOM structure.
 */

import { cli, Strategy } from '../../registry.js';
import { apiGet, resolveBvid } from './utils.js';

cli({
  site: 'bilibili',
  name: 'comments',
  description: '获取 B站视频评论（使用官方 API + WBI 签名）',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'bvid', required: true, positional: true, help: 'Video BV ID (e.g. BV1WtAGzYEBm)' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
  ],
  columns: ['rank', 'author', 'text', 'likes', 'replies', 'time'],
  func: async (page, kwargs) => {
    const bvid = await resolveBvid(kwargs.bvid);
    const limit = Math.min(Number(kwargs.limit) || 20, 50);

    // Resolve bvid → aid (required by reply API)
    const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
    const aid = view?.data?.aid;
    if (!aid) throw new Error(`Cannot resolve aid for bvid: ${bvid}`);

    const payload = await apiGet(page, '/x/v2/reply/main', {
      params: { oid: aid, type: 1, mode: 3, ps: limit },
      signed: true,
    });

    const replies: any[] = payload?.data?.replies ?? [];
    return replies.slice(0, limit).map((r: any, i: number) => ({
      rank: i + 1,
      author: r.member?.uname ?? '',
      text: (r.content?.message ?? '').replace(/\n/g, ' ').trim(),
      likes: r.like ?? 0,
      replies: r.rcount ?? 0,
      time: new Date(r.ctime * 1000).toISOString().slice(0, 16).replace('T', ' '),
    }));
  },
});
