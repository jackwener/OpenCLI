// task-list-server.js
//
// GET /api/tasks/server[?status=<status>] — server-wide task feed.
//
// Source-verified (Bugen §Phase 9). Different from `task-list` which is
// channel-scoped; this one returns tasks across all channels in the active
// server. Same {tasks:[...]} response wrap.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'closed'];

cli({
  site: SLOCK_SITE,
  name: 'task-list-server',
  access: 'read',
  description: 'List tasks across all channels in the active server (GET /tasks/server). Optional --status filter.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'status', help: `Filter by status: ${TASK_STATUSES.join('|')}` },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'taskNumber', 'title', 'taskStatus', 'channelId', 'assigneeId'],
  func: async (page, kwargs) => {
    const status = kwargs.status ? String(kwargs.status).trim() : '';
    if (status && !TASK_STATUSES.includes(status)) {
      throw new ArgumentError(`status "${status}" not in {${TASK_STATUSES.join('|')}}`);
    }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const status = ${JSON.stringify(status)};
      const qs = status ? ('?status=' + encodeURIComponent(status)) : '';
      const res = await fetch('${SLOCK_API_BASE}/tasks/server' + qs, { credentials:'include', headers });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where: '/tasks/server' };
      const data = await res.json();
      if (!data || !Array.isArray(data.tasks)) {
        return { kind: 'http', status: 200, where: '/tasks/server (expected {tasks:[]}, got drift)' };
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
      channelId: t.channelId ?? null,
      assigneeId: t.claimedById ?? t.assigneeId ?? null,
    }));
  },
});
