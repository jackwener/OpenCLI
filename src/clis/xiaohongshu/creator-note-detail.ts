/**
 * Xiaohongshu Creator Note Detail — per-note analytics breakdown.
 *
 * Uses the creator.xiaohongshu.com internal API (cookie auth).
 * Returns total reads, engagement, likes, collects, comments, shares
 * for a specific note, split by channel (organic vs promoted vs video).
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'creator-note-detail',
  description: '小红书单篇笔记详细数据 (阅读/互动/点赞/收藏/评论/分享，区分自然流量/推广/视频)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'note_id', type: 'string', required: true, help: 'Note ID (from note URL or creator-notes command)' },
  ],
  columns: ['channel', 'reads', 'engagement', 'likes', 'collects', 'comments', 'shares'],
  func: async (page, kwargs) => {
    const noteId: string = kwargs.note_id;

    // Navigate for cookie context
    await page.goto('https://creator.xiaohongshu.com/new/home');
    await page.wait(2);

    const data = await page.evaluate(`
      async () => {
        try {
          const resp = await fetch(
            '/api/galaxy/creator/data/note_detail?note_id=${noteId}',
            { credentials: 'include' }
          );
          if (!resp.ok) return { error: 'HTTP ' + resp.status };
          return await resp.json();
        } catch (e) {
          return { error: e.message };
        }
      }
    `);

    if (data?.error) {
      throw new Error(data.error + '. Check note_id and login status.');
    }
    if (!data?.data) {
      throw new Error('Unexpected response structure');
    }

    const d = data.data;

    return [
      {
        channel: 'Total',
        reads: d.total_read ?? 0,
        engagement: d.total_engage ?? 0,
        likes: d.total_like ?? 0,
        collects: d.total_fav ?? 0,
        comments: d.total_cmt ?? 0,
        shares: d.total_share ?? 0,
      },
      {
        channel: 'Organic',
        reads: d.normal_read ?? 0,
        engagement: d.normal_engage ?? 0,
        likes: d.normal_like ?? 0,
        collects: d.normal_fav ?? 0,
        comments: d.normal_cmt ?? 0,
        shares: d.normal_share ?? 0,
      },
      {
        channel: 'Promoted',
        reads: d.total_promo_read ?? 0,
        engagement: 0,
        likes: 0,
        collects: 0,
        comments: 0,
        shares: 0,
      },
      {
        channel: 'Video',
        reads: d.video_read ?? 0,
        engagement: d.video_engage ?? 0,
        likes: d.video_like ?? 0,
        collects: d.video_fav ?? 0,
        comments: d.video_cmt ?? 0,
        shares: d.video_share ?? 0,
      },
    ];
  },
});
