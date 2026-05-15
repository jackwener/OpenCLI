import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './like.js';
import { createPageMock } from '../test-utils.js';

describe('twitter like command', () => {
    it('navigates to the tweet URL and reports success when the like script confirms', async () => {
        const cmd = getRegistry().get('twitter/like');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Tweet successfully liked.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency: looks for the unlike button (already-liked path) before clicking.
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"like\"]')");
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"unlike\"]')");
        expect(script).toContain('likeBtn.click()');
        // Article scoping comes from the shared helper (buildTwitterArticleScopeSource):
        // emits __twHasLinkToTarget + __twGetStatusIdFromHref + the anchored
        // tweet-path regex. JSDOM-level coverage lives in shared.test.js.
        expect(script).toContain('__twHasLinkToTarget');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain("document.querySelectorAll('article')");
        expect(result).toEqual([
            { status: 'success', message: 'Tweet successfully liked.' },
        ]);
    });

    it('returns a failed row without re-waiting when the like script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/like');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find the Like button on this tweet after waiting 10 seconds. Are you logged in?',
            },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Could not find the Like button on this tweet after waiting 10 seconds. Are you logged in?',
            },
        ]);
        // Only the primaryColumn wait should run when ok is false.
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/like');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects invalid tweet URLs before navigation', async () => {
        const cmd = getRegistry().get('twitter/like');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161/photo/1',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
