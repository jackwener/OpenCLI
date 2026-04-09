import { cli, Strategy } from '@jackwener/opencli/registry';
import { getSlockContext } from './utils.js';

cli({
  site: 'slock',
  name: 'members',
  description: '列出 Slock 工作空间成员',
  domain: 'app.slock.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'server', type: 'str', required: false, help: '工作空间 slug（默认用上次使用的）' },
    { name: 'limit', type: 'int', default: 50, help: '成员数量' },
  ],
  columns: ['displayName', 'name', 'role', 'joinedAt'],
  func: async (page, kwargs) => {
    await page.goto('https://app.slock.ai');

    const ctx = await getSlockContext(page, kwargs.server || null);
    if ('error' in ctx) return [ctx];

    const members = await page.evaluate(`(async () => {
      const h = ${JSON.stringify(ctx.h)};
      const res = await fetch('https://api.slock.ai/api/servers/${ctx.server.id}/members', { headers: h });
      return res.json();
    })()`);

    if ((members as any)?.error) return [members];
    return (members as any[]).slice(0, kwargs.limit).map(m => ({
      displayName: m.displayName || m.name,
      name: m.name,
      role: m.role,
      joinedAt: m.joinedAt?.substring(0, 10),
    }));
  },
});
