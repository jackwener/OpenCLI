import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid } from './utils.js';

cli({
  site: 'bilibili',
  name: 'video',
  description: 'Get Bilibili video metadata (title, author, duration, stats, etc.)',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'bvid', required: true, positional: true, help: 'BV ID, video URL, or b23.tv short link' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    if (!page) {
      throw new CommandExecutionError('Browser session required for bilibili video');
    }
    const bvid = await resolveBvid(kwargs.bvid);

    // Navigate to video page first so subsequent api call shares a primed session.
    await page.goto(`https://www.bilibili.com/video/${bvid}/`);

    const payload = await apiGet(page, '/x/web-interface/view', {
      params: { bvid },
    });
    if (payload.code !== 0) {
      throw new CommandExecutionError(`Bilibili view API failed: ${payload.message} (${payload.code})`);
    }

    const d = payload.data || {};
    const stat = d.stat || {};
    const owner = d.owner || {};

    const pubDate = d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';
    const dur = d.duration || 0;
    const mm = Math.floor(dur / 60);
    const ss = dur % 60;
    const desc = (d.desc || '').replace(/\s+/g, ' ').trim();
    const descTrunc = desc.length > 200 ? desc.slice(0, 200) + '…' : desc;

    return [
      { field: 'bvid',         value: d.bvid ?? '' },
      { field: 'aid',          value: String(d.aid ?? '') },
      { field: 'title',        value: d.title ?? '' },
      { field: 'author',       value: owner.name ? `${owner.name} (mid: ${owner.mid})` : '' },
      { field: 'category',     value: d.tname_v2 || d.tname || '' },
      { field: 'publish_time', value: pubDate },
      { field: 'duration',     value: dur ? `${mm}m${ss}s (${dur}s)` : '' },
      { field: 'view',         value: String(stat.view ?? '') },
      { field: 'danmaku',      value: String(stat.danmaku ?? '') },
      { field: 'reply',        value: String(stat.reply ?? '') },
      { field: 'like',         value: String(stat.like ?? '') },
      { field: 'coin',         value: String(stat.coin ?? '') },
      { field: 'favorite',     value: String(stat.favorite ?? '') },
      { field: 'share',        value: String(stat.share ?? '') },
      { field: 'parts',        value: String(d.videos ?? 1) },
      { field: 'thumbnail',    value: d.pic ?? '' },
      { field: 'description',  value: descTrunc },
    ];
  },
});
