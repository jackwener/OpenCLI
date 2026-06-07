// task-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'task-list',
  access: 'read',
  description: 'List tasks attached to a channel',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'v2', type: 'bool', default: false, help: 'Use /tasks/v2 endpoint' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'title', 'status', 'dueAt'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const endpoint = kwargs.v2 ? '/api/tasks/v2/channel/' : '/api/tasks/channel/';
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      const tres = await fetch(${JSON.stringify(endpoint)} + encodeURIComponent(channelId), { credentials:'include', headers });
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where: ${JSON.stringify(endpoint + ':id')} };
      const data = await tres.json();
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.tasks || data.data || []) };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((t) => ({
      id: t.id ?? '',
      title: t.title ?? t.name ?? '',
      status: t.status ?? '',
      dueAt: t.dueAt ?? t.due_at ?? null,
    }));
  },
});
