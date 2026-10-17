import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';

import { __test__ } from './comment-delete.js';

const NOTE_ID = '6aa6a0ea000000002900f122';
const COMMENT_ID = '6aa6bdb0000000000b0074cb';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABYrrKnMfoaZ7e%3D&xsec_source=`;

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const r of evaluateResults) evaluate.mockResolvedValueOnce(r);
    evaluate.mockResolvedValue(undefined);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

const okPreflight = { pageUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`, securityBlock: false, loginWall: false, notFound: false };
const args = { note: NOTE_URL, 'comment-id': COMMENT_ID, execute: true };

describe('xiaohongshu comment-delete', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/comment-delete');

    it('deletes once and reports the comment and note it acted on', async () => {
        const page = makePage([okPreflight, { ok: true }]);
        const result = await getCommand().func(page, args);
        expect(result).toEqual([{
            status: 'deleted',
            comment_id: COMMENT_ID,
            note_id: NOTE_ID,
            url: NOTE_URL,
        }]);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('refuses without --execute, before any navigation or request', async () => {
        const page = makePage([okPreflight, { ok: true }]);
        await expect(getCommand().func(page, { note: NOTE_URL, 'comment-id': COMMENT_ID }))
            .rejects.toThrowError(/Refusing to delete: pass --execute/);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects malformed comment ids and note targets before navigation', async () => {
        const page = makePage();
        for (const kwargs of [
            { note: NOTE_URL, 'comment-id': '', execute: true },
            { note: NOTE_URL, 'comment-id': 'not-hex', execute: true },
            { note: NOTE_URL, 'comment-id': COMMENT_ID.slice(0, 10), execute: true },
            { note: 'not-a-note', 'comment-id': COMMENT_ID, execute: true },
            // A note URL without xsec_token is the input that fails to open.
            { note: `https://www.xiaohongshu.com/explore/${NOTE_ID}`, 'comment-id': COMMENT_ID, execute: true },
        ]) {
            await expect(getCommand().func(page, kwargs)).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('fails loudly when xhs does not confirm the delete', async () => {
        // The opposite of `comment`: deleting is idempotent, so an unconfirmed
        // delete must NOT be reported as success — re-running it is harmless,
        // while a false success would leave the comment up.
        const page = makePage([okPreflight, { ok: false, reason: 'api_error', code: -1, message: '评论不存在' }]);
        await expect(getCommand().func(page, args)).rejects.toThrowError(/评论不存在 \(code -1\)/);
    });

    it('throws AuthRequiredError on a login wall, from the page or the store', async () => {
        const walled = makePage([{ ...okPreflight, loginWall: true }]);
        await expect(getCommand().func(walled, args)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(walled.evaluate).toHaveBeenCalledTimes(1);

        const storeWalled = makePage([okPreflight, { ok: false, reason: 'login_wall' }]);
        await expect(getCommand().func(storeWalled, args)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws EmptyResultError when the note is gone', async () => {
        const page = makePage([{ ...okPreflight, notFound: true }]);
        await expect(getCommand().func(page, args)).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws SECURITY_BLOCK after the single risk-control cooldown retry', async () => {
        const blocked = { ...okPreflight, securityBlock: true };
        const page = makePage([blocked, blocked]);
        await expect(getCommand().func(page, args)).rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('never deletes against a page that is not the requested note', async () => {
        const wrongNote = makePage([{ ...okPreflight, pageUrl: 'https://www.xiaohongshu.com/explore/6aa000000000000000000000' }]);
        await expect(getCommand().func(wrongNote, args)).rejects.toThrowError(/expected note 6aa6a0ea000000002900f122/);
        expect(wrongNote.evaluate).toHaveBeenCalledTimes(1);

        const wrongHost = makePage([{ ...okPreflight, pageUrl: `https://evil.example/explore/${NOTE_ID}` }]);
        await expect(getCommand().func(wrongHost, args)).rejects.toThrowError(/expected a Xiaohongshu note page/);
    });

    it('surfaces the bundled comment API being unreachable', async () => {
        const page = makePage([okPreflight, { ok: false, reason: 'api_unavailable' }]);
        await expect(getCommand().func(page, args)).rejects.toThrowError(/comment API is unreachable/);
    });

    it('unwraps browser bridge envelopes at every evaluate boundary', async () => {
        const page = makePage([
            { session: 's', data: okPreflight },
            { session: 's', data: { ok: true } },
        ]);
        const result = await getCommand().func(page, args);
        expect(result[0].status).toBe('deleted');
    });

    it('throws CommandExecutionError for malformed evaluate payloads', async () => {
        const badPreflight = makePage(['not an object']);
        await expect(getCommand().func(badPreflight, args)).rejects.toThrowError(/malformed preflight payload/);

        const badAction = makePage([okPreflight, { deleted: true }]);
        await expect(getCommand().func(badAction, args)).rejects.toThrowError(/malformed delete-action payload/);
    });

    it('wraps unexpected failures as typed CliErrors', async () => {
        const page = makePage();
        page.goto.mockRejectedValueOnce(new Error('bridge exploded'));
        const err = await getCommand().func(page, args).catch((e) => e);
        expect(err).toBeInstanceOf(CliError);
        expect(err.message).toMatch(/bridge exploded/);
    });

    describe('injected script', () => {
        it('deletes through the page bundle with note_id and comment_id', () => {
            const script = __test__.buildDeleteScript({ noteId: NOTE_ID, commentId: COMMENT_ID });
            expect(script).toContain('__xhsStore');
            expect(script).toContain('__xhsLoggedOut()');
            expect(script).toContain('note_id: ' + JSON.stringify(NOTE_ID));
            expect(script).toContain('comment_id: ' + JSON.stringify(COMMENT_ID));
            // The delete endpoint, not the post one — and found by endpoint string
            // rather than by the minified export name.
            expect(script).toContain('/api/sns/web/v1/comment/delete');
            expect(script).not.toContain('/api/sns/web/v1/comment/post');
            expect(script).toContain('webpackChunkxhs_pc_web');
        });
    });
});
