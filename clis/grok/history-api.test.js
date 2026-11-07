import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, LoginWallError, TimeoutError } from '@jackwener/opencli/errors';
import {
    BOT_ARCHIVE_TOP_CURSOR,
    grokFetchJson,
    listConversations,
    loadConversation,
    mergeBotEntries,
    normalizeBotEntryRow,
    normalizeBotRow,
    normalizeConversationRow,
    normalizeLimit,
    normalizeSteps,
    normalizeTranscriptRows,
    parseGrokBotId,
    relayError,
    runBotRelayInPage,
} from './history-api.js';

const BOT = '0e3b9a52-6d4f-4c1e-8a27-93f5b1c0d6e4';
const CONV = '7c4197f2-10a1-4ebb-a84a-fea89f4f1d06';

// page.fetchJson's failure shape: the status leads the message, the body preview is the hint.
function httpError(status, hint) {
    return new CliError('FETCH_ERROR', `HTTP ${status} Error from https://grok.com/x`, hint);
}

describe('grok history argument parsing', () => {
    it('accepts a bot UUID or bot URL', () => {
        expect(parseGrokBotId(BOT.toUpperCase())).toBe(BOT);
        expect(parseGrokBotId(`https://grok.com/bot/${BOT}`)).toBe(BOT);
        expect(parseGrokBotId(`https://grok.com/bot/${BOT}/`)).toBe(BOT);
    });

    it('rejects chat URLs, foreign hosts and malformed ids', () => {
        expect(() => parseGrokBotId(`https://grok.com/c/${BOT}`)).toThrow(ArgumentError);
        expect(() => parseGrokBotId(`https://evil.com/bot/${BOT}`)).toThrow(ArgumentError);
        expect(() => parseGrokBotId('tbs0')).toThrow(ArgumentError);
        expect(() => parseGrokBotId('')).toThrow(ArgumentError);
    });

    it('validates limit without clamping', () => {
        expect(normalizeLimit(undefined)).toBe(0);
        expect(normalizeLimit(5)).toBe(5);
        expect(() => normalizeLimit(-1)).toThrow(ArgumentError);
        expect(() => normalizeLimit(1.5)).toThrow(ArgumentError);
    });
});

describe('grokFetchJson', () => {
    it('maps 401/403 to AuthRequiredError and 404 to the caller error', async () => {
        const page = { fetchJson: vi.fn() };
        page.fetchJson.mockRejectedValueOnce(httpError(401));
        await expect(grokFetchJson(page, '/x')).rejects.toBeInstanceOf(AuthRequiredError);
        page.fetchJson.mockRejectedValueOnce(httpError(404));
        await expect(grokFetchJson(page, '/x', {}, { onNotFound: () => new EmptyResultError('t', 'gone') }))
            .rejects.toBeInstanceOf(EmptyResultError);
        page.fetchJson.mockRejectedValueOnce(httpError(500));
        await expect(grokFetchJson(page, '/x')).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('reports a Cloudflare HTML page as a login wall, not as signed out', async () => {
        const page = { fetchJson: vi.fn() };
        page.fetchJson.mockRejectedValueOnce(httpError(403, 'Response preview: <!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US">'));
        const blocked = await grokFetchJson(page, '/api/auth/session').catch(error => error);
        expect(blocked).toBeInstanceOf(LoginWallError);
        expect(blocked).toMatchObject({ code: 'LOGIN_WALL', status: 403, url: '/api/auth/session' });
        expect(blocked.bodyPreview).toMatch(/^<!DOCTYPE html>/);
        page.fetchJson.mockRejectedValueOnce(httpError(403, 'Response preview: {"error":{"code":7,"message":"forbidden"}}'));
        await expect(grokFetchJson(page, '/x')).rejects.toBeInstanceOf(AuthRequiredError);
    });
});

describe('grok chat history', () => {
    it('follows page tokens until the list ends', async () => {
        const page = {
            fetchJson: vi.fn()
                .mockResolvedValueOnce({ conversations: [{ conversationId: CONV }], nextPageToken: 't1' })
                .mockResolvedValueOnce({ conversations: [{ conversationId: CONV.replace('7c', '8c') }] }),
        };
        const rows = await listConversations(page);
        expect(rows).toHaveLength(2);
        expect(page.fetchJson.mock.calls[1][0]).toContain('pageToken=t1');
    });

    it('fails instead of looping on a repeated page token', async () => {
        const page = { fetchJson: vi.fn().mockResolvedValue({ conversations: [], nextPageToken: 'same' }) };
        await expect(listConversations(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('normalizes a conversation row and rejects rows without an id', () => {
        expect(normalizeConversationRow({
            conversationId: CONV.toUpperCase(), title: 'Hi', createTime: '2026-10-01T00:00:00Z', modifyTime: '2026-10-02T00:00:00Z', starred: true,
        }, 0)).toEqual({
            index: 1, id: CONV, title: 'Hi', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
            starred: true, temporary: false, url: `https://grok.com/c/${CONV}`,
        });
        expect(() => normalizeConversationRow({ title: 'x' }, 0)).toThrow(CommandExecutionError);
    });

    it('loads response bodies in batches and refuses a partial transcript', async () => {
        const nodes = Array.from({ length: 12 }, (_, i) => ({ responseId: `r${i}`, sender: i % 2 ? 'assistant' : 'human' }));
        const page = {
            fetchJson: vi.fn(async (url, opts) => {
                if (url.endsWith('/response-node')) return { responseNodes: nodes };
                return { responses: opts.body.responseIds.map((responseId) => ({ responseId })) };
            }),
        };
        const { responses } = await loadConversation(page, CONV);
        expect(responses.map((r) => r.responseId)).toEqual(nodes.map((n) => n.responseId));
        expect(page.fetchJson).toHaveBeenCalledTimes(3);

        page.fetchJson = vi.fn(async (url) => (url.endsWith('/response-node') ? { responseNodes: nodes } : { responses: [] }));
        await expect(loadConversation(page, CONV)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('keeps tool calls, results and unknown step fields', () => {
        expect(normalizeSteps([{
            tags: ['tool_usage_card'],
            text: ['searching'],
            toolUsageCards: [{ toolUsageCardId: 'c1', webSearch: { args: { query: 'q' } } }],
            toolUsageResults: [{ toolUsageCardId: 'c1', webSearchResults: { results: [{ url: 'https://a' }] } }],
            xposts: [{ id: 1 }],
            ragResults: [],
        }])).toEqual([{
            tags: ['tool_usage_card'],
            text: ['searching'],
            toolCalls: [{ id: 'c1', name: 'webSearch', input: { query: 'q' } }],
            toolResults: [{ toolCallId: 'c1', kind: 'webSearchResults', content: { results: [{ url: 'https://a' }] } }],
            extras: { xposts: [{ id: 1 }] },
        }]);
    });

    it('maps turns to rows without dropping empty messages', () => {
        const rows = normalizeTranscriptRows(
            [{ responseId: 'a' }, { responseId: 'b' }],
            [
                { responseId: 'a', sender: 'human', message: 'hi', createTime: '2026-10-01T00:00:00Z', parentResponseId: 'outside', model: '' },
                { responseId: 'b', sender: 'assistant', message: '', parentResponseId: 'a', model: 'grok-4', partial: true,
                    metadata: { request_metadata: { effort: 'high' } }, cardAttachmentsJson: ['{}'], imageAttachments: [] },
            ],
        );
        expect(rows[0]).toMatchObject({ index: 1, id: 'a', parentId: 'outside', role: 'user', text: 'hi', model: null, attachments: null });
        expect(rows[1]).toMatchObject({ index: 2, id: 'b', parentId: 'a', role: 'assistant', text: null, model: 'grok-4', effort: 'high',
            partial: true, attachments: { cardAttachmentsJson: ['{}'] } });
    });
});

describe('grok bot rows', () => {
    it('normalizes a bot', () => {
        expect(normalizeBotRow({ id: BOT, name: 'Trip Planner', createdAt: 0, updatedAt: 1000, isGroup: false }, 0)).toMatchObject({
            index: 1, id: BOT, name: 'Trip Planner', description: null, createdAt: '1970-01-01T00:00:00.000Z', url: `https://grok.com/bot/${BOT}`,
        });
        expect(() => normalizeBotRow({ name: 'x' }, 0)).toThrow(CommandExecutionError);
    });

    it('extracts text and role per entry kind and keeps the rest as extras', () => {
        const rows = [
            { kind: 'message', id: 't0u', role: 'user', content: 'hello', richText: '<p>hello</p>', timestampMs: 0, requestId: 'q', entryVersion: 3 },
            { kind: 'send-message', id: 't0s0', message: { type: 'text', content: 'reply' }, requestId: 'q', entryVersion: 4 },
            { kind: 'send-message', id: 't0s1', message: { type: 'widget', widget: { prompt: 'pick', options: [] } }, respondedValue: 'A' },
            { kind: 'send-message', id: 't0s2', message: { type: 'auto-review-approval', approval: { summary: 'ok?' } } },
            { kind: 'event', id: 'e1', event: { type: 'name-changed', from: 'a', to: 'b' } },
            { kind: 'user-attachment', id: 'f1', file_name: 'x.png' },
        ].map(normalizeBotEntryRow);
        expect(rows.map((r) => [r.role, r.type, r.text])).toEqual([
            ['user', null, 'hello'],
            ['assistant', 'text', 'reply'],
            ['assistant', 'widget', 'pick'],
            ['assistant', 'auto-review-approval', 'ok?'],
            ['system', 'name-changed', null],
            ['user', null, null],
        ]);
        expect(rows[0].extras).toEqual({ content: 'hello', richText: '<p>hello</p>' });
        expect(rows[2].extras).toMatchObject({ respondedValue: 'A' });
        expect(rows[5].extras).toEqual({ file_name: 'x.png' });
        expect(() => normalizeBotEntryRow({ kind: 'message' }, 0)).toThrow(CommandExecutionError);
    });
});

describe('mergeBotEntries', () => {
    const archived = (id, seq, updatedSeq, extra = {}) => ({ seq: String(seq), updatedSeq: String(updatedSeq), entry: { id, kind: 'message', ...extra } });

    it('orders the archive by creation seq across newest-first pages', () => {
        const pages = [
            [archived('c', 9, 9), archived('b', 2, 6)],
            [archived('a', 1, 1)],
        ];
        const merged = mergeBotEntries([], pages);
        expect(merged.map((e) => [e.id, e.entryVersion])).toEqual([['a', 1], ['b', 6], ['c', 9]]);
    });

    it('prefers the archive on a version tie, a newer tail copy otherwise, and appends tail-only entries', () => {
        const pages = [[archived('b', 2, 5, { content: 'archive b' }), archived('a', 1, 1, { content: 'archive a' })]];
        const tail = [
            { id: 'a', kind: 'message', content: 'tail a', entryVersion: 1 },
            { id: 'b', kind: 'message', content: 'tail b', entryVersion: 7 },
            { id: 'n', kind: 'message', content: 'tail n', entryVersion: 8 },
        ];
        expect(mergeBotEntries(tail, pages).map((e) => e.content)).toEqual(['archive a', 'tail b', 'tail n']);
    });

    it('rejects archived entries without an id or seq', () => {
        expect(() => mergeBotEntries([], [[{ seq: '1', entry: { kind: 'message' } }]])).toThrow(CommandExecutionError);
        expect(() => mergeBotEntries([], [[{ seq: 'x', entry: { id: 'a' } }]])).toThrow(CommandExecutionError);
    });
});

describe('relayError', () => {
    it('maps relay failures to typed errors', () => {
        expect(relayError({ code: 'TIMEOUT', method: 'bot.command' }, 'grok bots')).toBeInstanceOf(TimeoutError);
        expect(relayError({ code: 'RPC', method: 'bot.command', error: { code: -32000 } }, 'grok bots')).toBeInstanceOf(CommandExecutionError);
        expect(relayError({ code: 'CLOSED', closeCode: 4409 }, 'grok bots').message).toContain('4409');
        expect(relayError({ code: 'PAGE_LIMIT', pages: 3 }, 'grok bots')).toBeInstanceOf(CommandExecutionError);
    });
});

describe('runBotRelayInPage', () => {
    let handlers;
    let sockets;

    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.sent = [];
            sockets.push(this);
            queueMicrotask(() => this.onopen?.());
        }

        send(data) {
            const frame = JSON.parse(data);
            this.sent.push(frame);
            queueMicrotask(() => handlers.onFrame(this, frame));
        }

        close() {
            this.closed = true;
        }

        deliver(frame) {
            this.onmessage?.({ data: JSON.stringify(frame) });
        }
    }

    const hello = { connection_id: 'c1', user_id: 'u1', supported_protocol_versions: ['1.0.0'], capabilities: [] };
    const encode = (entry) => Buffer.from(JSON.stringify(entry)).toString('base64');
    const task = (extra) => ({ requestTimeoutMs: 1000, maxPages: 10, tailSize: 200, topCursor: BOT_ARCHIVE_TOP_CURSOR, ...extra });

    function serve(rpc, helloFrame = hello) {
        handlers.onFrame = (socket, frame) => {
            if (frame.kind === 'bot_client') {
                socket.deliver(helloFrame);
                socket.deliver({ method: 'ping', ts_ms: 7 });
                return;
            }
            if (frame.jsonrpc) {
                const reply = rpc(frame);
                socket.deliver({ jsonrpc: '2.0', id: frame.id, ...reply });
            }
        };
    }

    beforeEach(() => {
        sockets = [];
        handlers = { onFrame: () => {} };
        vi.stubGlobal('WebSocket', FakeSocket);
        vi.stubGlobal('location', { host: 'grok.com' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('says hello, answers pings and lists agents', async () => {
        serve(() => ({ result: [{ id: BOT }] }));
        const result = await runBotRelayInPage('u 1', task({ type: 'agents' }));
        expect(result).toEqual({ ok: true, agents: [{ id: BOT }] });
        const [socket] = sockets;
        expect(socket.url).toBe('wss://grok.com/ws/bot/?uid=u%201');
        expect(socket.sent[0]).toEqual({ protocol_version: '1.0.0', kind: 'bot_client' });
        expect(socket.sent).toContainEqual({ method: 'pong', ts_ms: 7 });
        expect(socket.sent.find((f) => f.jsonrpc).params).toEqual({ agentId: '', name: 'listAgents', args: {} });
        expect(socket.closed).toBe(true);
    });

    it('reads the tail and pages the archive from the top until an empty page', async () => {
        const cursors = [];
        serve((frame) => {
            if (frame.method === 'bot.command') return { result: { entries: [{ id: 'b' }] } };
            cursors.push(frame.params.cursor);
            if (frame.params.cursor === BOT_ARCHIVE_TOP_CURSOR) {
                return { result: { entries: [{ seq: '2', updatedSeq: '2', entryId: 'b', body: encode({ id: 'b' }) }], nextCursor: '0:1' } };
            }
            return { result: { entries: [] } };
        });
        const result = await runBotRelayInPage('u', task({ type: 'transcript', agentId: BOT }));
        expect(result.ok).toBe(true);
        expect(result.tail).toEqual([{ id: 'b' }]);
        expect(result.archivePages).toEqual([[{ seq: '2', updatedSeq: '2', entry: { id: 'b' } }]]);
        expect(cursors).toEqual([BOT_ARCHIVE_TOP_CURSOR, '0:1']);
    });

    it('stops on a repeated archive cursor', async () => {
        serve((frame) => (frame.method === 'bot.command'
            ? { result: { entries: [] } }
            : { result: { entries: [{ seq: '1', body: encode({ id: 'a' }) }], nextCursor: BOT_ARCHIVE_TOP_CURSOR } }));
        const result = await runBotRelayInPage('u', task({ type: 'transcript', agentId: BOT }));
        expect(result).toMatchObject({ ok: false, code: 'CURSOR_REPEAT' });
    });

    it('reports RPC errors, protocol changes and early closes', async () => {
        serve(() => ({ error: { code: -32601, message: 'no' } }));
        expect(await runBotRelayInPage('u', task({ type: 'agents' }))).toMatchObject({ ok: false, code: 'RPC', method: 'bot.command' });

        serve(() => ({ result: [] }), { ...hello, supported_protocol_versions: ['2.0.0'] });
        expect(await runBotRelayInPage('u', task({ type: 'agents' }))).toMatchObject({ ok: false, code: 'PROTOCOL' });

        handlers.onFrame = (socket) => socket.onclose?.({ code: 4409, reason: 'replaced' });
        expect(await runBotRelayInPage('u', task({ type: 'agents' }))).toEqual({ ok: false, code: 'CLOSED', closeCode: 4409, reason: 'replaced' });
    });
});
