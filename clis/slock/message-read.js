// message-read.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment, resolveShortIdFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { UUID_RE, classifyThreadTarget, parsePositiveInteger } from './resolve.js';

function mapRow(m, threadsMap) {
  const info = threadsMap && typeof threadsMap === 'object' ? threadsMap[m.id ?? m.messageId] : undefined;
  const threadsUnavailable = threadsMap === null;
  return {
    id: m.id ?? m.messageId ?? '',
    seq: typeof m.seq === 'number' ? m.seq : null,
    createdAt: m.createdAt ?? m.created_at ?? '',
    senderName: m.sender?.name ?? m.user?.name ?? m.senderName ?? '',
    content: m.content ?? '',
    threadChannelId: threadsUnavailable ? null : (info?.threadChannelId ?? null),
    replyCount: threadsUnavailable ? null : (typeof info?.replyCount === 'number' ? info.replyCount : 0),
    unreadCount: threadsUnavailable ? null : (typeof info?.unreadCount === 'number' ? info.unreadCount : 0),
    lastReplyAt: threadsUnavailable ? null : (info?.lastReplyAt ?? null),
  };
}

cli({
  site: SLOCK_SITE,
  name: 'message-read',
  access: 'read',
  description: 'Read messages in a channel or thread. Thread form: "#channel:msgIdOrShort". Use --after seq|UUID for cursor.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID, "#name", or "#channel:msgIdOrShort"' },
    { name: 'after', help: 'Cursor: seq number or messageId UUID (exclusive)' },
    { name: 'before', help: 'seq to page before' },
    { name: 'limit', type: 'int', default: 50, help: 'Max messages' },
    { name: 'no-threads', type: 'bool', default: false, help: 'Skip /threads enrichment' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'seq', 'createdAt', 'senderName', 'content', 'threadChannelId', 'replyCount', 'unreadCount', 'lastReplyAt'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const tt = classifyThreadTarget(channel);
    const isUuid = UUID_RE.test(channel);
    const after = kwargs.after !== undefined ? String(kwargs.after) : '';
    if (after && !/^\d+$/.test(after) && !UUID_RE.test(after)) {
      throw new ArgumentError(`--after must be a seq number or messageId UUID (got "${after}")`);
    }
    const limit = parsePositiveInteger(kwargs.limit, '--limit', { defaultValue: 50 });
    const before = kwargs.before !== undefined ? String(kwargs.before) : '';
    if (before && !/^\d+$/.test(before)) {
      throw new ArgumentError(`--before must be a seq number (got "${before}")`);
    }
    if (before) parsePositiveInteger(before, '--before');
    const noThreads = !!kwargs['no-threads'];
    // R1 — pass the raw override through to authHeadersFragment; it owns the
    // UUID-vs-slug resolution against /servers/ now.
    const override = kwargs.server ?? null;

    await page.goto(SLOCK_HOME_URL);

    const params = {
      isUuid, channel, after, before, limit, noThreads, override,
      parentTarget: tt?.parentTarget ?? '',
      parentMsgId: tt?.parentMsgId ?? '',
      isThread: !!tt,
    };
    const snippet = buildReadSnippet(params);
    const result = await page.evaluate(`(async () => { ${snippet} })()`);

    if (result?.kind === 'no-thread') {
      return [{
        id: '', seq: null, createdAt: '', senderName: '',
        content: `(${result.parent} — no thread yet, 0 replies.)`,
        threadChannelId: null, replyCount: 0, unreadCount: 0, lastReplyAt: null,
      }];
    }
    const list = dispatchEvaluateResult(result);
    if (!Array.isArray(list)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof list} (contract drift?)`);
    }
    const threadsMap = result.meta?.threadsMap ?? {};
    const threadsDegraded = result.meta?.threadsDegraded === true;
    const mapArg = threadsDegraded ? null : threadsMap;
    const rows = list.map((m) => mapRow(m, mapArg));
    if (threadsDegraded) {
      rows.unshift({
        id: '', seq: null, createdAt: '', senderName: '',
        content: '(threads-enrichment unavailable — replyCount/threadChannelId set to null. Retry to get reply counts.)',
        threadChannelId: null, replyCount: null, unreadCount: null, lastReplyAt: null,
      });
    }
    return rows;
  },
});

function buildReadSnippet(p) {
  const target = JSON.stringify(p.channel.replace(/^#/, '').toLowerCase());
  const parentTarget = JSON.stringify(p.parentTarget.replace(/^#/, '').toLowerCase());
  const parentMsgId = JSON.stringify(p.parentMsgId);
  const after = JSON.stringify(p.after);
  const before = JSON.stringify(p.before);
  const limit = JSON.stringify(p.limit);
  return `
    ${authHeadersFragment({ serverScoped: true, serverIdOverride: p.override })}
    let channelId;
    ${p.isThread ? `
      // thread shape: resolve parent channel, then short-id → full, then /threads/:msgId
      const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
      if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
      const carr = await cres.json();
      const carrL = Array.isArray(carr) ? carr : (carr.channels || carr.data || []);
      const phit = carrL.find((c) => (c.name||c.slug||'').toLowerCase() === ${parentTarget});
      if (!phit) return { kind: 'unresolvable', detail: 'parent channel not found: ' + ${parentTarget} };
      const parentChannelId = phit.id;
      let fullMsgId = ${parentMsgId};
      ${resolveShortIdFragment({ shortIdVar: 'fullMsgId', parentChannelIdVar: 'parentChannelId', contextDescription: parentTarget })}
      const tres = await fetch('${SLOCK_API_BASE}/channels/' + encodeURIComponent(parentChannelId) + '/threads/' + encodeURIComponent(fullMsgId), { credentials:'include', headers });
      if (tres.status === 404) return { kind: 'no-thread', parent: ${JSON.stringify(p.channel)} };
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where:'/threads/:msgId' };
      const tinfo = await tres.json();
      channelId = tinfo.threadChannelId || tinfo.channelId || tinfo.id;
    ` : `
      if (${p.isUuid}) {
        channelId = ${JSON.stringify(p.channel)};
      } else {
        const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
        if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
        const arr = await cres.json();
        const arrL = Array.isArray(arr) ? arr : (arr.channels || arr.data || []);
        const hit = arrL.find((c) => (c.name||c.slug||'').toLowerCase() === ${target});
        if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${target} };
        channelId = hit.id;
      }
    `}
    let afterSeq = ${after};
    if (afterSeq && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(afterSeq)) {
      const cx = await fetch('${SLOCK_API_BASE}/messages/context/' + encodeURIComponent(afterSeq), { credentials:'include', headers });
      if (!cx.ok) return { kind: cx.status===401?'auth':'http', status: cx.status, where:'/messages/context (--after)' };
      const cxd = await cx.json();
      const anchor = (cxd.messages || []).find((m) => (m.id||m.messageId) === cxd.targetMessageId);
      afterSeq = String(anchor?.seq ?? '');
    }
    const qs = new URLSearchParams();
    if (afterSeq) qs.set('after', afterSeq);
    if (${before}) qs.set('before', ${before});
    qs.set('limit', ${limit});
    const mres = await fetch('${SLOCK_API_BASE}/messages/channel/' + encodeURIComponent(channelId) + '?' + qs.toString(), { credentials:'include', headers });
    if (!mres.ok) return { kind: mres.status===401?'auth':'http', status: mres.status, where: '/messages/channel/:id' };
    const mdata = await mres.json();
    const messages = Array.isArray(mdata) ? mdata : (mdata.messages || mdata.data || []);
    let threadsMap = {};
    let threadsDegraded = false;
    ${p.noThreads ? '' : `
    try {
      const thres = await fetch('${SLOCK_API_BASE}/channels/' + encodeURIComponent(channelId) + '/threads', { credentials:'include', headers });
      if (thres.ok) {
        const tmap = await thres.json();
        if (tmap && typeof tmap === 'object' && !Array.isArray(tmap)) threadsMap = tmap;
      } else { threadsDegraded = true; }
    } catch { threadsDegraded = true; }
    `}
    return { kind: 'ok', rows: messages, meta: { threadsMap: threadsDegraded ? null : threadsMap, threadsDegraded } };
  `;
}
