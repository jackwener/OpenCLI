// task-unclaim.js
//
// PATCH /api/tasks/:id/unclaim — release ownership of a chat task. Mirrors
// task-claim. Note: per server contract, unclaim cannot be done on a terminal
// (done / closed) task.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-unclaim',
  access: 'write',
  description: 'Release ownership of a chat task (PATCH /tasks/:id/unclaim).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
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
      const res = await fetch('${SLOCK_API_BASE}/tasks/' + encodeURIComponent(${JSON.stringify(id)}) + '/unclaim', { method:'PATCH', credentials:'include', headers });
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/:id/unclaim (task not found)' };
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/:id/unclaim (forbidden — not the assignee, terminal status, or channel archived)' };
      // F6 — actionable hint for the most common reason this 409s (task already
      // unclaimed, or terminal state). Bare "HTTP 409" was confusing.
      if (res.status === 409) return { kind: 'http', status: 409, where: '/tasks/:id/unclaim (conflict — task is not claimed, or already in a terminal state (done/closed))' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/:id/unclaim' };
      const data = await res.json().catch(() => ({}));
      const t = (data && data.task) ? data.task : data;
      return { kind: 'ok', rows: [t] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      taskId: assertTaskIdentity(t, id, 'task-unclaim'),
      taskStatus: t.taskStatus ?? t.status ?? '',
      assigneeId: t.claimedById ?? t.assigneeId ?? null,
      taskNumber: t.taskNumber ?? null,
    }));
  },
});

function assertTaskIdentity(t, expectedId, commandName) {
  const taskId = t?.id;
  if (!taskId) {
    throw new CommandExecutionError(`Slock ${commandName} succeeded without returning task id ${expectedId}; refusing to report a task row.`);
  }
  if (taskId !== expectedId) {
    throw new CommandExecutionError(`Slock ${commandName} returned task id ${taskId}, expected ${expectedId}.`);
  }
  return taskId;
}
