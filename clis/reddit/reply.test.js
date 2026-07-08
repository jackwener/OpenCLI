import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { normalizeRedditCommentFullname, requireReplyText } from './reply.js';
import './reply.js';

function makePage(result = { kind: 'ok', detail: 'Reply posted on t1_okf3s7u as t1_reply123' }) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

describe('reddit reply command', () => {
    const command = getRegistry().get('reddit/reply');

    it('normalizes bare ids, fullnames, and exact reddit comment URLs', () => {
        expect(normalizeRedditCommentFullname('okf3s7u')).toBe('t1_okf3s7u');
        expect(normalizeRedditCommentFullname('T1_OKF3S7U')).toBe('t1_okf3s7u');
        expect(normalizeRedditCommentFullname('https://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/?context=3')).toBe('t1_okf3s7u');
        expect(normalizeRedditCommentFullname('https://old.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/')).toBe('t1_okf3s7u');
    });

    it('rejects invalid or ambiguous comment identities before navigation', async () => {
        const page = makePage();

        for (const value of [
            '',
            't3_1abc23',
            'abc/def',
            'https://reddit.com.evil.com/r/opencli/comments/1abc23/title_slug/okf3s7u/',
            'http://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/',
            'https://www.reddit.com/r/opencli/comments/1abc23/title_slug/',
            'https://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/evil',
        ]) {
            await expect(command.func(page, { 'comment-id': value, text: 'hello' })).rejects.toBeInstanceOf(ArgumentError);
        }

        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects blank reply text before navigation', async () => {
        const page = makePage();

        await expect(command.func(page, { 'comment-id': 'okf3s7u', text: '   ' })).rejects.toBeInstanceOf(ArgumentError);

        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
        expect(() => requireReplyText('hello')).not.toThrow();
    });

    it('posts to the normalized t1 fullname and returns success only on ok result', async () => {
        const page = makePage();

        const rows = await command.func(page, {
            'comment-id': 'https://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/',
            text: 'hello',
        });

        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('const fullname = "t1_okf3s7u"');
        expect(script).toContain('const text = "hello"');
        expect(rows).toEqual([{ status: 'success', message: 'Reply posted on t1_okf3s7u as t1_reply123' }]);
    });

    it('maps auth, http, reddit, exception, and postcondition failures to typed errors', async () => {
        await expect(command.func(makePage({ kind: 'auth', detail: 'login required' }), { 'comment-id': 'okf3s7u', text: 'hello' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        await expect(command.func(makePage({ kind: 'http', httpStatus: 500, where: '/api/comment' }), { 'comment-id': 'okf3s7u', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'reddit-error', detail: 'RATELIMIT: try later' }), { 'comment-id': 'okf3s7u', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'exception', detail: 'bad json' }), { 'comment-id': 'okf3s7u', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'postcondition', detail: 'Reddit comment response did not include a created reply id' }), { 'comment-id': 'okf3s7u', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('requires the Reddit response to include a created reply id', async () => {
        const page = makePage();

        await command.func(page, { 'comment-id': 'okf3s7u', text: 'hello' });

        expect(page.evaluate.mock.calls[0][0]).toContain('Reddit comment response did not include a created reply id');
        expect(page.evaluate.mock.calls[0][0]).toContain("String(thing?.data?.name || '').startsWith('t1_')");
    });
});
