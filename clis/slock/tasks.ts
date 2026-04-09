import { cli, Strategy } from '@jackwener/opencli/registry';
import { getSlockContext, resolveChannelId } from './utils.js';

cli({
  site: 'slock',
  name: 'tasks',
  description: '列出 Slock 频道任务',
  domain: 'app.slock.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', type: 'str', required: true, positional: true, help: '频道名称（如 general）或频道 ID' },
    { name: 'server', type: 'str', required: false, help: '工作空间 slug（默认用上次使用的）' },
    { name: 'limit', type: 'int', default: 20, help: '任务数量' },
  ],
  columns: ['status', 'content', 'claimedBy', 'createdAt'],
  func: async (page, kwargs) => {
    await page.goto('https://app.slock.ai');

    const ctx = await getSlockContext(page, kwargs.server || null);
    if ('error' in ctx) return [ctx];

    const channelId = await resolveChannelId(page, kwargs.channel, ctx.h);
    if (typeof channelId !== 'string') return [channelId];

    const tasks = await page.evaluate(`(async () => {
      const h = ${JSON.stringify(ctx.h)};
      const res = await fetch('https://api.slock.ai/api/tasks/channel/${channelId}', { headers: h });
      return res.json();
    })()`);

    if ((tasks as any)?.error) return [tasks];
    return (tasks as any[]).slice(0, kwargs.limit).map(t => ({
      status: t.status,
      content: (t.content || t.message?.content || '').replace(/\n/g, ' ').substring(0, 100),
      claimedBy: t.claimedBy?.displayName || t.claimedBy?.name || '',
      createdAt: t.createdAt?.substring(0, 10),
    }));
  },
});
