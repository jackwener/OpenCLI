import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

export const INBOX_COLUMNS = ['rank', 'conversation_id', 'user_id', 'nickname', 'last_message', 'updated_at', 'unread_count', 'profile_url'];
export const MESSAGE_COLUMNS = ['index', 'conversation_id', 'message_id', 'sender_id', 'is_self', 'type', 'text', 'created_at', 'revoked', 'raw_content'];

export const HISTORY_ARGS = [
    { name: 'target', positional: true, required: true, help: 'Conversation ID or user ID from inbox' },
    { name: 'limit', type: 'int', help: 'Most recent messages to return (default 50; 1-10000); cannot combine with --all' },
    { name: 'all', type: 'bool', default: false, help: 'Read all history available to this web account' },
    { name: 'after-message', help: 'Read after this exact message ID; fail if checkpoint is absent. Default all new messages; --limit selects oldest N new messages.' },
    { name: 'max-pages', type: 'int', default: 200, help: 'Safety bound on history requests (1-2000); fail rather than truncate' },
    { name: 'timeout', type: 'int', default: 120, help: 'Command timeout in seconds (1-3600)' },
];

export function positiveInteger(value, fallback, maximum, label) {
    const raw = value ?? fallback;
    if (raw === '' || typeof raw === 'boolean') throw new ArgumentError(`${label} must be an integer between 1 and ${maximum}`);
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > maximum) {
        throw new ArgumentError(`${label} must be an integer between 1 and ${maximum}`);
    }
    return numeric;
}

export function parseHistoryOptions(args) {
    if (args.all && args.limit != null) throw new ArgumentError('--all and --limit cannot be combined');
    const afterMessage = args['after-message'];
    if (afterMessage != null && (typeof afterMessage !== 'string' || !afterMessage || /\s/.test(afterMessage) || afterMessage.length > 256)) {
        throw new ArgumentError('--after-message must be a non-empty exact message ID (maximum 256 characters)');
    }
    if (afterMessage != null && args.all) throw new ArgumentError('--after-message and --all cannot be combined');
    return {
        ...(afterMessage == null ? {} : { afterMessage, incrementalLimit: args.limit == null ? null : positiveInteger(args.limit, 50, 10000, '--limit') }),
        all: Boolean(args.all),
        limit: positiveInteger(args.limit, 50, 10000, '--limit'),
        maxPages: positiveInteger(args['max-pages'], 200, 2000, '--max-pages'),
        timeout: positiveInteger(args.timeout, 120, 3600, '--timeout'),
    };
}

export function requireObject(payload, label) {
    const result = payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload
        ? payload.data : payload;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new CommandExecutionError(`${label}: malformed browser response`);
    }
    return result;
}

export function isoTime(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) {
        throw new CommandExecutionError(`${label}: invalid message timestamp`);
    }
    return new Date(value).toISOString();
}

export function contentObject(value, label) {
    if (typeof value !== 'string') throw new CommandExecutionError(`${label}: missing message content`);
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
        return parsed;
    } catch {
        throw new CommandExecutionError(`${label}: invalid message content JSON`);
    }
}

/** Collect newest-first pages, then emit chronological rows. All/incremental reads never silently truncate. */
export async function collectHistory({ label, options, cursor, fetchPage, project, pause }) {
    const byId = new Map();
    const visited = new Set();
    const deadline = Date.now() + (options.timeout ?? 120) * 1000;
    const assertTime = () => {
        if (Date.now() >= deadline) throw new TimeoutError(label, options.timeout ?? 120);
    };
    let finished = false;
    let checkpointPosition = null;
    for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex += 1) {
        assertTime();
        const key = String(cursor);
        if (visited.has(key)) throw new CommandExecutionError(`${label}: history cursor repeated; refusing incomplete history`);
        visited.add(key);
        const page = await fetchPage(cursor);
        assertTime();
        if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean') {
            throw new CommandExecutionError(`${label}: malformed history page`);
        }
        for (const item of page.items) {
            const row = project(item);
            if (row == null) continue; // Explicit server control records, not user-visible messages.
            if (!row.message_id || typeof row.orderKey !== 'string' || !/^\d+$/.test(row.orderKey)) {
                throw new CommandExecutionError(`${label}: message is missing its stable ID or conversation position`);
            }
            if (byId.has(row.message_id) && byId.get(row.message_id).orderKey !== row.orderKey) {
                throw new CommandExecutionError(`${label}: duplicate message ID has conflicting positions`);
            }
            if (!byId.has(row.message_id)) byId.set(row.message_id, row);
            if (row.message_id === options.afterMessage) checkpointPosition = BigInt(row.orderKey);
        }
        if (!page.hasMore || (options.afterMessage ? checkpointPosition !== null : !options.all && byId.size >= options.limit)) {
            finished = true;
            break;
        }
        if (page.nextCursor == null || String(page.nextCursor) === key || page.items.length === 0) {
            throw new CommandExecutionError(`${label}: history pagination stalled; refusing incomplete history`);
        }
        cursor = page.nextCursor;
        if (pageIndex + 1 < options.maxPages) await pause();
    }
    if (!finished) {
        throw new CommandExecutionError(`${label}: reached --max-pages before history was complete`, 'Increase --max-pages and --timeout, or request recent messages with --limit.');
    }
    if (options.afterMessage && checkpointPosition === null) {
        throw new CommandExecutionError(`${label}: --after-message checkpoint was not found; refusing an incremental read with a possible gap`, 'Reconcile accessible history and the stored conversation watermark before retrying.');
    }
    if (byId.size === 0) throw new EmptyResultError(label, 'No messages are available in this private conversation.');
    const rows = [...byId.values()].sort((a, b) => BigInt(a.orderKey) < BigInt(b.orderKey) ? -1 : BigInt(a.orderKey) > BigInt(b.orderKey) ? 1 : 0);
    const newer = options.afterMessage ? rows.filter(row => BigInt(row.orderKey) > checkpointPosition) : rows;
    const selected = options.afterMessage ? (options.incrementalLimit == null ? newer : newer.slice(0, options.incrementalLimit)) : options.all ? rows : rows.slice(-options.limit);
    return selected.map(({ orderKey: _orderKey, ...row }, index) => ({ index: index + 1, ...row }));
}
