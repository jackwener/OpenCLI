// message-send.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE, classifyTarget } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'message-send',
  access: 'write',
  description: 'Send a message to a channel, DM, or thread (content sent verbatim)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'target', positional: true, required: true, help: '"#channel", "#channel:msgIdOrShort", "dm:@name", "dm:<uuid>", or channel UUID' },
    { name: 'content', positional: true, required: true, help: 'Message body (sent verbatim, no marker)' },
    { name: 'dry-run', type: 'bool', default: false, help: 'Print the planned payload without sending' },
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['target', 'channelId', 'content', 'result', 'messageId'],
  func: async (page, kwargs) => {
    const target = String(kwargs.target ?? '').trim();
    if (!target) throw new ArgumentError('target required');
    const content = String(kwargs.content ?? '');
    let cls;
    try { cls = classifyTarget(target); }
    catch (e) { throw new ArgumentError(e.message); }

    if (kwargs['dry-run']) {
      return [{
        target, channelId: '(not resolved in dry-run)', content,
        result: 'dry-run', messageId: null,
      }];
    }

    await page.goto(SLOCK_HOME_URL);
    const snippet = buildSendSnippet(target, content, cls, kwargs.server);
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    const r = rows[0] ?? {};
    return [{
      target,
      channelId: r.channelId ?? '',
      content,
      result: 'sent',
      messageId: r.id ?? r.messageId ?? null,
    }];
  },
});

function buildSendSnippet(target, content, cls, serverOverride) {
  const override = serverOverride ? JSON.stringify(serverOverride) : 'null';
  const contentJson = JSON.stringify(content);
  const auth = `
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { kind: 'auth', detail: 'no token' };
    let sid = ${override};
    if (!sid) {
      const slug = localStorage.getItem('slock_last_server_slug');
      if (!slug) return { kind: 'no-server', detail: 'no slug' };
      const sres = await fetch('/api/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
      if (!sres.ok) return { kind: sres.status===401?'auth':'http', status: sres.status, where:'/servers/' };
      const slist = await sres.json();
      const sm = slist.find((s) => s.slug === slug);
      if (!sm) return { kind: 'no-server', detail: 'slug missing' };
      sid = sm.id;
    }
    const headers = { authorization:'Bearer '+token, accept:'application/json', 'content-type':'application/json', 'x-server-id': sid };
  `;
  const postMsg = `
    const mres = await fetch('/api/messages', { method:'POST', credentials:'include', headers, body: JSON.stringify({ channelId, content: ${contentJson} }) });
    if (!mres.ok) return { kind: mres.status===401?'auth':'http', status: mres.status, where:'/messages' };
    const m = await mres.json();
    return { kind: 'ok', rows: [{ id: m.id ?? m.messageId, channelId }] };
  `;
  let resolve = '';
  if (cls.kind === 'channel-uuid') {
    resolve = `let channelId = ${JSON.stringify(cls.channelId)};`;
  } else if (cls.kind === 'channel-name') {
    resolve = `
      const cres = await fetch('/api/channels/', { credentials:'include', headers });
      if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
      const carr = await cres.json();
      const hit = (Array.isArray(carr)?carr:(carr.channels||carr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${JSON.stringify(cls.name)});
      if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ${cls.name}' };
      let channelId = hit.id;
    `;
  } else if (cls.kind === 'dm-uuid') {
    resolve = `
      const dres = await fetch('/api/channels/dm', { method:'POST', credentials:'include', headers, body: JSON.stringify({ userId: ${JSON.stringify(cls.userId)} }) });
      if (!dres.ok) return { kind: dres.status===401?'auth':'http', status: dres.status, where:'/channels/dm' };
      const dd = await dres.json();
      let channelId = dd.channelId ?? dd.id;
      if (!channelId) return { kind: 'http', status: 500, where: '/channels/dm (no id in response)' };
    `;
  } else if (cls.kind === 'dm-name') {
    resolve = `
      const sres2 = await fetch('/api/servers/' + encodeURIComponent(sid) + '/members', { credentials:'include', headers });
      if (!sres2.ok) return { kind: sres2.status===401?'auth':'http', status: sres2.status, where:'/servers/:id/members' };
      const mlist = await sres2.json();
      const marr = Array.isArray(mlist) ? mlist : (mlist.members || mlist.data || []);
      const mh = marr.find((u) => (u.username||u.name||u.displayName||'').toLowerCase() === ${JSON.stringify(cls.name.toLowerCase())});
      if (!mh) return { kind: 'unresolvable', detail: 'no member @${cls.name}' };
      const dres = await fetch('/api/channels/dm', { method:'POST', credentials:'include', headers, body: JSON.stringify({ userId: mh.userId ?? mh.id }) });
      if (!dres.ok) return { kind: dres.status===401?'auth':'http', status: dres.status, where:'/channels/dm' };
      const dd = await dres.json();
      let channelId = dd.channelId ?? dd.id;
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
        const cres = await fetch('/api/channels/', { credentials:'include', headers });
        if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
        const carr = await cres.json();
        const hit = (Array.isArray(carr)?carr:(carr.channels||carr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${parent});
        if (!hit) return { kind: 'unresolvable', detail: 'no parent channel: ' + ${parent} };
        parentChannelId = hit.id;
      }
      let fullMsgId = ${pmsg};
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(fullMsgId)) {
        const cx = await fetch('/api/messages/context/' + encodeURIComponent(fullMsgId) + '?channelId=' + encodeURIComponent(parentChannelId), { credentials:'include', headers });
        if (cx.status === 404) return { kind: 'unresolvable', detail: 'short id "' + fullMsgId + '" not found' };
        if (!cx.ok) return { kind: cx.status===401?'auth':'http', status: cx.status, where:'/messages/context' };
        const cxd = await cx.json();
        fullMsgId = cxd.targetMessageId;
      }
      const tres = await fetch('/api/channels/' + encodeURIComponent(parentChannelId) + '/threads', { method:'POST', credentials:'include', headers, body: JSON.stringify({ parentMessageId: fullMsgId }) });
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where:'/channels/:id/threads' };
      const td = await tres.json();
      let channelId = td.threadChannelId ?? td.channelId ?? td.id;
      if (!channelId) return { kind: 'http', status: 500, where:'/channels/:id/threads (no id)' };
    `;
  }
  return `${auth}\n${resolve}\n${postMsg}`;
}
