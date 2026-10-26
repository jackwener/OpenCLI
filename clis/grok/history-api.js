// Grok history read through grok.com's own JSON surfaces.
//
// Chats (/c/<id>) come from the REST endpoints under /rest/app-chat/. Bots
// (/bot/<id>) have no REST surface: the page's bot client speaks JSON-RPC 2.0
// over wss://grok.com/ws/bot/, authenticated by the browser's cookies, so the
// relay session runs inside the grok.com page.
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, LoginWallError, TimeoutError } from '@jackwener/opencli/errors';
import { GROK_DOMAIN } from './utils.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONVERSATION_PAGE_SIZE = 60;
export const MAX_CONVERSATION_PAGES = 1000;
export const RESPONSE_BATCH_SIZE = 10;
export const BOT_TAIL_SIZE = 200;
// The archive cursor means "entries before this seq"; an unbounded one starts at the newest entry.
export const BOT_ARCHIVE_TOP_CURSOR = String(Number.MAX_SAFE_INTEGER);
export const MAX_BOT_PAGES = 1000;
export const BOT_REQUEST_TIMEOUT_MS = 60_000;

const ATTACHMENT_FIELDS = [
    'imageAttachments',
    'fileAttachments',
    'fileAttachmentsMetadata',
    'fileAttachmentAssetMetadata',
    'fileIds',
    'fileUris',
    'generatedImageUrls',
    'imageEditUris',
    'cardAttachmentsJson',
    'webpageUrls',
];

const STEP_KNOWN_FIELDS = new Set(['tags', 'text', 'toolUsageCards', 'toolUsageResults']);
const BOT_ENTRY_KNOWN_FIELDS = new Set(['id', 'entryId', 'kind', 'role', 'timestampMs', 'requestId', 'entryVersion', 'replyTo']);

function malformed(label, hint) {
    return new CommandExecutionError(`${label} returned a malformed payload`, hint);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
    return typeof value === 'string' && value !== '' ? value : null;
}

function isoTime(value) {
    if (value == null || value === '') return null;
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseIdArgument(input, pathPrefix, label) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new ArgumentError(`${label} must be a non-empty ID or grok.com URL`);
    let candidate = raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new ArgumentError(`${label} is not a valid URL (got "${input}")`);
        }
        const host = parsed.hostname.toLowerCase();
        const match = parsed.pathname.match(new RegExp(`^/${pathPrefix}/([0-9a-f-]{36})/?$`, 'i'));
        if (parsed.protocol !== 'https:' || (host !== GROK_DOMAIN && !host.endsWith(`.${GROK_DOMAIN}`)) || !match) {
            throw new ArgumentError(`${label} URL must look like https://grok.com/${pathPrefix}/<id> (got "${input}")`);
        }
        candidate = match[1];
    }
    if (!UUID_RE.test(candidate)) {
        throw new ArgumentError(`${label} must be a UUID or https://grok.com/${pathPrefix}/<id> URL (got "${input}")`);
    }
    return candidate.toLowerCase();
}

export function parseGrokBotId(input) {
    return parseIdArgument(input, 'bot', 'bot id');
}

export function normalizeLimit(value) {
    const n = Number(value ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new ArgumentError('limit must be 0 or a positive integer');
    return n;
}

// page.fetchJson reports every failure as a generic FETCH_ERROR whose message
// starts with the HTTP status and whose hint previews the body; map the
// statuses that have a typed meaning.
export async function grokFetchJson(page, url, opts = {}, { label = url, onNotFound } = {}) {
    try {
        return await page.fetchJson(url, opts);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = Number(/^HTTP (\d{3})\b/.exec(message)?.[1] ?? 0);
        if (status === 401 || status === 403) {
            // An HTML page in place of the API's JSON is grok.com's Cloudflare
            // front (a block or challenge page), which signing in again cannot fix.
            const preview = /^Response preview: (<.*)$/s.exec(error?.hint ?? '')?.[1];
            if (preview && /^<(?:!doctype|html)\b/i.test(preview)) {
                throw new LoginWallError(
                    `${label} got an HTML page instead of JSON (HTTP ${status})`,
                    status,
                    url,
                    preview.slice(0, 100),
                    'grok.com\'s Cloudflare front answered, not the Grok API. Open https://grok.com in the browser: '
                        + 'if it shows "Sorry, you have been blocked", this network\'s IP is blocked, so switch networks or retry later.',
                );
            }
            throw new AuthRequiredError(GROK_DOMAIN, 'Sign in to grok.com in the browser, then retry.');
        }
        if (status === 404 && onNotFound) throw onNotFound();
        throw new CommandExecutionError(`${label} failed: ${message}`, 'Retry; if it keeps failing, grok.com may have changed this endpoint.');
    }
}

export async function requireGrokUserId(page) {
    const body = await grokFetchJson(page, '/api/auth/session', {}, { label: 'Grok session lookup' });
    const userId = nonEmptyString(body?.session?.userId);
    if (!userId) throw new AuthRequiredError(GROK_DOMAIN, 'Sign in to grok.com in the browser, then retry.');
    return userId;
}

// --- Chats -----------------------------------------------------------------

export async function listConversations(page) {
    const conversations = [];
    const seenTokens = new Set();
    let token = '';
    for (let pageIndex = 0; pageIndex < MAX_CONVERSATION_PAGES; pageIndex += 1) {
        const query = new URLSearchParams({ pageSize: String(CONVERSATION_PAGE_SIZE) });
        if (token) query.set('pageToken', token);
        const body = await grokFetchJson(page, `/rest/app-chat/conversations?${query}`, {}, { label: 'Grok conversation list' });
        if (!isPlainObject(body) || !Array.isArray(body.conversations)) {
            throw malformed('Grok conversation list', 'Expected a conversations array.');
        }
        conversations.push(...body.conversations);
        token = nonEmptyString(body.nextPageToken) ?? '';
        if (!token) return conversations;
        if (seenTokens.has(token)) {
            throw new CommandExecutionError('Grok conversation list repeated a page token', 'The list cannot be enumerated completely; retry later.');
        }
        seenTokens.add(token);
    }
    throw new CommandExecutionError(`Grok conversation list exceeded ${MAX_CONVERSATION_PAGES} pages`, 'The list cannot be enumerated completely.');
}

export function normalizeConversationRow(conversation, index) {
    if (!isPlainObject(conversation)) {
        throw malformed('Grok conversation list', `Conversation ${index + 1} is not an object.`);
    }
    const id = String(conversation.conversationId ?? '').toLowerCase();
    if (!UUID_RE.test(id)) {
        throw malformed('Grok conversation list', `Conversation ${index + 1} has no valid conversationId.`);
    }
    return {
        index: index + 1,
        id,
        title: nonEmptyString(conversation.title),
        createdAt: isoTime(conversation.createTime),
        updatedAt: isoTime(conversation.modifyTime),
        starred: conversation.starred === true,
        temporary: conversation.temporary === true,
        url: `https://grok.com/c/${id}`,
    };
}

export async function loadConversation(page, conversationId) {
    const base = `/rest/app-chat/conversations/${conversationId}`;
    const notFound = () => new EmptyResultError('grok transcript', `Conversation ${conversationId} was not found for the signed-in account.`);
    const tree = await grokFetchJson(page, `${base}/response-node`, {}, { label: 'Grok response tree', onNotFound: notFound });
    if (!isPlainObject(tree) || !Array.isArray(tree.responseNodes)) {
        throw malformed('Grok response tree', 'Expected a responseNodes array.');
    }
    const ids = tree.responseNodes.map((node, i) => {
        const id = nonEmptyString(node?.responseId);
        if (!id) throw malformed('Grok response tree', `Node ${i + 1} has no responseId.`);
        return id;
    });
    const responses = new Map();
    for (let start = 0; start < ids.length; start += RESPONSE_BATCH_SIZE) {
        const batch = ids.slice(start, start + RESPONSE_BATCH_SIZE);
        const body = await grokFetchJson(page, `${base}/load-responses`, { method: 'POST', body: { responseIds: batch } }, { label: 'Grok response bodies', onNotFound: notFound });
        if (!isPlainObject(body) || !Array.isArray(body.responses)) {
            throw malformed('Grok response bodies', 'Expected a responses array.');
        }
        for (const response of body.responses) {
            const id = nonEmptyString(response?.responseId);
            if (id) responses.set(id, response);
        }
    }
    const missing = ids.filter((id) => !responses.has(id));
    if (missing.length) {
        throw new CommandExecutionError(
            `Grok returned ${ids.length - missing.length} of ${ids.length} responses for conversation ${conversationId}`,
            'Retry; a transcript with missing turns is not returned partially.',
        );
    }
    return { nodes: tree.responseNodes, responses: ids.map((id) => responses.get(id)) };
}

function normalizeToolCall(card) {
    if (!isPlainObject(card)) return null;
    const name = Object.keys(card).find((key) => key !== 'toolUsageCardId') ?? null;
    const payload = name ? card[name] : null;
    return {
        id: nonEmptyString(card.toolUsageCardId),
        name,
        input: isPlainObject(payload) && Object.hasOwn(payload, 'args') ? payload.args : payload,
    };
}

function normalizeToolResult(result) {
    if (!isPlainObject(result)) return null;
    const kind = Object.keys(result).find((key) => key !== 'toolUsageCardId') ?? null;
    return {
        toolCallId: nonEmptyString(result.toolUsageCardId),
        kind,
        content: kind ? result[kind] : null,
    };
}

function nonEmptyFields(source, keys) {
    const out = {};
    for (const key of keys) {
        const value = source[key];
        if (value == null || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (isPlainObject(value) && Object.keys(value).length === 0) continue;
        out[key] = value;
    }
    return out;
}

export function normalizeSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.filter(isPlainObject).map((step) => {
        const extras = nonEmptyFields(step, Object.keys(step).filter((key) => !STEP_KNOWN_FIELDS.has(key)));
        return {
            tags: Array.isArray(step.tags) ? step.tags.map(String) : [],
            text: Array.isArray(step.text) ? step.text.filter((t) => typeof t === 'string') : [],
            toolCalls: Array.isArray(step.toolUsageCards) ? step.toolUsageCards.map(normalizeToolCall).filter(Boolean) : [],
            toolResults: Array.isArray(step.toolUsageResults) ? step.toolUsageResults.map(normalizeToolResult).filter(Boolean) : [],
            ...(Object.keys(extras).length ? { extras } : {}),
        };
    });
}

function normalizeSender(sender) {
    const value = String(sender ?? '').toLowerCase();
    if (value === 'human') return 'user';
    return value || 'unknown';
}

export function normalizeTranscriptRows(nodes, responses) {
    return responses.map((response, index) => {
        const attachments = nonEmptyFields(response, ATTACHMENT_FIELDS);
        return {
            index: index + 1,
            id: response.responseId,
            parentId: nonEmptyString(response.parentResponseId ?? nodes[index]?.parentResponseId),
            role: normalizeSender(response.sender ?? nodes[index]?.sender),
            text: nonEmptyString(response.message),
            model: nonEmptyString(response.model),
            effort: nonEmptyString(response.metadata?.request_metadata?.effort),
            createdAt: isoTime(response.createTime),
            partial: response.partial === true,
            thinkingStartTime: isoTime(response.thinkingStartTime),
            thinkingEndTime: isoTime(response.thinkingEndTime),
            steps: normalizeSteps(response.steps),
            attachments: Object.keys(attachments).length ? attachments : null,
        };
    });
}

// --- Bots ------------------------------------------------------------------

// Runs inside the grok.com page; must not reference anything outside itself.
export function runBotRelayInPage(userId, task) {
    return new Promise((resolve) => {
        const pending = new Map();
        let nextId = 1;
        let settled = false;
        let socket;
        let helloTimer = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(helloTimer);
            for (const entry of pending.values()) clearTimeout(entry.timer);
            pending.clear();
            if (socket) {
                socket.onclose = null;
                try { socket.close(); } catch { /* already closed */ }
            }
            resolve(result);
        };
        const request = (method, params) => new Promise((res, rej) => {
            const id = String(nextId++);
            const timer = setTimeout(() => {
                pending.delete(id);
                rej({ code: 'TIMEOUT', method });
            }, task.requestTimeoutMs);
            pending.set(id, { res, rej, timer, method });
            socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
        const decodeBody = (body) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))));
        const run = async (hello) => {
            const versions = Array.isArray(hello.supported_protocol_versions) ? hello.supported_protocol_versions : [];
            if (!versions.includes('1.0.0')) return { ok: false, code: 'PROTOCOL', versions };
            if (task.type === 'agents') {
                const agents = await request('bot.command', { agentId: '', name: 'listAgents', args: {} });
                return { ok: true, agents };
            }
            const tail = await request('bot.command', {
                agentId: task.agentId,
                name: 'getAgentTranscriptTail',
                args: { id: task.agentId, limit: task.tailSize },
            });
            if (!tail || !Array.isArray(tail.entries)) return { ok: false, code: 'SHAPE', detail: 'transcript tail has no entries array' };
            const archivePages = [];
            const seenCursors = new Set();
            let cursor = task.topCursor;
            while (cursor !== undefined && cursor !== null && cursor !== '') {
                if (archivePages.length >= task.maxPages) return { ok: false, code: 'PAGE_LIMIT', pages: archivePages.length };
                const key = String(cursor);
                if (seenCursors.has(key)) return { ok: false, code: 'CURSOR_REPEAT', pages: archivePages.length };
                seenCursors.add(key);
                const pageResult = await request('bot.transcript.offbox', { agentId: task.agentId, cursor: key });
                if (!pageResult || !Array.isArray(pageResult.entries)) return { ok: false, code: 'SHAPE', detail: 'archive page has no entries array' };
                if (pageResult.entries.length === 0) break;
                const decoded = [];
                for (const item of pageResult.entries) {
                    try {
                        decoded.push({ seq: item.seq, updatedSeq: item.updatedSeq, entry: decodeBody(item.body) });
                    } catch {
                        return { ok: false, code: 'DECODE', entryId: item?.entryId ?? null };
                    }
                }
                archivePages.push(decoded);
                cursor = pageResult.nextCursor;
            }
            return { ok: true, tail: tail.entries, archivePages };
        };
        try {
            socket = new WebSocket(`wss://${location.host}/ws/bot/?uid=${encodeURIComponent(userId)}`);
        } catch (error) {
            resolve({ ok: false, code: 'CONNECT', detail: String(error) });
            return;
        }
        helloTimer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT', method: 'hello' }), task.requestTimeoutMs);
        socket.onopen = () => socket.send(JSON.stringify({ protocol_version: '1.0.0', kind: 'bot_client' }));
        socket.onerror = () => finish({ ok: false, code: 'CONNECT' });
        socket.onclose = (event) => finish({ ok: false, code: 'CLOSED', closeCode: event.code, reason: event.reason || null });
        socket.onmessage = (event) => {
            let frame;
            try { frame = JSON.parse(event.data); } catch { return; }
            if (!frame || typeof frame !== 'object') return;
            if (Object.hasOwn(frame, 'connection_id')) {
                clearTimeout(helloTimer);
                run(frame).then(finish, (error) => finish({ ok: false, ...(error && error.code ? error : { code: 'RPC', error: String(error) }) }));
                return;
            }
            if (frame.method === 'ping') {
                socket.send(JSON.stringify({ method: 'pong', ts_ms: frame.ts_ms ?? Date.now() }));
                return;
            }
            if (frame.method) return;
            const entry = pending.get(String(frame.id));
            if (!entry) return;
            pending.delete(String(frame.id));
            clearTimeout(entry.timer);
            if (frame.error) entry.rej({ code: 'RPC', method: entry.method, error: frame.error });
            else entry.res(frame.result);
        };
    });
}

export function relayError(result, label) {
    const code = result?.code;
    if (code === 'TIMEOUT') {
        return new TimeoutError(`${label} (${result.method ?? 'relay'})`, Math.round(BOT_REQUEST_TIMEOUT_MS / 1000));
    }
    if (code === 'RPC') {
        const detail = result.error && typeof result.error === 'object' ? JSON.stringify(result.error).slice(0, 300) : String(result.error ?? '');
        return new CommandExecutionError(`${label}: ${result.method ?? 'relay'} failed`, detail || undefined);
    }
    if (code === 'CLOSED') {
        return new CommandExecutionError(
            `${label}: bot relay closed the connection (code ${result.closeCode ?? 'unknown'})`,
            'Reload grok.com in the browser and retry.',
        );
    }
    if (code === 'CONNECT') return new CommandExecutionError(`${label}: could not connect to the bot relay`, 'Check that grok.com is reachable in the browser.');
    if (code === 'PROTOCOL') return new CommandExecutionError(`${label}: bot relay no longer speaks protocol 1.0.0`, `Server offers: ${(result.versions ?? []).join(', ') || 'none'}`);
    if (code === 'PAGE_LIMIT' || code === 'CURSOR_REPEAT') {
        return new CommandExecutionError(`${label}: transcript paging did not terminate after ${result.pages} pages`, 'The transcript cannot be read completely; retry later.');
    }
    if (code === 'DECODE') return malformed(label, `Could not decode archived entry ${result.entryId ?? '(unknown)'}.`);
    return malformed(label, result?.detail ?? 'Unexpected bot relay result.');
}

export async function runBotRelay(page, userId, task, label) {
    const result = await page.evaluate(runBotRelayInPage, userId, { requestTimeoutMs: BOT_REQUEST_TIMEOUT_MS, maxPages: MAX_BOT_PAGES, tailSize: BOT_TAIL_SIZE, topCursor: BOT_ARCHIVE_TOP_CURSOR, ...task });
    if (!isPlainObject(result)) throw malformed(label, 'Expected an object from the Grok page.');
    if (result.ok !== true) throw relayError(result, label);
    return result;
}

export function normalizeBotRow(agent, index) {
    if (!isPlainObject(agent)) throw malformed('Grok bot list', `Bot ${index + 1} is not an object.`);
    const id = String(agent.id ?? '').toLowerCase();
    if (!UUID_RE.test(id)) throw malformed('Grok bot list', `Bot ${index + 1} has no valid id.`);
    return {
        index: index + 1,
        id,
        name: nonEmptyString(agent.name),
        description: nonEmptyString(agent.description),
        isGroup: agent.isGroup === true,
        createdAt: isoTime(agent.createdAt),
        updatedAt: isoTime(agent.updatedAt),
        lastActivityAt: isoTime(agent.lastActivityAt),
        url: `https://grok.com/bot/${id}`,
    };
}

function botEntryId(entry) {
    return nonEmptyString(entry?.id ?? entry?.entryId);
}

function archiveSeq(value) {
    const text = typeof value === 'number' ? String(value) : value;
    return typeof text === 'string' && /^\d+$/.test(text) ? BigInt(text) : null;
}

// A bot transcript has two copies. The archive (bot.transcript.offbox) holds
// every entry, newest first, as raw bodies with a creation `seq` and a
// last-write `updatedSeq` (decimal strings); paging it from an unbounded
// "before" cursor reads it whole. The tail (getAgentTranscriptTail) holds the
// newest entries in creation order and may hold entries the archive has not
// caught up with. The copies can differ at the same version: the tail has
// been seen to reduce markdown links with an app-internal scheme to their
// text, while the archive keeps them. Archived bodies omit entryVersion, which
// equals updatedSeq. For each id the higher version wins and the archive wins
// a tie; entries only the tail has come last, in tail order.
export function mergeBotEntries(tail, archivePages) {
    const archived = new Map();
    for (const item of archivePages.flat()) {
        const id = botEntryId(item?.entry);
        if (!id) throw malformed('Grok bot transcript', 'An archived entry has no id.');
        const seq = archiveSeq(item.seq);
        if (seq === null) throw malformed('Grok bot transcript', `Archived entry ${id} has no sequence number.`);
        if (archived.has(id)) continue;
        const updatedSeq = archiveSeq(item.updatedSeq);
        const entry = !Number.isInteger(item.entry.entryVersion) && updatedSeq !== null && updatedSeq <= BigInt(Number.MAX_SAFE_INTEGER)
            ? { ...item.entry, entryVersion: Number(updatedSeq) }
            : item.entry;
        archived.set(id, { seq, entry });
    }
    const tailById = new Map();
    for (const entry of tail) {
        const id = botEntryId(entry);
        if (!id) throw malformed('Grok bot transcript', 'A transcript entry has no id.');
        tailById.set(id, entry);
    }
    const version = (entry) => (Number.isInteger(entry?.entryVersion) ? entry.entryVersion : -1);
    const ordered = [...archived.entries()]
        .sort(([, a], [, b]) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
        .map(([id, { entry }]) => {
            const newer = tailById.get(id);
            return newer && version(newer) > version(entry) ? newer : entry;
        });
    const tailOnly = tail.filter((entry) => !archived.has(botEntryId(entry)));
    return [...ordered, ...tailOnly];
}

function botEntryText(entry) {
    if (entry.kind === 'message') return nonEmptyString(entry.content);
    if (entry.kind === 'send-message' || entry.kind === 'sendMessage') {
        const message = entry.message;
        if (!isPlainObject(message)) return null;
        if (message.type === 'text') return nonEmptyString(message.content);
        if (message.type === 'widget') return nonEmptyString(message.widget?.prompt);
        if (message.type === 'auto-review-approval') return nonEmptyString(message.approval?.summary);
        return nonEmptyString(message.content);
    }
    return null;
}

function botEntryRole(entry) {
    if (entry.kind === 'message') return nonEmptyString(entry.role) ?? 'user';
    if (entry.kind === 'user-attachment') return 'user';
    if (entry.kind === 'send-message' || entry.kind === 'sendMessage') return 'assistant';
    return 'system';
}

export function normalizeBotEntryRow(entry, index) {
    if (!isPlainObject(entry)) throw malformed('Grok bot transcript', `Entry ${index + 1} is not an object.`);
    const id = nonEmptyString(entry.id ?? entry.entryId);
    const kind = nonEmptyString(entry.kind);
    if (!id || !kind) throw malformed('Grok bot transcript', `Entry ${index + 1} has no id or kind.`);
    const extras = nonEmptyFields(entry, Object.keys(entry).filter((key) => !BOT_ENTRY_KNOWN_FIELDS.has(key)));
    return {
        index: index + 1,
        id,
        kind,
        type: nonEmptyString(entry.message?.type ?? entry.event?.type),
        role: botEntryRole(entry),
        text: botEntryText(entry),
        createdAt: isoTime(entry.timestampMs),
        requestId: nonEmptyString(entry.requestId),
        entryVersion: Number.isInteger(entry.entryVersion) ? entry.entryVersion : null,
        replyTo: nonEmptyString(entry.replyTo),
        extras: Object.keys(extras).length ? extras : null,
    };
}
