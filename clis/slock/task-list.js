// task-list.js
//
// GET /api/tasks/channel/:channelId[?status=<status>]
//
// Chat tasks are messages with task fields (taskStatus / taskNumber / content),
// not a separate table. Server unwraps responses as `{tasks: [...]}`. The
// previous `--v2` flag and `/api/tasks/v2/` fallback were both dead — removed.
//
// Filtering: pass --status to narrow server-side; one of
//   todo | in_progress | in_review | done | closed.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'closed'];

cli({
  site: SLOCK_SITE,
  name: 'task-list',
  access: 'read',
  description: 'List tasks (chat tasks = messages with task fields) attached to a channel. Optional --status filter.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'status', help: `Filter by status: ${TASK_STATUSES.join('|')}` },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'taskNumber', 'title', 'taskStatus', 'assigneeId'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const status = kwargs.status ? String(kwargs.status).trim() : '';
    if (status && !TASK_STATUSES.includes(status)) {
      throw new ArgumentError(`status "${status}" not in {${TASK_STATUSES.join('|')}}`);
    }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      const status = ${JSON.stringify(status)};
      const qs = status ? ('?status=' + encodeURIComponent(status)) : '';
      const tres = await fetch('${SLOCK_API_BASE}/tasks/channel/' + encodeURIComponent(channelId) + qs, { credentials:'include', headers });
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where: '/tasks/channel/:id' };
      const data = await tres.json();
      // Server contract: { tasks: [...] }. Reject anything else as drift.
      if (!data || !Array.isArray(data.tasks)) {
        return { kind: 'http', status: 200, where: '/tasks/channel/:id (expected {tasks:[]}, got drift)' };
      }
      return { kind: 'ok', rows: data.tasks };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((t) => ({
      id: t.id ?? '',
      taskNumber: t.taskNumber ?? null,
      title: t.content ?? t.title ?? '',
      taskStatus: t.taskStatus ?? t.status ?? '',
      assigneeId: t.claimedById ?? t.assigneeId ?? null,
    }));
  },
});
