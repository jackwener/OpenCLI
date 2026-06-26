// task-status.js
//
// PATCH /api/tasks/:taskId/status — body { status: <5-value enum> }.
//
// Source-verified (Bugen msg 35039412 / §Phase 9 — path has the /status
// suffix and the body field is `status`, NOT `taskStatus`).
//
// done and closed are terminal: server rejects transitions out of them.
// Client validates the enum locally so an unknown value never round-trips.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'closed'];

cli({
  site: SLOCK_SITE,
  name: 'task-status',
  access: 'write',
  description: `Set a task's status (PATCH /tasks/:taskId/status, body {status}). One of ${TASK_STATUSES.join('|')}.`,
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'taskId', positional: true, required: true, help: 'Full task UUID (= message id; short ids rejected)' },
    { name: 'status', positional: true, required: true, help: `One of: ${TASK_STATUSES.join('|')}` },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['taskId', 'taskStatus', 'assigneeId', 'taskNumber'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.taskId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    const status = String(kwargs.status ?? '').trim();
    if (!TASK_STATUSES.includes(status)) {
      throw new ArgumentError(`status "${status}" not in {${TASK_STATUSES.join('|')}} — pre-network reject (saves a 400 round-trip).`);
    }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('${SLOCK_API_BASE}/tasks/' + encodeURIComponent(${JSON.stringify(id)}) + '/status', {
        method:'PATCH', credentials:'include', headers,
        body: JSON.stringify({ status: ${JSON.stringify(status)} }),
      });
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        return { kind: 'http', status: 400, where: '/tasks/:taskId/status (bad request: ' + (j.error || j.message || 'invalid status transition') + ')' };
      }
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/:taskId/status (forbidden — terminal status (done/closed), not the assignee, or channel archived)' };
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/:taskId/status (task not found)' };
      // F6 — actionable hint for repeat-set 409 ("status already X").
      if (res.status === 409) return { kind: 'http', status: 409, where: '/tasks/:taskId/status (conflict — task is already in status ' + ${JSON.stringify(status)} + '; no-op set rejected)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/:taskId/status' };
      const data = await res.json().catch(() => ({}));
      const t = (data && data.task) ? data.task : data;
      return { kind: 'ok', rows: [t] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => {
      const task = assertTaskMutationIdentity(t, id, status);
      return {
        taskId: task.taskId,
        taskStatus: task.taskStatus,
        assigneeId: t.claimedById ?? t.assigneeId ?? null,
        taskNumber: t.taskNumber ?? null,
      };
    });
  },
});

function assertTaskMutationIdentity(t, expectedId, expectedStatus) {
  const taskId = t?.id;
  if (!taskId) {
    throw new CommandExecutionError(`Slock task-status succeeded without returning task id ${expectedId}; refusing to report a status row.`);
  }
  if (taskId !== expectedId) {
    throw new CommandExecutionError(`Slock task-status returned task id ${taskId}, expected ${expectedId}.`);
  }
  const taskStatus = t.taskStatus ?? t.status;
  if (!taskStatus) {
    throw new CommandExecutionError(`Slock task-status returned task ${expectedId} without taskStatus.`);
  }
  if (taskStatus !== expectedStatus) {
    throw new CommandExecutionError(`Slock task-status returned status ${taskStatus}, expected ${expectedStatus}.`);
  }
  return { taskId, taskStatus };
}
