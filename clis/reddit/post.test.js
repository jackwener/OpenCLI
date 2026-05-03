import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './post.js';

describe('reddit post adapter', () => {
    const command = getRegistry().get('reddit/post');

    function makePage({ flair = true, submitOk = true, flairCommitOk = true } = {}) {
        const evaluateResults = [
            { ok: true, x: 10, y: 20 },
            { ok: true, value: 'My title' },
            { ok: true, x: 30, y: 40 },
            { ok: true, value: 'Body text' },
        ];
        if (flair) {
            evaluateResults.push(
                { ok: true, x: 50, y: 60, label: 'Add flair' },
                { ok: true, x: 70, y: 80, text: 'Discussion' },
                { ok: true, selected: true, text: 'Discussion', hiddenFlairText: 'Discussion', hiddenFlairIds: ['abc'] },
                { ok: true, x: 90, y: 100, label: 'Apply', id: 'post-flair-modal-apply-button' },
                {
                    ok: flairCommitOk,
                    message: flairCommitOk ? 'Flair applied' : 'Flair did not commit',
                    diagnostics: { committed: flairCommitOk, currentValue: flairCommitOk ? { flairId: 'abc', flairText: 'Discussion' } : {} },
                },
            );
        }
        evaluateResults.push(
            submitOk
                ? { ok: true, message: 'Reddit post created successfully', url: 'https://www.reddit.com/r/test/comments/abc123/my_title/' }
                : { ok: false, message: 'Submit action ran but post URL did not appear', url: 'https://www.reddit.com/r/test/submit/?type=TEXT' },
        );

        return {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            nativeClick: vi.fn().mockResolvedValue(undefined),
            insertText: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockImplementation(async () => {
                if (!evaluateResults.length)
                    throw new Error('No more mocked evaluate results');
                return evaluateResults.shift();
            }),
        };
    }

    it('returns a success row when the browser flow reaches a post URL', async () => {
        const page = makePage();
        const result = await command.func(page, {
            subreddit: 'AI_Agents',
            title: 'My title',
            text: 'Body text',
            flair: 'Discussion',
        });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com/r/AI_Agents/submit/?type=TEXT');
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reddit post created successfully',
                subreddit: 'AI_Agents',
                title: 'My title',
                url: 'https://www.reddit.com/r/test/comments/abc123/my_title/',
            },
        ]);
    });

    it('surfaces submit failures while preserving flair diagnostics', async () => {
        const page = makePage({ submitOk: false, flairCommitOk: false });
        const result = await command.func(page, {
            subreddit: 'AI_Agents',
            title: 'My title',
            text: 'Body text',
            flair: 'Discussion',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Submit action ran but post URL did not appear | flair=Flair did not commit | diagnostics={"committed":false,"currentValue":{}}',
                subreddit: 'AI_Agents',
                title: 'My title',
                url: 'https://www.reddit.com/r/test/submit/?type=TEXT',
            },
        ]);
    });
});
