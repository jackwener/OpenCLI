import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './answer.js';
describe('zhihu answer', () => {
    it('rejects create mode when the current user already answered the question', async () => {
        const cmd = getRegistry().get('zhihu/answer');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: false, hasExistingAnswerByCurrentUser: true }),
        };
        await expect(cmd.func(page, { target: 'question:1', text: 'hello', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('rejects anonymous mode instead of toggling it', async () => {
        const cmd = getRegistry().get('zhihu/answer');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: true, hasExistingAnswerByCurrentUser: false })
                .mockResolvedValueOnce({ editorState: 'fresh_empty', anonymousMode: 'on' }),
        };
        await expect(cmd.func(page, { target: 'question:1', text: 'hello', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('rejects when a unique safe answer composer cannot be proven', async () => {
        const cmd = getRegistry().get('zhihu/answer');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: false, hasExistingAnswerByCurrentUser: false }),
        };
        await expect(cmd.func(page, { target: 'question:1', text: 'hello', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('rejects when anonymous mode cannot be proven off', async () => {
        const cmd = getRegistry().get('zhihu/answer');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: true, hasExistingAnswerByCurrentUser: false })
                .mockResolvedValueOnce({ editorState: 'fresh_empty', anonymousMode: 'unknown' }),
        };
        await expect(cmd.func(page, { target: 'question:1', text: 'hello', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('requires a side-effect-free entry path and exact editor content before publish', async () => {
        const cmd = getRegistry().get('zhihu/answer');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: true })
                .mockResolvedValueOnce({ editorState: 'fresh_empty', anonymousMode: 'off' })
                .mockResolvedValueOnce({ editorContent: 'hello', bodyMatches: true })
                .mockResolvedValueOnce({
                createdTarget: 'answer:1:2',
                createdUrl: 'https://www.zhihu.com/question/1/answer/2',
                authorIdentity: 'alice',
                bodyMatches: true,
            }),
        };
        await expect(cmd.func(page, { target: 'question:1', text: 'hello', execute: true })).resolves.toEqual([
            expect.objectContaining({
                outcome: 'created',
                created_target: 'answer:1:2',
                created_url: 'https://www.zhihu.com/question/1/answer/2',
                author_identity: 'alice',
            }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain('composerCandidates.length === 1');
        expect(page.evaluate.mock.calls[1][0]).not.toContain('writeAnswerButton');
        expect(page.evaluate.mock.calls[1][0]).toContain('const readAnswerAuthorSlug = (node) =>');
        expect(page.evaluate.mock.calls[1][0]).toContain('const answerAuthorScopeSelector = ".AuthorInfo, .AnswerItem-authorInfo, .ContentItem-meta, [itemprop=\\"author\\"]"');
        expect(page.evaluate.mock.calls[1][0]).not.toContain("node.querySelector('a[href^=\"/people/\"]')");
        expect(page.evaluate.mock.calls[3][0]).toContain('composerCandidates.length !== 1');
        expect(page.evaluate.mock.calls[4][0]).toContain('const readAnswerAuthorSlug = (node) =>');
        expect(page.evaluate.mock.calls[4][0]).not.toContain("answerContainer?.querySelector('a[href^=\"/people/\"]')");
    });
});
