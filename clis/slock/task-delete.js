// task-delete.js
//
// DELETE /api/tasks/:taskId — irreversible removal of a chat task.
//
// Source-verified (Bugen §Phase 9; precise per-row permission rules come
// from his follow-up). Destructive operation → server-default sane gate:
// require --confirm before issuing the DELETE. Without it, the command
// returns a planned-action row and never touches the network.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-delete',
  access: 'write',
  description: 'Delete a chat task (DELETE /tasks/:taskId). Requires --confirm — destructive, irreversible.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'taskId', positional: true, required: true, help: 'Full task UUID (= message id; short ids rejected)' },
    { name: 'confirm', type: 'bool', default: false, help: 'Required acknowledgement: deletion is irreversible' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['taskId', 'deleted'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.taskId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    if (!kwargs.confirm) {
      // No network touched without --confirm. Return a planned-action row
      // so users know the call was a no-op and what to do next.
      return [{ taskId: id, deleted: false, note: 'no-op: pass --confirm to actually delete (irreversible)' }];
    }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('${SLOCK_API_BASE}/tasks/' + encodeURIComponent(${JSON.stringify(id)}), { method:'DELETE', credentials:'include', headers });
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/:taskId (forbidden — not the owner/admin or channel archived)' };
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/:taskId (task not found)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/:taskId' };
      // 204 No Content is common for DELETE; tolerate empty body.
      return { kind: 'ok', rows: [{ taskId: ${JSON.stringify(id)}, deleted: true }] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((r) => ({ taskId: r.taskId ?? id, deleted: r.deleted ?? true }));
  },
});
