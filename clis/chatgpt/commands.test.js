import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './send.js';
import './read.js';
import './history.js';
import './detail.js';
import './new.js';
import './status.js';
import './image.js';
import './model.js';

describe('chatgpt browser command registration', () => {
    it('registers the baseline web chat commands with persistent site sessions', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            history: 'read',
            detail: 'read',
            new: 'read',
            status: 'read',
            image: 'write',
            model: 'write',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`chatgpt/${name}`);
            expect(cmd, `chatgpt/${name}`).toBeDefined();
            expect(cmd.site).toBe('chatgpt');
            expect(cmd.domain).toBe('chatgpt.com');
            expect(cmd.strategy).toBe('cookie');
            expect(cmd.browser).toBe(true);
            expect(cmd.siteSession).toBe('persistent');
            expect(cmd.navigateBefore).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('keeps ask timeout as the runtime-visible integer timeout arg', () => {
        const ask = getRegistry().get('chatgpt/ask');
        expect(ask.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'new', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'conversation', valueRequired: true }),
            expect.objectContaining({ name: 'wait', type: 'boolean', default: true }),
            expect.objectContaining({ name: 'deep-research', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'web-search', type: 'boolean', default: false }),
        ]));
        expect(ask.columns).toEqual(['conversationId', 'conversationUrl', 'tool', 'response']);
    });

    it('registers send conversation routing option', () => {
        const send = getRegistry().get('chatgpt/send');
        expect(send.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'new', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'conversation', valueRequired: true }),
        ]));
    });

    it('registers detail wait options and generation state columns', () => {
        const detail = getRegistry().get('chatgpt/detail');
        expect(detail.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'wait', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'stable', type: 'int', default: 6 }),
        ]));
        expect(detail.columns).toEqual(['Index', 'Role', 'Text', 'Generating', 'StableSeconds']);
    });

    it('registers chatgpt model with web model choices', () => {
        const model = getRegistry().get('chatgpt/model');
        expect(model.args).toEqual([
            expect.objectContaining({
                name: 'model',
                positional: true,
                required: true,
                choices: ['instant', 'thinking', 'pro'],
            }),
        ]);
        expect(model.columns).toEqual(['Status', 'Model']);
    });

    it('rejects off-domain conversation URLs before ask/send can navigate', async () => {
        const ask = getRegistry().get('chatgpt/ask');
        const send = getRegistry().get('chatgpt/send');
        const page = {
            goto: () => {
                throw new Error('should not navigate');
            },
        };

        await expect(ask.func(page, { prompt: 'hello', conversation: 'https://evil.test/c/abc_123-def' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(send.func(page, { prompt: 'hello', conversation: 'https://evil.test/c/abc_123-def' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
    });
});
