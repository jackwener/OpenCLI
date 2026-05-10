import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark.js';
import { createPageMock } from '../test-utils.js';

describe('twitter bookmark command', () => {
    it('navigates to the tweet URL and reports success when the bookmark script confirms', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Tweet successfully bookmarked.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency probe: when already bookmarked ([data-testid="removeBookmark"] present),
        // the script returns ok:true with an "already bookmarked" message.
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"removeBookmark\"]')");
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"bookmark\"]')");
        expect(script).toContain('bookmarkBtn.click()');
        // Article scoping comes from the shared helper (buildTwitterArticleScopeSource):
        // critical here because conversation pages render multiple
        // bookmark/removeBookmark buttons and a bare querySelector would
        // silently bookmark a different tweet.
        expect(script).toContain('__twHasLinkToTarget');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain("document.querySelectorAll('article')");
        expect(result).toEqual([
            { status: 'success', message: 'Tweet successfully bookmarked.' },
        ]);
    });

    it('returns a failed row without re-waiting when the bookmark script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find Bookmark button on the requested tweet. Are you logged in?',
            },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Could not find Bookmark button on the requested tweet. Are you logged in?',
            },
        ]);
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects invalid tweet URLs before navigation', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://evil.com/?next=https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
