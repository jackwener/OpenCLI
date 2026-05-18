import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  THREAD_DECORATION,
  THREADS_BASE,
  encodeRestliDecoration,
  fetchInboxRows,
  fetchSalesnavJson,
  getCsrf,
  normalizeWhitespace,
  parseLimit,
} from './salesnav-inbox.js';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SALES_INBOX_URL = 'https://www.linkedin.com/sales/inbox/';
const DEFAULT_MESSAGE_LIMIT = 200;
const THREAD_PAGE_SIZE = 20;

function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

function parseSalesProfileUrn(value) {
  const raw = normalizeWhitespace(value);
  const match = raw.match(/^urn:li:fs_salesProfile:\(([^,()]+),([^,()]+),([^,()]+)\)$/);
  if (!match) return '';
  const parts = [match[1], match[2], match[3]].map((part) => normalizeWhitespace(part).toLowerCase());
  if (parts.some((part) => !part || part === 'undefined' || part === 'null' || part === 'not_available')) return '';
  return raw;
}

function parseThreadInput(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return ['empty', ''];
  if (/^2-[A-Za-z0-9+/=_-]+$/.test(raw)) return ['thread_id', raw];
  if (/^urn:li:fs_salesProfile:\(/.test(raw)) {
    const urn = parseSalesProfileUrn(raw);
    if (!urn) throw new ArgumentError('Sales Navigator recipient urn must be urn:li:fs_salesProfile:(profileId,authType,authToken)');
    return ['recipient_urn', urn];
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !isLinkedInHost(url.hostname)) return ['name', raw.toLowerCase()];
    const inboxMatch = url.pathname.match(/^\/sales\/inbox\/([^/]+)\/?$/i);
    if (inboxMatch) return ['thread_id', decodeURIComponent(inboxMatch[1])];
    const leadMatch = url.pathname.match(/^\/sales\/lead\/([^,/]+),([^,/]+),([^/]+)\/?$/i);
    if (leadMatch) {
      const urn = `urn:li:fs_salesProfile:(${decodeURIComponent(leadMatch[1])},${decodeURIComponent(leadMatch[2])},${decodeURIComponent(leadMatch[3])})`;
      if (!parseSalesProfileUrn(urn)) {
        throw new ArgumentError('Sales Navigator lead URL must contain resolved profileId, authType, and authToken');
      }
      return ['recipient_urn', urn];
    }
  } catch (err) {
    if (err instanceof ArgumentError) throw err;
    // Fall through to name matching for non-URL text.
  }
  return ['name', raw.toLowerCase()];
}

function salesnavThreadUrl(threadId) {
  return threadId ? `https://www.linkedin.com/sales/inbox/${encodeURIComponent(threadId)}` : '';
}

function threadApiUrl(threadId, messageCount) {
  return `${THREADS_BASE}/${encodeURIComponent(threadId)}?decoration=${encodeRestliDecoration(THREAD_DECORATION)}&count=1&messageCount=${messageCount}`;
}

function participantName(profile) {
  return normalizeWhitespace(profile?.fullName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' '));
}

function participantIndex(thread) {
  const resolution = thread?.participantsResolutionResults || {};
  const participants = Array.isArray(thread?.participants) ? thread.participants : Object.keys(resolution);
  const byUrn = new Map();
  for (const urn of participants) {
    const profile = resolution[urn] || { entityUrn: urn };
    byUrn.set(urn, profile);
  }
  return byUrn;
}

function parseSalesnavThreadMessages(thread) {
  if (!thread || typeof thread !== 'object') {
    throw new CommandExecutionError('Sales Navigator messaging thread API returned malformed payload');
  }
  const threadId = normalizeWhitespace(thread?.id || '');
  if (!threadId) {
    throw new CommandExecutionError('Sales Navigator messaging thread API returned a thread without id');
  }
  if (!Array.isArray(thread?.messages)) {
    throw new CommandExecutionError('Sales Navigator messaging thread API returned malformed messages');
  }
  const byUrn = participantIndex(thread);
  const messages = thread.messages;
  const rows = messages.map((message) => {
    if (!message || typeof message !== 'object') {
      throw new CommandExecutionError('Sales Navigator messaging thread API returned malformed message row');
    }
    const deliveredAt = Number(message?.deliveredAt || 0);
    const senderProfile = byUrn.get(message?.author);
    return {
      message_id: normalizeWhitespace(message?.id || ''),
      thread_id: threadId,
      sender: participantName(senderProfile) || normalizeWhitespace(message?.author || ''),
      sender_urn: normalizeWhitespace(message?.author || ''),
      text: normalizeWhitespace(message?.body || message?.systemMessageContent || ''),
      subject: normalizeWhitespace(message?.subject || ''),
      timestamp: deliveredAt ? new Date(deliveredAt).toISOString() : '',
      delivered_at: deliveredAt || '',
      type: normalizeWhitespace(message?.type || ''),
    };
  }).filter((row) => row.text || row.subject || row.message_id);
  rows.sort((a, b) => Number(a.delivered_at || 0) - Number(b.delivered_at || 0));
  return rows.map((row, index) => ({ index, ...row }));
}

function threadMatchesInput(row, parsed) {
  if (!row || !parsed) return false;
  const [kind, criterion] = parsed;
  if (kind === 'thread_id') return row.thread_id === criterion;
  if (kind === 'recipient_urn') {
    return (row.participants || []).some((p) => normalizeWhitespace(p.entity_urn) === criterion);
  }
  if (kind === 'name') {
    const needle = normalizeWhitespace(criterion).toLowerCase();
    if (!needle) return false;
    if (normalizeWhitespace(row.person_name).toLowerCase() === needle) return true;
    return (row.participants || []).some((p) => normalizeWhitespace(p.name).toLowerCase() === needle);
  }
  return false;
}

async function resolveThreadId(page, input, { maxPages = 30 } = {}) {
  const parsed = parseThreadInput(input);
  if (parsed[0] === 'empty') throw new ArgumentError('thread or recipient is required');
  if (parsed[0] === 'thread_id') return parsed[1];
  const inboxRows = await fetchInboxRows(page, { limit: 500, maxPages });
  const match = inboxRows.find((row) => threadMatchesInput(row, parsed));
  if (!match) {
    throw new EmptyResultError('linkedin salesnav-thread', `No Sales Navigator thread matched ${input}`);
  }
  return match.thread_id;
}

async function fetchThreadWithPagination(page, csrf, threadId, limit = DEFAULT_MESSAGE_LIMIT) {
  let requested = THREAD_PAGE_SIZE;
  if (limit < requested) requested = limit;
  let thread = null;
  for (let attempts = 0; attempts < 30; attempts += 1) {
    thread = await fetchSalesnavJson(page, csrf, threadApiUrl(threadId, requested), 'Sales Navigator messaging thread API');
    const total = Number(thread?.totalMessageCount || 0);
    const have = Array.isArray(thread?.messages) ? thread.messages.length : 0;
    if (have >= limit || (total && have >= total) || requested >= limit) break;
    let nextRequested = requested + THREAD_PAGE_SIZE;
    if (total && total > nextRequested) nextRequested = total;
    if (nextRequested > limit) nextRequested = limit;
    requested = nextRequested;
  }
  const total = Number(thread?.totalMessageCount || 0);
  const have = Array.isArray(thread?.messages) ? thread.messages.length : 0;
  if (total && have < total && have < limit) {
    throw new CommandExecutionError(`Sales Navigator messaging thread API returned partial history (${have}/${total})`);
  }
  return thread;
}

cli({
  site: 'linkedin',
  name: 'salesnav-thread',
  access: 'read',
  description: 'Return full Sales Navigator message history for a thread id, Sales Navigator inbox URL, lead URL, recipient urn, or exact recipient name',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'thread-or-recipient', type: 'string', required: true, positional: true, help: 'Sales Navigator inbox URL/thread id, Sales Navigator lead URL, recipient urn, or exact participant name' },
    { name: 'limit', type: 'number', default: DEFAULT_MESSAGE_LIMIT, help: 'Maximum messages to return (1-500)' },
    { name: 'max-pages', type: 'number', default: 30, help: 'Maximum inbox pages to scan when resolving a recipient' },
  ],
  columns: ['index', 'thread_id', 'thread_url', 'sender', 'text', 'timestamp', 'subject', 'message_id', 'sender_urn', 'delivered_at', 'type', 'total_message_count'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin salesnav-thread');
    const input = normalizeWhitespace(args['thread-or-recipient']);
    if (!input) throw new ArgumentError('thread-or-recipient is required');
    const limit = parseLimit(args.limit, DEFAULT_MESSAGE_LIMIT);
    const maxPages = parseLimit(args['max-pages'], 30);
    await page.goto(SALES_INBOX_URL);
    await page.wait(4);
    const threadId = await resolveThreadId(page, input, { maxPages });
    const csrf = await getCsrf(page);
    const thread = await fetchThreadWithPagination(page, csrf, threadId, limit);
    const messages = parseSalesnavThreadMessages(thread).slice(0, limit);
    if (messages.length === 0) throw new EmptyResultError('linkedin salesnav-thread', `No messages found for ${threadId}`);
    return messages.map((message) => ({
      ...message,
      thread_url: salesnavThreadUrl(threadId),
      total_message_count: Number(thread?.totalMessageCount || messages.length),
    }));
  },
});

export const __test__ = {
  parseThreadInput,
  threadApiUrl,
  participantIndex,
  parseSalesnavThreadMessages,
  threadMatchesInput,
  salesnavThreadUrl,
};
