import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { listConversations } from './_actions.js';
import './audit-extras.js';
import './delete.js';
import './history.js';
import './mark-read.js';
import './model.js';
import './rename.js';
import './storage.js';

function makePage(evaluateResults = []) {
    const queue = [...evaluateResults];
    return {
        evaluate: vi.fn(async () => (queue.length ? queue.shift() : null)),
        wait: vi.fn(async () => {}),
    };
}

describe('antigravity command registration', () => {
    it('classifies commands by maximum side effect', () => {
        const expected = {
            history: 'read',
            delete: 'write',
            'mark-read': 'write',
            model: 'write',
            rename: 'write',
            'copy-message': 'write',
            'copy-code': 'read',
            'state-keys': 'read',
            'state-get': 'read',
            'recent-paths': 'read',
            'workspaces-list': 'read',
            'settings-read': 'read',
        };
        for (const [name, access] of Object.entries(expected)) {
            const command = getRegistry().get(`antigravity/${name}`);
            expect(command, `antigravity/${name}`).toBeDefined();
            expect(command.access).toBe(access);
        }
    });
});

describe('antigravity Browser Bridge envelopes', () => {
    it('unwraps conversation listings returned as { session, data }', async () => {
        const page = makePage([
            { session: { id: 's1' }, data: [{ index: 1, id: 'abc', title: 'Demo' }] },
        ]);

        await expect(listConversations(page)).resolves.toEqual([
            { index: 1, id: 'abc', title: 'Demo' },
        ]);
    });
});

describe('antigravity write postconditions', () => {
    let deleteCommand;
    let markReadCommand;
    let modelCommand;
    let storageKeysCommand;

    beforeAll(() => {
        deleteCommand = getRegistry().get('antigravity/delete');
        markReadCommand = getRegistry().get('antigravity/mark-read');
        modelCommand = getRegistry().get('antigravity/model');
        storageKeysCommand = getRegistry().get('antigravity/storage-keys');
    });

    it('delete fails closed when the conversation remains visible after confirmation', async () => {
        const page = makePage([
            { ok: true, clicked: 'Delete Conversation' },
            { ok: true, confirmed: 'Delete' },
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
        ]);

        await expect(deleteCommand.func(page, { id: 'abc', yes: true }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('mark-read refuses to toggle already-read rows back to unread', async () => {
        const page = makePage([
            { ok: true, labels: ['Mark as Unread', 'Rename', 'Delete Conversation'] },
        ]);

        await expect(markReadCommand.func(page, { id: 'abc' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('model rejects ambiguous partial matches before clicking', async () => {
        const page = makePage([
            'Gemini 3.5 Flash',
            { ok: false, reason: 'Ambiguous model match.', detail: 'wanted=gemini matches=["Gemini Pro","Gemini Flash"]' },
        ]);

        await expect(modelCommand.func(page, { name: 'gemini' }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('model fails closed when read-back does not prove the target is active', async () => {
        const page = makePage([
            'Gemini 3.5 Flash',
            { ok: true, switched: true, chosen: 'Claude Sonnet', labels: ['Claude Sonnet'] },
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
            'Gemini 3.5 Flash',
        ]);

        await expect(modelCommand.func(page, { name: 'claude' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('storage-keys unwraps Browser Bridge envelopes before shaping rows', async () => {
        const page = makePage([
            { session: { id: 's1' }, data: [{ k: 'alpha', bytes: 12 }] },
        ]);

        await expect(storageKeysCommand.func(page, { storage: 'local' })).resolves.toEqual([
            { Index: 1, Key: 'alpha', Bytes: 12 },
        ]);
    });
});
