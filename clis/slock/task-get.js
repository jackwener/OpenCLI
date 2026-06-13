// task-get.js
//
// GET /api/tasks/channel/:channelId/number/:taskNumber.
//
// Source-verified (Bugen §Phase 9): the path is /number/:taskNumber, not
// the bare /:taskNumber. taskNumber is the per-channel sequential number
// shown in chat (e.g. "task #7").

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { parsePositiveInteger } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-get',
  access: 'read',
  description: 'Fetch a task by channel + taskNumber (GET /tasks/channel/:channelId/number/:taskNumber).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'number', positional: true, required: true, help: 'taskNumber (per-channel integer, as shown in "task #N")' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'taskNumber', 'title', 'taskStatus', 'assigneeId'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const numRaw = String(kwargs.number ?? '').trim();
    if (!/^\d+$/.test(numRaw)) throw new ArgumentError(`number "${numRaw}" is not a positive integer`);
    const number = parsePositiveInteger(numRaw, 'number');
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      const res = await fetch('${SLOCK_API_BASE}/tasks/channel/' + encodeURIComponent(channelId) + '/number/' + encodeURIComponent(${JSON.stringify(String(number))}), { credentials:'include', headers });
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/channel/:id/number/:n (task #' + ${JSON.stringify(number)} + ' not found in channel)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/channel/:id/number/:n' };
      const data = await res.json().catch(() => ({}));
      // Single object or {task: ...} wrapped — accept either.
      const task = data && data.task ? data.task : data;
      return { kind: 'ok', rows: [task] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      id: t.id ?? '',
      taskNumber: t.taskNumber ?? number,
      title: t.content ?? t.title ?? '',
      taskStatus: t.taskStatus ?? t.status ?? '',
      assigneeId: t.claimedById ?? t.assigneeId ?? null,
    }));
  },
});
