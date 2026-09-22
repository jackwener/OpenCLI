import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
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

    it('typed-fails without re-waiting when the bookmark script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find Bookmark button on the requested tweet. Are you logged in?',
            },
        ]);
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find Bookmark button on the requested tweet. Are you logged in?',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('polls for a delayed confirmation without clicking more than once', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        const dom = new JSDOM(`
            <article>
                <a href="/alice/status/2040254679301718161">tweet</a>
                <button data-testid="bookmark">Bookmark</button>
            </article>
        `, { runScripts: 'dangerously', url: 'https://x.com/alice/status/2040254679301718161' });
        const button = dom.window.document.querySelector('[data-testid="bookmark"]');
        let clicks = 0;
        button.addEventListener('click', () => {
            clicks++;
            dom.window.setTimeout(() => {
                const replacement = dom.window.document.createElement('button');
                replacement.setAttribute('data-testid', 'removeBookmark');
                button.replaceWith(replacement);
            }, 1100);
        });
        const page = createPageMock([], {
            evaluate: vi.fn((script) => dom.window.eval(script)),
        });

        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });

        expect(result).toEqual([
            { status: 'success', message: 'Tweet successfully bookmarked.' },
        ]);
        expect(clicks).toBe(1);
    }, 10000);

    it('preserves the uncertain-write timeout when confirmation never appears', async () => {
        const cmd = getRegistry().get('twitter/bookmark');
        const dom = new JSDOM(`
            <article>
                <a href="/alice/status/2040254679301718161">tweet</a>
                <button data-testid="bookmark">Bookmark</button>
            </article>
        `, { runScripts: 'dangerously', url: 'https://x.com/alice/status/2040254679301718161' });
        let clicks = 0;
        const button = dom.window.document.querySelector('[data-testid="bookmark"]');
        button.addEventListener('click', () => clicks++);
        const page = createPageMock([], {
            evaluate: vi.fn((script) => dom.window.eval(script)),
        });

        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('may already have succeeded'),
        });
        expect(clicks).toBe(1);
    }, 10000);

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
