import { cli, Strategy } from '@jackwener/opencli/registry';
import { getSlockContext, resolveChannelId } from './utils.js';

cli({
  site: 'slock',
  name: 'send',
  description: '发送消息到 Slock 频道',
  domain: 'app.slock.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', type: 'str', required: true, positional: true, help: '频道名称（如 general）或频道 ID' },
    { name: 'message', type: 'str', required: true, help: '消息内容' },
    { name: 'server', type: 'str', required: false, help: '工作空间 slug（默认用上次使用的）' },
  ],
  columns: ['id', 'channel', 'content', 'createdAt'],
  func: async (page, kwargs) => {
    await page.goto('https://app.slock.ai');

    const ctx = await getSlockContext(page, kwargs.server || null);
    if ('error' in ctx) return [ctx];

    const channelId = await resolveChannelId(page, kwargs.channel, ctx.h);
    if (typeof channelId !== 'string') return [channelId];

    const msg = await page.evaluate(`(async () => {
      const h = { ...${JSON.stringify(ctx.h)}, 'Content-Type': 'application/json' };
      const res = await fetch('https://api.slock.ai/api/messages', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ channelId: ${JSON.stringify(channelId)}, content: ${JSON.stringify(kwargs.message)} }),
      });
      return res.json();
    })()`);

    if ((msg as any)?.error) return [msg];
    const m = msg as any;
    return [{
      id: m.id,
      channel: kwargs.channel,
      content: (m.content || '').substring(0, 100),
      createdAt: m.createdAt?.substring(0, 16).replace('T', ' '),
    }];
  },
});
