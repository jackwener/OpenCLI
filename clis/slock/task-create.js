// task-create.js
//
// POST /api/tasks/channel/:channelId
//
// Chat tasks = messages with task fields, so creating a task means asking
// the server to insert a new message whose taskStatus = 'todo'. The body
// shape is `{tasks: [{title (required), description?}]}` — the server
// supports batch 1..50, but this surface only exposes ONE title at a time.
// Batch is parked as backlog R4 (would need commanderAdapter to support
// variadic positional, which is beyond Ph9 scope).
//
// Errors are differentiated per the dispatch:
//   400 → title empty / channel invalid / over-limit
//   403 → channel_archived / not a member
//   404 → channel not found
//   409 → thread-channel rejects task creation (joint_unsupported)

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'task-create',
  access: 'write',
  description: 'Create a task in a channel (single title; batch 1-50 is server-supported but client surface is single — see backlog R4).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'title', positional: true, required: true, help: 'Task title (single; batch TODO via R4)' },
    { name: 'desc', help: 'Optional description body for the task' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'taskNumber', 'title', 'taskStatus', 'channelId'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const title = String(kwargs.title ?? '').trim();
    if (!title) throw new ArgumentError('title required (non-empty)');
    const desc = kwargs.desc != null ? String(kwargs.desc) : '';
    await page.goto(SLOCK_HOME_URL);
    const taskObj = desc ? { title, description: desc } : { title };
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      // Body is always a batch array — N=1 here because the CLI exposes one
      // title at a time (R4 will widen this). Keep the wrapper so the server
      // sees the same shape as a real batch and we don't fork the contract.
      const body = { tasks: [${JSON.stringify(taskObj)}] };
      const res = await fetch('${SLOCK_API_BASE}/tasks/channel/' + encodeURIComponent(channelId), {
        method:'POST', credentials:'include', headers, body: JSON.stringify(body),
      });
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        return { kind: 'http', status: 400, where: '/tasks/channel/:id (bad request: ' + (j.error || j.message || 'title/limit/shape') + ')' };
      }
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/channel/:id (forbidden — channel archived or not a member)' };
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/channel/:id (channel not found)' };
      if (res.status === 409) return { kind: 'http', status: 409, where: '/tasks/channel/:id (conflict — thread channels do not accept tasks; pick the parent channel)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/channel/:id' };
      const data = await res.json().catch(() => ({}));
      if (!data || !Array.isArray(data.tasks)) {
        return { kind: 'http', status: 200, where: '/tasks/channel/:id (expected {tasks:[]}, got drift)' };
      }
      return { kind: 'ok', rows: data.tasks };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      id: t.id ?? '',
      taskNumber: t.taskNumber ?? null,
      title: t.content ?? t.title ?? title,
      taskStatus: t.taskStatus ?? 'todo',
      channelId: t.channelId ?? null,
    }));
  },
});
