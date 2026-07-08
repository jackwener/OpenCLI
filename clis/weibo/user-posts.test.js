import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './user-posts.js';
import { testInternals } from './user-posts.js';

function envelope(data) {
    return { session: 'site:weibo:test', data };
}

function makePage(payload) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(payload),
    };
}

describe('weibo user-posts', () => {
    const command = getRegistry().get('weibo/user-posts');

    it('validates id, limit, dates, and date ranges before navigation', async () => {
        await expect(command.func(makePage({ rows: [] }), { id: '', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(makePage({ rows: [] }), { id: '123', limit: 0 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(makePage({ rows: [] }), { id: '123', start: '2025-02-30', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(makePage({ rows: [] }), { id: '123', start: '2025-06-02', end: '2025-06-01', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('converts Asia/Shanghai date boundaries to unix seconds', () => {
        expect(testInternals.dateToTimestamp('2025-06-01')).toBe(1748707200);
        expect(testInternals.dateToTimestamp('2025-01-01')).toBe(1735660800);
    });

    it('unwraps browser bridge envelopes and returns stable listing rows', async () => {
        const page = makePage(envelope(['1670458304', [{
                id: '5012345678901234',
                mblogid: 'QD5uq0ydj',
                author: 'Alice',
                uid: '1670458304',
                text: 'hello',
                time: 'Sun Jun 01 10:00:00 +0800 2025',
                reposts: 1,
                comments: 2,
                likes: 3,
                pic_count: 4,
                url: 'https://weibo.com/1670458304/QD5uq0ydj',
            }], true, true]));

        await expect(command.func(page, {
            id: '1670458304',
            start: '2025-06-01',
            end: '2025-06-02',
            limit: 20,
        })).resolves.toEqual([{
            rank: 1,
            id: '5012345678901234',
            mblogid: 'QD5uq0ydj',
            author: 'Alice',
            uid: '1670458304',
            text: 'hello',
            time: 'Sun Jun 01 10:00:00 +0800 2025',
            reposts: 1,
            comments: 2,
            likes: 3,
            pic_count: 4,
            url: 'https://weibo.com/1670458304/QD5uq0ydj',
        }]);
    });

    it('maps auth-like evaluate errors to AuthRequiredError', async () => {
        await expect(command.func(makePage({ error: 'login required: HTTP 403' }), { id: '123', limit: 10 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps malformed payload and parser drift to CommandExecutionError', async () => {
        await expect(command.func(makePage({ rows: [] }), { id: '123', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ error: 'Weibo user posts response did not include data.list' }), { id: '123', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage(['123', [], true, true]), { id: '123', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps true empty lists to EmptyResultError', async () => {
        await expect(command.func(makePage(['123', [], true, false]), { id: '123', limit: 10 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
