// task-claim.js
//
// PATCH /api/tasks/:id/claim — claim ownership of a chat task. The :id is the
// underlying message id (chat tasks = messages with task fields), so any short
// id must be expanded before we hit this endpoint.
//
// Claim is independent of status: a task in any non-terminal state can be
// (re)claimed. The server rejects done/closed.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-claim',
  access: 'write',
  description: 'Claim a chat task (PATCH /tasks/:id/claim). Requires full task UUID (= message id).',
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
      const res = await fetch('${SLOCK_API_BASE}/tasks/' + encodeURIComponent(${JSON.stringify(id)}) + '/claim', { method:'PATCH', credentials:'include', headers });
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/:id/claim (task not found)' };
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/:id/claim (forbidden — not your task, terminal status, or channel archived)' };
      if (res.status === 409) return { kind: 'http', status: 409, where: '/tasks/:id/claim (conflict — already claimed by someone else; use task-unclaim first)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/:id/claim' };
      const data = await res.json().catch(() => ({}));
      // F5 — qatester live dump: server wraps the task as { task: {...} }.
      // Unwrap so the command surfaces the inner row, otherwise every column
      // resolves to null even though the claim succeeded.
      const t = (data && data.task) ? data.task : data;
      return { kind: 'ok', rows: [t] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      taskId: assertTaskIdentity(t, id, 'task-claim'),
      taskStatus: t.taskStatus ?? t.status ?? '',
      // F5 — server returns `claimedById`, not `assigneeId`. Fall back to
      // assigneeId for forward-compat in case the server adds it later.
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
