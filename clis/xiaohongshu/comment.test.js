import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';

import { __test__ } from './comment.js';

const NOTE_ID = '6aa65245000000002603bb74';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABYrrKnMfoaZ7e%3D&xsec_source=pc_feed`;
const TEXT = '写得很好，学到了';

/**
 * `readXhsDetailPage` does goto → wait → evaluate, so the first evaluate a
 * command makes is always the preflight extract.
 */
function makePage(evaluateResults = []) {
    const results = [...evaluateResults];
    const evaluate = vi.fn(async () => results.shift());
    const evaluateOnce = vi.fn(async () => results.shift());
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        evaluateOnce,
    };
}

const okPreflight = { pageUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`, securityBlock: false, loginWall: false, notFound: false };

describe('xiaohongshu comment', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/comment');

    it('posts once and reports the comment id the API returns', async () => {
        const page = makePage([okPreflight, { ok: true, comment_id: 'c-123' }]);
        const result = await getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true });
        expect(result).toEqual([{
            status: 'success',
            comment_id: 'c-123',
            url: `${NOTE_URL}#comment-c-123`,
            message: TEXT,
            verified: true,
        }]);
        // Exactly one navigation and one write — this command never retries.
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith(NOTE_URL);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
    });

    it('refuses without --execute, before any navigation or request', async () => {
        const page = makePage([okPreflight, { ok: true, comment_id: 'c-123' }]);
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT }))
            .rejects.toThrowError(/Refusing to post: pass --execute/);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('refuses older runtimes before navigating', async () => {
        const page = makePage();
        delete page.evaluateOnce;
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true })).rejects.toThrow(/evaluateOnce/);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('never retries a write after an unknown navigation outcome', async () => {
        const page = makePage([okPreflight]);
        page.evaluateOnce.mockRejectedValueOnce(Object.assign(new Error('target navigated'), { code: 'target_navigated' }));
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true })).rejects.toThrow(/target navigated/);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('rejects empty text and malformed targets before navigation', async () => {
        const page = makePage();
        for (const kwargs of [
            { note: NOTE_URL, text: '   ', execute: true },
            { note: '', text: TEXT, execute: true },
            { note: 'not-a-note', text: TEXT, execute: true },
            // A note URL without xsec_token is exactly the input that fails to open.
            { note: `https://www.xiaohongshu.com/explore/${NOTE_ID}`, text: TEXT, execute: true },
            { note: `https://evil.example/explore/${NOTE_ID}?xsec_token=t`, text: TEXT, execute: true },
        ]) {
            await expect(getCommand().func(page, kwargs)).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('accepts a bare 24-char hex note id and builds the explore URL', async () => {
        const page = makePage([okPreflight, { ok: true, comment_id: 'c-9' }]);
        const result = await getCommand().func(page, { note: NOTE_ID, text: TEXT, execute: true });
        expect(page.goto).toHaveBeenCalledWith(`https://www.xiaohongshu.com/explore/${NOTE_ID}`);
        expect(result[0].comment_id).toBe('c-9');
    });

    it('reports an accepted comment as verified:false when no id comes back', async () => {
        // Non-idempotent write: a retry would post the comment twice, so a
        // missing id must never be surfaced as a failure.
        const page = makePage([okPreflight, { ok: true, comment_id: null }]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const result = await getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true });
            expect(result).toEqual([{
                status: 'posted-unverified',
                comment_id: null,
                url: NOTE_URL,
                message: TEXT,
                verified: false,
            }]);
            expect(stderr.mock.calls[0][0]).toBe('COMMENT_UNVERIFIED\n');
        } finally {
            stderr.mockRestore();
        }
    });

    it('throws AuthRequiredError on a login wall, from the page or the store', async () => {
        const walled = makePage([{ ...okPreflight, loginWall: true }]);
        await expect(getCommand().func(walled, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        // No write is attempted once the preflight sees the wall.
        expect(walled.evaluate).toHaveBeenCalledTimes(1);

        const storeWalled = makePage([okPreflight, { ok: false, reason: 'login_wall' }]);
        await expect(getCommand().func(storeWalled, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws EmptyResultError when the note is gone', async () => {
        const page = makePage([{ ...okPreflight, notFound: true }]);
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toBeInstanceOf(EmptyResultError);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws SECURITY_BLOCK after the single risk-control cooldown retry', async () => {
        const blocked = { ...okPreflight, securityBlock: true };
        const page = makePage([blocked, blocked]);
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
        // One cooldown reload, then give up — never a loop against a hot risk state.
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('never writes against a page that is not the requested note', async () => {
        const wrongNote = makePage([{ ...okPreflight, pageUrl: 'https://www.xiaohongshu.com/explore/6aa000000000000000000000' }]);
        await expect(getCommand().func(wrongNote, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/expected note 6aa65245000000002603bb74/);
        expect(wrongNote.evaluate).toHaveBeenCalledTimes(1);

        const wrongHost = makePage([{ ...okPreflight, pageUrl: `https://evil.example/explore/${NOTE_ID}` }]);
        await expect(getCommand().func(wrongHost, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/expected a Xiaohongshu note page/);

        const bouncedToLogin = makePage([{ ...okPreflight, pageUrl: 'https://www.xiaohongshu.com/login?redirectPath=/explore' }]);
        await expect(getCommand().func(bouncedToLogin, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('surfaces API errors with code and message', async () => {
        const page = makePage([okPreflight, { ok: false, reason: 'api_error', code: 300011, message: '当前账号存在异常' }]);
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/当前账号存在异常 \(code 300011\)/);
    });

    it('surfaces the bundled comment API being unreachable', async () => {
        const page = makePage([okPreflight, { ok: false, reason: 'api_unavailable' }]);
        await expect(getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/comment API is unreachable/);
    });

    it('unwraps browser bridge envelopes at every evaluate boundary', async () => {
        const page = makePage([
            { session: 's', data: okPreflight },
            { session: 's', data: { ok: true, comment_id: 'c-1' } },
        ]);
        const result = await getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true });
        expect(result[0]).toMatchObject({ status: 'success', comment_id: 'c-1' });
    });

    it('throws CommandExecutionError for malformed evaluate payloads', async () => {
        const badPreflight = makePage(['not an object']);
        await expect(getCommand().func(badPreflight, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/malformed preflight payload/);

        const badAction = makePage([okPreflight, { comment_id: 'c-1' }]);
        await expect(getCommand().func(badAction, { note: NOTE_URL, text: TEXT, execute: true }))
            .rejects.toThrowError(/malformed comment-action payload/);
    });

    it('wraps unexpected failures as typed CliErrors', async () => {
        const page = makePage();
        page.goto.mockRejectedValueOnce(new Error('bridge exploded'));
        const err = await getCommand().func(page, { note: NOTE_URL, text: TEXT, execute: true }).catch((e) => e);
        expect(err).toBeInstanceOf(CliError);
        expect(err.message).toMatch(/bridge exploded/);
    });

    describe('__test__.resolveCommentTarget', () => {
        it('keeps the signed URL intact and pulls the note id out of it', () => {
            expect(__test__.resolveCommentTarget(NOTE_URL)).toEqual({ noteId: NOTE_ID, noteUrl: NOTE_URL });
            expect(__test__.resolveCommentTarget(`  ${NOTE_ID}  `)).toEqual({
                noteId: NOTE_ID,
                noteUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
            });
        });
    });

    describe('injected scripts', () => {
        it('posts through the page bundle with the note id and content', () => {
            const script = __test__.buildCommentScript({ noteId: NOTE_ID, content: TEXT });
            // Pinia prelude comes along for the login-wall check.
            expect(script).toContain('__xhsStore');
            expect(script).toContain('__xhsLoggedOut()');
            expect(script).toContain('note_id: ' + JSON.stringify(NOTE_ID));
            expect(script).toContain('content: ' + JSON.stringify(TEXT));
            expect(script).toContain('at_users: []');
            // The signed wrapper is found by endpoint, not by its minified
            // export name, which changes on every xhs build.
            expect(script).toContain('/api/sns/web/v1/comment/post');
            expect(script).toContain('webpackChunkxhs_pc_web');
        });

        it('escapes text that would otherwise break out of the script', () => {
            const script = __test__.buildCommentScript({ noteId: NOTE_ID, content: '"); alert(1); //' });
            expect(script).toContain(JSON.stringify('"); alert(1); //'));
            expect(script).not.toContain('alert(1); //\n');
        });

        it('detects risk-control blocks and login walls in the preflight', () => {
            expect(__test__.COMMENT_PREFLIGHT_JS).toContain('securityBlock');
            expect(__test__.COMMENT_PREFLIGHT_JS).toContain('error_code=300017');
            expect(__test__.COMMENT_PREFLIGHT_JS).toContain('loginWall');
        });
    });
});
