// task-convert.js
//
// POST /api/tasks/convert-message — body { messageId }.
//
// Source-verified (Bugen §Phase 9 — convert is a tasks-router endpoint, NOT
// a messages-router PATCH on the message). The server reads the message row
// referenced by messageId, sets its task fields (taskStatus='todo' + assigns
// taskNumber), and the same row becomes the chat task.
//
// Accepted inputs:
//   - a full message UUID
//   - "#channel:msgShortId" — short id is expanded via /api/messages/context,
//     reading `targetMessageId` (NOT m.message.id — Phase 7.1 lesson / 托瓦茲
//     gate ②). The fragment is inlined here for now (R3 backlog: consolidate
//     into a shared shortIdResolveFragment).

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment, resolveShortIdFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { UUID_RE, classifyThreadTarget } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-convert',
  access: 'write',
  description: 'Convert a message into a chat task (POST /tasks/convert-message). Accepts a message UUID or "#channel:shortId".',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full message UUID, or "#channel:shortId" (short id expanded via /messages/context)' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'taskNumber', 'title', 'taskStatus', 'channelId'],
  func: async (page, kwargs) => {
    const raw = String(kwargs.messageId ?? '').trim();
    if (!raw) throw new ArgumentError('messageId required');

    // Decide shape: bare UUID, or "#channel:shortId".
    let resolveFragment;
    if (UUID_RE.test(raw)) {
      resolveFragment = `const fullMsgId = ${JSON.stringify(raw)};`;
    } else {
      const tt = classifyThreadTarget(raw);
      if (!tt) {
        throw new ArgumentError(`messageId "${raw}" is not a UUID or a "#channel:shortId" form`);
      }
      const isUuid = UUID_RE.test(tt.parentTarget);
      const parent = JSON.stringify(tt.parentTarget.replace(/^#/, '').toLowerCase());
      const pmsg = JSON.stringify(tt.parentMsgId);
      // Phase 7.1 invariant baked in: we read cxd.targetMessageId, NOT
      // m.message.id. The latter is the closest-message-in-context object,
      // which can be a neighbor when the short id is just a prefix.
      resolveFragment = `
        let parentChannelId;
        if (${isUuid}) {
          parentChannelId = ${JSON.stringify(tt.parentTarget)};
        } else {
          const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
          if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
          const carr = await cres.json();
          const hit = (Array.isArray(carr)?carr:(carr.channels||carr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${parent});
          if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${parent} };
          parentChannelId = hit.id;
        }
        let fullMsgId = ${pmsg};
        ${resolveShortIdFragment({ shortIdVar: 'fullMsgId', parentChannelIdVar: 'parentChannelId', contextDescription: parent })}
      `;
    }

    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${resolveFragment}
      const res = await fetch('${SLOCK_API_BASE}/tasks/convert-message', {
        method:'POST', credentials:'include', headers,
        body: JSON.stringify({ messageId: fullMsgId }),
      });
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        return { kind: 'http', status: 400, where: '/tasks/convert-message (bad request: ' + (j.error || j.message || 'invalid messageId') + ')' };
      }
      if (res.status === 403) return { kind: 'http', status: 403, where: '/tasks/convert-message (forbidden — not a channel member, or channel archived)' };
      if (res.status === 404) return { kind: 'http', status: 404, where: '/tasks/convert-message (message not found)' };
      if (res.status === 409) return { kind: 'http', status: 409, where: '/tasks/convert-message (conflict — message is already a task, or in a thread channel which does not accept tasks)' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/tasks/convert-message' };
      const data = await res.json().catch(() => ({}));
      // F5 — server wraps the task as { task: {...} }; unwrap so the
      // command surfaces the inner row instead of all-null columns.
      const t = (data && data.task) ? data.task : data;
      return { kind: 'ok', rows: [t] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((t) => ({
      id: t.id ?? '',
      taskNumber: t.taskNumber ?? null,
      title: t.content ?? t.title ?? '',
      taskStatus: t.taskStatus ?? 'todo',
      channelId: t.channelId ?? null,
    }));
  },
});
