// message-send.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment, resolveShortIdFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { UUID_RE, classifyTarget } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'message-send',
  access: 'write',
  description: 'Send a message to a channel, DM, or thread (content sent verbatim)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'target', positional: true, required: true, help: '"#channel", "#channel:msgIdOrShort", "dm:@name", "dm:<uuid>", or channel UUID' },
    { name: 'content', positional: true, required: true, help: 'Message body (sent verbatim, no marker)' },
    { name: 'dry-run', type: 'bool', default: false, help: 'Print the planned payload without sending' },
    { name: 'as-task', type: 'bool', default: false, help: 'Create the message as a task (asTask)' },
    { name: 'attach', help: 'Comma-separated attachmentId UUIDs (upload separately first)' },
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['target', 'channelId', 'content', 'result', 'messageId'],
  func: async (page, kwargs) => {
    const target = String(kwargs.target ?? '').trim();
    if (!target) throw new ArgumentError('target required');
    const content = String(kwargs.content ?? '');
    const asTask = !!kwargs['as-task'];
    const attachmentIds = String(kwargs.attach ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    for (const aid of attachmentIds) {
      if (!UUID_RE.test(aid)) throw new ArgumentError(`--attach expects attachmentId UUIDs; "${aid}" is not a UUID`);
    }
    let cls;
    try { cls = classifyTarget(target); }
    catch (e) { throw new ArgumentError(e.message); }

    const extra = { asTask, attachmentIds };

    if (kwargs['dry-run']) {
      return [{
        target, channelId: '(not resolved in dry-run)', content,
        result: asTask ? 'dry-run (asTask)' : 'dry-run', messageId: null,
      }];
    }

    await page.goto(SLOCK_HOME_URL);
    const snippet = buildSendSnippet(target, content, cls, kwargs.server, extra);
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    const r = rows[0] ?? {};
    const messageId = r.id ?? r.messageId;
    if (!messageId) {
      throw new CommandExecutionError('Slock message-send succeeded without returning a message id; refusing to report a sent row.');
    }
    return [{
      target,
      channelId: r.channelId ?? '',
      content,
      result: 'sent',
      messageId,
    }];
  },
});

function buildSendSnippet(target, content, cls, serverOverride, extra = {}) {
  // R1 — raw override; authHeadersFragment owns the UUID-vs-slug resolution.
  const override = serverOverride ?? null;
  const contentJson = JSON.stringify(content);
  const extraParts = [];
  if (extra.asTask) extraParts.push('asTask: true');
  if (Array.isArray(extra.attachmentIds) && extra.attachmentIds.length) {
    extraParts.push(`attachmentIds: ${JSON.stringify(extra.attachmentIds)}`);
  }
  const extraStr = extraParts.length ? ', ' + extraParts.join(', ') : '';
  const auth = authHeadersFragment({ serverScoped: true, serverIdOverride: override });
  const postMsg = `
    if (!channelId) return { kind: 'http', status: 500, where:'/messages (target resolved without channelId)' };
    const mres = await fetch('${SLOCK_API_BASE}/messages', { method:'POST', credentials:'include', headers, body: JSON.stringify({ channelId, content: ${contentJson}${extraStr} }) });
    if (!mres.ok) return { kind: mres.status===401?'auth':'http', status: mres.status, where:'/messages' };
    const m = await mres.json();
    const messageId = m.id ?? m.messageId;
    if (!messageId) return { kind: 'http', status: 200, where:'/messages (no message id in response)' };
    return { kind: 'ok', rows: [{ id: messageId, channelId }] };
  `;
  let resolve = '';
  if (cls.kind === 'channel-uuid') {
    resolve = `let channelId = ${JSON.stringify(cls.channelId)};`;
  } else if (cls.kind === 'channel-name') {
    resolve = `
      const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
      if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
      const carr = await cres.json();
      const hit = (Array.isArray(carr)?carr:(carr.channels||carr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${JSON.stringify(cls.name)});
      if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${JSON.stringify(cls.name)} };
      let channelId = hit.id;
    `;
  } else if (cls.kind === 'dm-uuid') {
    resolve = `
      const dres = await fetch('${SLOCK_API_BASE}/channels/dm', { method:'POST', credentials:'include', headers, body: JSON.stringify({ userId: ${JSON.stringify(cls.userId)} }) });
      if (!dres.ok) return { kind: dres.status===401?'auth':'http', status: dres.status, where:'/channels/dm' };
      const dd = await dres.json();
      let channelId = dd.channelId ?? dd.id;
      if (!channelId) return { kind: 'http', status: 500, where: '/channels/dm (no id in response)' };
    `;
  } else if (cls.kind === 'dm-name') {
    resolve = `
      const sres2 = await fetch('${SLOCK_API_BASE}/servers/' + encodeURIComponent(sid) + '/members', { credentials:'include', headers });
      if (!sres2.ok) return { kind: sres2.status===401?'auth':'http', status: sres2.status, where:'/servers/:id/members' };
      const mlist = await sres2.json();
      const marr = Array.isArray(mlist) ? mlist : (mlist.members || mlist.data || []);
      const mh = marr.find((u) => (u.username||u.name||u.displayName||'').toLowerCase() === ${JSON.stringify(cls.name.toLowerCase())});
      if (!mh) return { kind: 'unresolvable', detail: 'no member @' + ${JSON.stringify(cls.name)} };
      const dres = await fetch('${SLOCK_API_BASE}/channels/dm', { method:'POST', credentials:'include', headers, body: JSON.stringify({ userId: mh.userId ?? mh.id }) });
      if (!dres.ok) return { kind: dres.status===401?'auth':'http', status: dres.status, where:'/channels/dm' };
      const dd = await dres.json();
      let channelId = dd.channelId ?? dd.id;
      if (!channelId) return { kind: 'http', status: 500, where: '/channels/dm (no id in response)' };
    `;
  } else if (cls.kind === 'thread') {
    const isUuid = UUID_RE.test(cls.parentTarget);
    const parent = JSON.stringify(cls.parentTarget.replace(/^#/, '').toLowerCase());
    const pmsg = JSON.stringify(cls.parentMsgId);
    resolve = `
      let parentChannelId;
      if (${isUuid}) {
        parentChannelId = ${JSON.stringify(cls.parentTarget)};
      } else {
        const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
        if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
        const carr = await cres.json();
        const hit = (Array.isArray(carr)?carr:(carr.channels||carr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${parent});
        if (!hit) return { kind: 'unresolvable', detail: 'no parent channel: ' + ${parent} };
        parentChannelId = hit.id;
      }
      let fullMsgId = ${pmsg};
      ${resolveShortIdFragment({ shortIdVar: 'fullMsgId', parentChannelIdVar: 'parentChannelId' })}
      const tres = await fetch('${SLOCK_API_BASE}/channels/' + encodeURIComponent(parentChannelId) + '/threads', { method:'POST', credentials:'include', headers, body: JSON.stringify({ parentMessageId: fullMsgId }) });
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where:'/channels/:id/threads' };
      const td = await tres.json();
      let channelId = td.threadChannelId ?? td.channelId ?? td.id;
      if (!channelId) return { kind: 'http', status: 500, where:'/channels/:id/threads (no id)' };
    `;
  }
  return `${auth}\n${resolve}\n${postMsg}`;
}
