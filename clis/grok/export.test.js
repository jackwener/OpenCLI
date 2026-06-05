import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ as exportTest, grokExportCommand } from './export.js';
import { __test__ as exportAllTest, grokExportAllCommand } from './export-all.js';
import {
    normalizeConversationRows,
    normalizeManifestRows,
    requireObjectEvaluateResult,
} from './export-utils.js';

const ID = '7c4197f2-10a1-4ebb-a84a-fea89f4f1d06';
const ID2 = '8c4197f2-10a1-4ebb-a84a-fea89f4f1d07';

function makePage(evaluateResults) {
    const queue = [...evaluateResults];
    return {
        gotos: [],
        waits: [],
        async goto(url) {
            this.gotos.push(url);
        },
        async wait(seconds) {
            this.waits.push(seconds);
        },
        async evaluate() {
            if (!queue.length) throw new Error('unexpected evaluate call');
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return next;
        },
    };
}

describe('grok export helpers', () => {
    it('validates export arguments without silent clamps', () => {
        expect(exportTest.normalizeLimit(0)).toBe(0);
        expect(exportTest.normalizeLimit(25)).toBe(25);
        expect(() => exportTest.normalizeLimit(-1)).toThrow(ArgumentError);
        expect(() => exportTest.normalizeLimit(1.5)).toThrow(ArgumentError);
        expect(exportTest.normalizeMaxScrolls(undefined)).toBe(80);
        expect(() => exportTest.normalizeMaxScrolls(0)).toThrow(ArgumentError);
        expect(() => exportTest.normalizeMaxScrolls(501)).toThrow(ArgumentError);
    });

    it('unwraps Browser Bridge evaluate envelopes', () => {
        expect(requireObjectEvaluateResult({ session: 's1', data: { ok: true } }, 'label')).toEqual({ ok: true });
    });

    it('typed-fails malformed history rows instead of filtering them to empty', () => {
        expect(() => normalizeConversationRows({}, 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ title: 'missing id' }], 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ id: ID, url: `https://evil.com/c/${ID}` }], 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ id: ID, url: `https://grok.com/c/${ID2}` }], 'grok export')).toThrow(CommandExecutionError);
    });

    it('normalizes valid history rows', () => {
        expect(normalizeConversationRows([{ id: ID.toUpperCase(), title: 123, date: null }], 'grok export')).toEqual([
            { id: ID, title: '123', date: '', url: `https://grok.com/c/${ID}` },
        ]);
    });

    it('validates manifest rows as input arguments', () => {
        expect(() => normalizeManifestRows({})).toThrow(ArgumentError);
        expect(() => normalizeManifestRows([{ id: 'bad' }])).toThrow(ArgumentError);
        expect(normalizeManifestRows([{ id: ID, title: 'Hello' }])).toEqual([
            { id: ID, title: 'Hello', date: '', url: `https://grok.com/c/${ID}` },
        ]);
    });
});

describe('grok export command', () => {
    it('maps Browser Bridge history payload to rows', async () => {
        const page = makePage([
            { session: 'browser', data: { ok: true, rows: [{ id: ID, title: 'T', date: 'Today' }] } },
        ]);
        const rows = await grokExportCommand.func(page, { limit: 1, maxScrolls: 3 });
        expect(rows).toEqual([{ index: 1, id: ID, title: 'T', date: 'Today', url: `https://grok.com/c/${ID}` }]);
    });

    it('typed-fails malformed history payloads', async () => {
        await expect(grokExportCommand.func(makePage([{ ok: true, rows: [{ title: 'missing id' }] }]), {}))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('keeps true empty history as EmptyResultError', async () => {
        await expect(grokExportCommand.func(makePage([{ ok: true, rows: [] }]), {}))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('grok export-all command', () => {
    let tempDir = '';

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = '';
        }
    });

    function writeManifest(rows) {
        tempDir = mkdtempSync(join(tmpdir(), 'opencli-grok-export-test-'));
        const path = join(tempDir, 'manifest.json');
        writeFileSync(path, JSON.stringify(rows), 'utf8');
        return path;
    }

    it('reads and slices a valid manifest', () => {
        const path = writeManifest([
            { id: ID, title: 'One' },
            { id: ID2, title: 'Two' },
        ]);
        expect(exportAllTest.readManifest(path, { offset: 1, limit: 1 })).toEqual([
            { id: ID2, title: 'Two', date: '', url: `https://grok.com/c/${ID2}` },
        ]);
    });

    it('rejects invalid manifest rows instead of silently dropping them', () => {
        const path = writeManifest([{ title: 'missing id' }]);
        expect(() => exportAllTest.readManifest(path, { offset: 0, limit: 0 })).toThrow(ArgumentError);
    });

    it('exports transcript rows from a manifest and unwraps page evaluate envelopes', async () => {
        const path = writeManifest([{ id: ID, title: 'One' }]);
        const page = makePage([
            true,
            {
                session: 'browser',
                data: {
                    messages: [
                        { messageIndex: 1, messageId: 'u1', messageRole: 'user', messageText: 'Hello' },
                        { messageIndex: 2, messageId: 'a1', messageRole: 'assistant', messageText: 'Hi' },
                    ],
                },
            },
        ]);
        const rows = await grokExportAllCommand.func(page, { manifestPath: path, limit: 0, offset: 0, pageScrolls: 1 });
        expect(rows).toEqual([{
            index: 1,
            id: ID,
            title: 'One',
            date: null,
            url: `https://grok.com/c/${ID}`,
            status: 'ok',
            messageCount: 2,
            error: null,
            messagesJson: JSON.stringify([
                { messageIndex: 1, messageId: 'u1', messageRole: 'user', messageText: 'Hello' },
                { messageIndex: 2, messageId: 'a1', messageRole: 'assistant', messageText: 'Hi' },
            ]),
        }]);
    });

    it('records per-conversation failed status for malformed transcript payloads', async () => {
        const path = writeManifest([{ id: ID, title: 'One' }]);
        const page = makePage([true, { messages: 'bad' }]);
        const rows = await grokExportAllCommand.func(page, { manifestPath: path, limit: 0, offset: 0, pageScrolls: 1 });
        expect(rows[0]).toMatchObject({
            status: 'failed',
            messageCount: 0,
            error: 'Conversation reader returned malformed message rows.',
            messagesJson: '[]',
        });
    });

    it('records per-conversation failed status for malformed page-load checks', async () => {
        const path = writeManifest([{ id: ID, title: 'One' }]);
        const page = makePage([{ session: 'browser', data: { loaded: true } }]);
        const rows = await grokExportAllCommand.func(page, {
            manifestPath: path,
            limit: 0,
            offset: 0,
            pageScrolls: 1,
            pageTimeoutMs: 5000,
        });
        expect(rows[0]).toMatchObject({
            status: 'failed',
            messageCount: 0,
            error: expect.stringContaining('Page load check failed:'),
            messagesJson: '[]',
        });
    });

    it('records per-conversation failed status for malformed transcript envelopes', async () => {
        const path = writeManifest([{ id: ID, title: 'One' }]);
        const page = makePage([true, { session: 'browser', data: [] }]);
        const rows = await grokExportAllCommand.func(page, { manifestPath: path, limit: 0, offset: 0, pageScrolls: 1 });
        expect(rows[0]).toMatchObject({
            status: 'failed',
            messageCount: 0,
            error: expect.stringContaining('Conversation reader failed:'),
            messagesJson: '[]',
        });
    });

    it('does not silently drop malformed transcript rows into a partial success', async () => {
        const path = writeManifest([{ id: ID, title: 'One' }]);
        const page = makePage([true, { messages: [{ messageId: '', messageRole: 'assistant', messageText: 'bad' }] }]);
        const rows = await grokExportAllCommand.func(page, { manifestPath: path, limit: 0, offset: 0, pageScrolls: 1 });
        expect(rows[0]).toMatchObject({
            status: 'failed',
            messageCount: 0,
            error: 'Conversation reader returned malformed message row 1.',
            messagesJson: '[]',
        });
    });
});
