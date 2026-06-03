import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { followOne, parseBatchUsernames, parseDelayMs } from './follow-batch.js';
import './follow-batch.js';

describe('twitter follow-batch command', () => {
    it('registers with the expected shape', () => {
        const cmd = getRegistry().get('twitter/follow-batch');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['username', 'status', 'message']);
        expect(cmd?.access).toBe('write');
        expect(cmd?.browser).toBe(true);
        expect(cmd?.args?.[0]).toMatchObject({
            name: 'usernames',
            positional: true,
            required: true,
        });
        expect(cmd?.args?.find((arg) => arg.name === 'delay-ms')?.default).toBe(3000);
    });

    it('parses comma-separated usernames, strips @, and deduplicates case-insensitively', () => {
        expect(parseBatchUsernames(' @karpathy, swyx,Karpathy, rauchg ')).toEqual([
            'karpathy',
            'swyx',
            'rauchg',
        ]);
    });

    it('rejects empty and invalid usernames', () => {
        expect(() => parseBatchUsernames(' , , ')).toThrow(ArgumentError);
        expect(() => parseBatchUsernames('valid,not/valid')).toThrow(ArgumentError);
        expect(() => parseBatchUsernames('x'.repeat(16))).toThrow(ArgumentError);
    });

    it('parses and validates delay-ms', () => {
        expect(parseDelayMs(undefined)).toBe(3000);
        expect(parseDelayMs(0)).toBe(0);
        expect(parseDelayMs('2500')).toBe(2500);
        expect(() => parseDelayMs(-1)).toThrow(ArgumentError);
        expect(() => parseDelayMs(60001)).toThrow(ArgumentError);
        expect(() => parseDelayMs('1.5')).toThrow(ArgumentError);
    });

    it('follows each parsed username sequentially and returns per-user rows', async () => {
        const cmd = getRegistry().get('twitter/follow-batch');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: false, followButtonVisible: true })
                .mockResolvedValueOnce({ ok: true, status: 'success', message: 'Successfully followed @karpathy.' })
                .mockResolvedValueOnce({ ok: true, status: 'noop', message: 'Already following @swyx.' })
                .mockResolvedValueOnce({ ok: false, followButtonVisible: false }),
        };

        const rows = await cmd.func(page, { usernames: '@karpathy,swyx,baduser', 'delay-ms': 2500 });

        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/karpathy');
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://x.com/swyx');
        expect(page.goto).toHaveBeenNthCalledWith(3, 'https://x.com/baduser');
        expect(page.wait).toHaveBeenCalledWith(2.5);
        expect(rows).toEqual([
            { username: 'karpathy', status: 'success', message: 'Successfully followed @karpathy.' },
            { username: 'swyx', status: 'noop', message: 'Already following @swyx.' },
            { username: 'baduser', status: 'failed', message: 'Could not find Follow button. Are you logged in?' },
        ]);
    });

    it('unwraps Browser Bridge evaluate envelopes before interpreting follow state', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ session: 's1', data: { ok: false, followButtonVisible: true } })
                .mockResolvedValueOnce({ session: 's1', data: { ok: true, status: 'success', message: 'Successfully followed @karpathy.' } }),
        };

        const row = await followOne(page, 'karpathy');

        expect(row).toEqual({
            username: 'karpathy',
            status: 'success',
            message: 'Successfully followed @karpathy.',
        });
    });

    it('fails typed before batch execution when the browser session is not authenticated', async () => {
        const cmd = getRegistry().get('twitter/follow-batch');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { usernames: '@karpathy,swyx' })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects invalid batch input before reading browser authentication state', async () => {
        const cmd = getRegistry().get('twitter/follow-batch');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { usernames: 'valid,not/valid' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('refreshes the profile before reporting a failed post-click verification', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: false, followButtonVisible: true })
                .mockResolvedValueOnce({ ok: false, retryAfterRefresh: true, message: 'Follow action initiated but UI did not update.' })
                .mockResolvedValueOnce({ ok: true, status: 'noop', message: 'Already following @langchainai.' }),
        };

        const row = await followOne(page, 'LangChainAI');

        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/LangChainAI');
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://x.com/LangChainAI');
        expect(row).toEqual({
            username: 'LangChainAI',
            status: 'success',
            message: 'Successfully followed @LangChainAI.',
        });
    });
});
