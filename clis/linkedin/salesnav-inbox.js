import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SALES_INBOX_URL = 'https://www.linkedin.com/sales/inbox/';
const THREADS_BASE = 'https://www.linkedin.com/sales-api/salesApiMessagingThreads';
const PAGE_SIZE = 20;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 500;
const THREAD_DECORATION = '(id,restrictions,archived,unreadMessageCount,nextPageStartsAt,totalMessageCount,messages*(id,type,contentFlag,deliveredAt,lastEditedAt,subject,body,footerText,blockCopy,attachments,author,systemMessageContent),participants*~fs_salesProfile(entityUrn,firstName,lastName,fullName,degree,profilePictureDisplayImage,objectUrn,inmailRestriction))';

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseLimit(value, defaultValue = DEFAULT_LIMIT) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

export function encodeRestliDecoration(value) {
  // LinkedIn's Sales Navigator Rest.li endpoint returns HTTP 400 when this
  // decoration is sent with literal parentheses. Keep parentheses percent-encoded.
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function salesnavThreadUrl(threadId) {
  return threadId ? `https://www.linkedin.com/sales/inbox/${encodeURIComponent(threadId)}` : '';
}

function threadListUrl({ count = PAGE_SIZE, pageStartsAt = '' } = {}) {
  let url = `${THREADS_BASE}?decoration=${encodeRestliDecoration(THREAD_DECORATION)}&count=${count}&filter=INBOX&q=filter`;
  if (pageStartsAt) url += `&pageStartsAt=${encodeURIComponent(pageStartsAt)}`;
  return url;
}

function getThreadParticipants(thread) {
  const resolution = thread?.participantsResolutionResults || {};
  const participants = Array.isArray(thread?.participants) ? thread.participants : Object.keys(resolution);
  return participants.map((urn) => resolution[urn] || { entityUrn: urn }).filter(Boolean);
}

function isSelfParticipant(profile) {
  const degree = String(profile?.degree ?? '').trim();
  return degree === '0';
}

function otherParticipantName(thread) {
  const participants = getThreadParticipants(thread);
  const other = participants.find((p) => !isSelfParticipant(p)) || participants[0];
  return normalizeWhitespace(other?.fullName || [other?.firstName, other?.lastName].filter(Boolean).join(' '));
}

function parseSalesnavThreads(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) {
    throw new CommandExecutionError('Sales Navigator messaging threads API returned malformed payload');
  }
  return json.elements.map((thread) => {
    if (!thread || typeof thread !== 'object') {
      throw new CommandExecutionError('Sales Navigator messaging threads API returned malformed thread row');
    }
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    const lastMessage = messages[0] || {};
    const deliveredAt = Number(lastMessage.deliveredAt || thread?.nextPageStartsAt || 0);
    const threadId = normalizeWhitespace(thread?.id || '');
    if (!threadId) {
      throw new CommandExecutionError('Sales Navigator messaging thread row missing id');
    }
    return {
      thread_id: threadId,
      thread_url: salesnavThreadUrl(threadId),
      person_name: otherParticipantName(thread),
      last_message_snippet: normalizeWhitespace(lastMessage.body || lastMessage.subject || '').slice(0, 300),
      last_activity_time: deliveredAt ? new Date(deliveredAt).toISOString() : '',
      unread: Number(thread?.unreadMessageCount || 0) > 0,
      unread_count: Number(thread?.unreadMessageCount || 0),
      total_message_count: Number(thread?.totalMessageCount || messages.length || 0),
      archived: Boolean(thread?.archived),
      next_page_starts_at: normalizeWhitespace(thread?.nextPageStartsAt || ''),
      participants: getThreadParticipants(thread).map((p) => ({
        name: normalizeWhitespace(p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ')),
        entity_urn: normalizeWhitespace(p.entityUrn || ''),
        object_urn: normalizeWhitespace(p.objectUrn || ''),
        degree: normalizeWhitespace(p.degree ?? ''),
      })),
    };
  });
}

function fetchJsonScript(url, csrf) {
  return String.raw`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: {
          'csrf-token': ${JSON.stringify(csrf)},
          'x-restli-protocol-version': '2.0.0',
          accept: 'application/json',
        },
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      if (res.status === 401 || res.status === 403) return { authRequired: true, status: res.status, text };
      if (!res.ok) return { error: 'HTTP ' + res.status, status: res.status, text, json };
      return { status: res.status, json };
    } catch (e) {
      return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
  })()`;
}

export async function getCsrf(page) {
  const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
  const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
  if (!jsession) throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn.');
  return jsession.replace(/^\"|\"$/g, '');
}

export async function fetchSalesnavJson(page, csrf, url, label) {
  const result = unwrapEvaluateResult(await page.evaluate(fetchJsonScript(url, csrf)));
  if (result?.authRequired) throw new AuthRequiredError(LINKEDIN_DOMAIN, `${label} authentication failed (HTTP ${result.status || 'auth_required'}).`);
  if (result?.error || !result?.json) throw new CommandExecutionError(`${label} returned an unexpected response`, `${result?.error || 'no_json'}\n${normalizeWhitespace(result?.text || '').slice(0, 500)}`);
  return result.json;
}

export async function fetchInboxRows(page, { limit = DEFAULT_LIMIT, maxPages = 30 } = {}) {
  const csrf = await getCsrf(page);
  const rows = [];
  const seen = new Set();
  let pageStartsAt = '';
  let pagesFetched = 0;
  let hasMorePages = false;
  while (rows.length < limit && pagesFetched < maxPages) {
    const json = await fetchSalesnavJson(page, csrf, threadListUrl({ count: PAGE_SIZE, pageStartsAt }), 'Sales Navigator messaging threads API');
    pagesFetched += 1;
    const pageRows = parseSalesnavThreads(json);
    if (pageRows.length === 0) break;
    for (const row of pageRows) {
      if (seen.has(row.thread_id)) continue;
      seen.add(row.thread_id);
      rows.push(row);
      if (rows.length >= limit) break;
    }
    const last = pageRows[pageRows.length - 1];
    const next = last?.next_page_starts_at;
    hasMorePages = Boolean(next);
    if (!next) break;
    if (next === pageStartsAt) {
      throw new CommandExecutionError('Sales Navigator messaging threads API returned the same cursor twice');
    }
    pageStartsAt = next;
  }
  if (rows.length < limit && hasMorePages && pagesFetched >= maxPages) {
    throw new CommandExecutionError(`Sales Navigator messaging threads API reached the ${maxPages}-page safety cap before collecting ${limit} conversations`);
  }
  return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

export { THREAD_DECORATION, THREADS_BASE };

cli({
  site: 'linkedin',
  name: 'salesnav-inbox',
  access: 'read',
  description: 'List LinkedIn Sales Navigator message conversations with API pagination',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'limit', type: 'number', default: DEFAULT_LIMIT, help: 'Maximum conversations to return (1-500)' },
    { name: 'max-pages', type: 'number', default: 30, help: 'Maximum Sales Navigator API pages to fetch' },
    { name: 'unread-only', type: 'bool', default: false, help: 'Return only unread conversations' },
  ],
  columns: ['rank', 'thread_id', 'thread_url', 'person_name', 'last_message_snippet', 'last_activity_time', 'unread', 'unread_count', 'total_message_count', 'archived', 'participants', 'next_page_starts_at'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin salesnav-inbox');
    const limit = parseLimit(args.limit);
    const maxPages = parseLimit(args['max-pages'], 30);
    await page.goto(SALES_INBOX_URL);
    await page.wait(4);
    let rows = await fetchInboxRows(page, { limit, maxPages });
    if (args['unread-only']) rows = rows.filter((row) => row.unread);
    if (rows.length === 0) {
      if (args['unread-only']) return [];
      throw new EmptyResultError('linkedin salesnav-inbox', 'No Sales Navigator conversations were found.');
    }
    return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
  },
});

export const __test__ = {
  THREAD_DECORATION,
  normalizeWhitespace,
  parseLimit,
  encodeRestliDecoration,
  salesnavThreadUrl,
  threadListUrl,
  parseSalesnavThreads,
  fetchInboxRows,
};
