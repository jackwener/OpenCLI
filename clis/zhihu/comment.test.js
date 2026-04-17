import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './comment.js';
describe('zhihu comment', () => {
    it('rejects composer paths that are not proven side-effect free', async () => {
        const cmd = getRegistry().get('zhihu/comment');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: false })
                .mockResolvedValueOnce({ wrongAnswer: false, rows: [], commentLinks: [] }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', text: 'hello', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('requires exact editor replacement before accepting fallback proof', async () => {
        const cmd = getRegistry().get('zhihu/comment');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ entryPathSafe: true })
                .mockResolvedValueOnce({ wrongAnswer: false, rows: [], commentLinks: [] })
                .mockResolvedValueOnce({ composerState: 'fresh_top_level' })
                .mockResolvedValueOnce({ editorContent: 'hello', mode: 'top_level' })
                .mockResolvedValueOnce({
                proofType: 'fallback',
                createdProof: {
                    proof_type: 'comment_fallback',
                    author_scope: 'current_user',
                    target_scope: 'requested_target',
                    comment_scope: 'top_level_only',
                    content_match: 'exact_normalized',
                    observed_after_submit: true,
                    present_in_pre_submit_snapshot: false,
                    new_matching_entries: 1,
                    post_submit_matching_entries: 1,
                    snapshot_scope: 'stabilized_expanded_target_comment_list',
                },
            }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', text: 'hello', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'created', author_identity: 'alice', created_proof: expect.any(Object) }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain('topLevelCandidates.length === 1');
        expect(page.evaluate.mock.calls[1][0]).not.toContain('commentTrigger');
        expect(page.evaluate.mock.calls[2][0]).toContain("node.getAttribute('data-answerid')");
        expect(page.evaluate.mock.calls[2][0]).toContain("node.getAttribute('data-zop-question-answer')");
        expect(page.evaluate.mock.calls[5][0]).toContain('const readCommentAuthorSlug = (node) =>');
        expect(page.evaluate.mock.calls[5][0]).toContain('const commentAuthorScopeSelector = ".CommentItemV2-head, .CommentItem-head, .CommentItemV2-meta, .CommentItem-meta, .CommentItemV2-metaSibling, [data-comment-author], [itemprop=\\"author\\"]"');
        expect(page.evaluate.mock.calls[5][0]).not.toContain("card?.querySelector('a[href^=\"/people/\"]')");
    });
});
