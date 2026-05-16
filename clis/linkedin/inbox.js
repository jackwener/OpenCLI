import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'linkedin.com';
const MESSAGING_URL = 'https://www.linkedin.com/messaging/';
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;

// ── Why this command reads an API response instead of scraping the DOM ──
//
// LinkedIn's messaging UI is a realtime, virtualized SPA. Scraping the rendered
// conversation list is brittle: rows lazy-render, the list virtualizes, and the
// markup churns. Instead we let the page load /messaging/ exactly as a human
// would, which makes the page fire its own `messengerConversations` GraphQL
// call. We then re-issue that same request (URL lifted from the Performance API,
// so the rotating queryId is always current) and parse LinkedIn's normalized
// JSON. Same session, same origin, same request the page already makes.

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

function threadUrl(threadId) {
  return threadId ? `https://www.linkedin.com/messaging/thread/${threadId}/` : '';
}

// Runs in-page: locate the messengerConversations request the page already fired.
// Prefers the category-scoped query (the primary inbox) over the sync-token query.
function findMessagingApiUrl() {
  if (/\/(login|checkpoint|authwall|uas)/i.test(location.pathname)) return { loginRequired: true };
  const urls = performance.getEntriesByType('resource').map((e) => e.name);
  const matches = (re) => urls.find((u) => /messengerConversations\.[a-f0-9]+/i.test(u) && re.test(u));
  const url =
    matches(/PRIMARY_INBOX/i) ||
    matches(/conversationCategoryPredicate/i) ||
    urls.find((u) => /messengerConversations\.[a-f0-9]+/i.test(u) && /mailboxUrn/i.test(u));
  if (!url) return { url: null };
  const mb = url.match(/mailboxUrn:(urn[^,)&]+)/i);
  return { url, mailboxUrn: mb ? decodeURIComponent(mb[1]) : '' };
}

// Runs in-page: re-issue the messaging request with the session's csrf token.
async function fetchMessagingApi(url, csrf) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'csrf-token': csrf,
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'x-restli-protocol-version': '2.0.0',
      },
    });
    if (res.status === 401 || res.status === 403) return { authRequired: true, error: 'HTTP ' + res.status };
    if (!res.ok) return { error: 'HTTP ' + res.status };
    return { json: await res.json() };
  } catch (e) {
    return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
  }
}

// Parse LinkedIn's normalized messaging JSON into plain conversation rows.
// `included` is a flat entity array; conversations reference participants and
// messages by URN, which we resolve through a urn->entity index. Exported for
// unit testing against a captured fixture.
function parseConversations(normalized, mailboxUrn) {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized) || !Array.isArray(normalized.included)) {
    throw new CommandExecutionError('LinkedIn messaging API returned malformed normalized payload: missing included array');
  }
  const included = normalized.included;
  const byUrn = new Map();
  for (const o of included) {
    if (o && o.entityUrn) byUrn.set(o.entityUrn, o);
  }
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  const participantInfo = (p) => {
    if (!p) return { name: '', kind: '' };
    const pt = p.participantType || {};
    if (pt.organization && pt.organization.name) return { name: norm(pt.organization.name.text), kind: 'organization' };
    if (pt.member) {
      const fn = pt.member.firstName && pt.member.firstName.text;
      const ln = pt.member.lastName && pt.member.lastName.text;
      return { name: norm([fn, ln].filter(Boolean).join(' ')), kind: 'member' };
    }
    if (pt.agent && pt.agent.name) return { name: norm(pt.agent.name.text), kind: 'agent' };
    return { name: '', kind: '' };
  };

  const entries = [];
  for (const conv of included) {
    if (!conv || conv.$type !== 'com.linkedin.messenger.Conversation') continue;
    const threadId = String(conv.backendUrn || '').replace(/^urn:li:messagingThread:/, '');
    if (!threadId) {
      throw new CommandExecutionError('LinkedIn messaging API returned a conversation without thread id');
    }

    const others = [];
    let counterpartyKind = '';
    for (const urn of conv['*conversationParticipants'] || []) {
      const p = byUrn.get(urn);
      if (!p) continue;
      if (mailboxUrn && p.hostIdentityUrn === mailboxUrn) continue; // exclude the inbox owner
      const info = participantInfo(p);
      if (info.name) {
        others.push(info.name);
        if (!counterpartyKind) counterpartyKind = info.kind;
      }
    }

    const msgUrns = (conv.messages && conv.messages['*elements']) || [];
    const lastMsg = byUrn.get(msgUrns[0]);
    let preview = lastMsg && lastMsg.body ? norm(lastMsg.body.text) : '';
    if (!preview) preview = norm(conv.descriptionText || '');

    const activityMs = Number(conv.lastActivityAt || 0);
    entries.push({
      activityMs,
      row: {
        thread_id: threadId,
        person_name: conv.title ? norm(conv.title) : others.join(', '),
        last_message_preview: preview.slice(0, 300),
        unread: Number(conv.unreadCount || 0) > 0 || conv.read === false,
        counterparty_type: counterpartyKind,
        category: Array.isArray(conv.categories) ? conv.categories.join(',') : '',
        timestamp: activityMs ? new Date(activityMs).toISOString() : '',
      },
    });
  }
  // Most-recent first; the sort key is kept off the returned row.
  entries.sort((a, b) => b.activityMs - a.activityMs);
  return entries.map((entry) => entry.row);
}

cli({
  site: 'linkedin',
  name: 'inbox',
  access: 'read',
  description: 'List LinkedIn messaging inbox conversations and unread messages',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: 'Maximum conversations to return (1-100)' },
    { name: 'unread-only', type: 'bool', default: false, help: 'Return only conversations with unread messages' },
  ],
  columns: [
    'rank',
    'thread_url',
    'thread_id',
    'person_name',
    'last_message_preview',
    'unread',
    'counterparty_type',
    'category',
    'timestamp',
  ],
  func: async (page, kwargs) => {
    // Validate --limit explicitly rather than silently clamping an out-of-range value.
    let limit = DEFAULT_LIMIT;
    if (kwargs.limit !== undefined && kwargs.limit !== null && kwargs.limit !== '') {
      limit = Number(kwargs.limit);
      if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
      }
    }
    const unreadOnly = Boolean(kwargs['unread-only']);

    await page.goto(MESSAGING_URL);
    await page.wait(10);

    // Locate the messaging API request the page fired on load; retry once if the
    // SPA was slow to issue it.
    let located = unwrapEvaluateResult(await page.evaluate(`(${findMessagingApiUrl.toString()})()`));
    if (located && located.loginRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn requires an active signed-in browser session.');
    }
    if (!located || !located.url) {
      await page.wait(6);
      located = unwrapEvaluateResult(await page.evaluate(`(${findMessagingApiUrl.toString()})()`));
    }
    if (!located || !located.url) {
      throw new CommandExecutionError(
        'LinkedIn did not issue a messaging API request; the inbox may have failed to load.',
      );
    }

    const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
    const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    if (!jsession) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn.');
    }
    const csrf = jsession.replace(/^"|"$/g, '');

    // Widen the page size to the requested limit where the query supports it.
    const targetUrl = located.url.replace(/count:\d+/, 'count:' + limit);
    const fetched = unwrapEvaluateResult(
      await page.evaluate(`(${fetchMessagingApi.toString()})(${JSON.stringify(targetUrl)}, ${JSON.stringify(csrf)})`),
    );
    if (fetched && fetched.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn messaging API authentication failed: ' + fetched.error);
    }
    if (!fetched || fetched.error || !fetched.json) {
      throw new CommandExecutionError(
        'LinkedIn messaging API returned an unexpected response: ' + ((fetched && fetched.error) || 'no data'),
      );
    }

    let conversations = parseConversations(fetched.json, located.mailboxUrn || '');
    if (unreadOnly) conversations = conversations.filter((c) => c.unread);
    if (conversations.length === 0) {
      if (unreadOnly) return [];
      throw new EmptyResultError('linkedin inbox', 'No LinkedIn conversations were found in the inbox.');
    }

    return conversations.slice(0, limit).map((c, index) => ({
      rank: index + 1,
      thread_url: threadUrl(c.thread_id),
      thread_id: c.thread_id,
      person_name: c.person_name,
      last_message_preview: c.last_message_preview,
      unread: c.unread,
      counterparty_type: c.counterparty_type,
      category: c.category,
      timestamp: c.timestamp,
    }));
  },
});

export const __test__ = {
  parseConversations,
  threadUrl,
};
