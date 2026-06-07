// task-unclaim.js
//
// PATCH /api/tasks/:id/unclaim — release ownership of a chat task. Mirrors
// task-claim. Note: per server contract, unclaim cannot be done on a terminal
// (done / closed) task.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-unclaim',
  access: 'write',
  description: 'Release ownership of a chat task (PATCH /tasks/:id/unclaim).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'taskId', positional: true, required: true, help: 'Full task UUID (= message id; short ids rejected)' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['taskId', 'taskStatus', 'assigneeId', 'taskNumber'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.taskId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('/api/tasks/' + encodeURIComponent(${JSON.stringify(id)}) + '/unclaim', { method:'PATCH', credentials:'include', headers });
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/:id/unclaim (task not found)' };
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/:id/unclaim (forbidden — not the assignee, terminal status, or channel archived)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/:id/unclaim' };
      const data = await res.json().catch(() => ({}));
      return { kind: 'ok', rows: [data] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      taskId: t.id ?? id,
      taskStatus: t.taskStatus ?? t.status ?? '',
      assigneeId: t.assigneeId ?? null,
      taskNumber: t.taskNumber ?? null,
    }));
  },
});
