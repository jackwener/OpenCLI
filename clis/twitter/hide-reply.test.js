import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './hide-reply.js';
import { createPageMock } from '../test-utils.js';

function makeVisibleDom(html, url) {
    const dom = new JSDOM(html, {
        url,
        runScripts: 'outside-only',
    });
    dom.window.setTimeout = (callback) => {
        callback();
        return 0;
    };
    dom.window.HTMLElement.prototype.getClientRects = function getClientRects() {
        return [{ width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 }];
    };
    return dom;
}

function createMultiPageDomPage(pages, initialUrl) {
    let current = pages[initialUrl];
    return {
        goto: vi.fn(async (url) => {
            current = pages[url];
            if (!current) throw new Error(`Unexpected navigation: ${url}`);
        }),
        wait: vi.fn(async () => undefined),
        evaluate: vi.fn(async (script) => current.window.eval(String(script))),
    };
}

describe('twitter hide-reply command', () => {
    it('navigates to the reply URL and reports success when the hide-reply script confirms', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Reply successfully hidden.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Article-scoped More menu lookup — without scoping, the bare
        // [aria-label="More"] selector grabs the parent tweet's More menu and
        // silently hides the wrong reply (or fails because the parent is not a
        // reply you authored).
        expect(script).toContain('moreMenu.click()');
        expect(script).toContain("new Set(['More', '更多'])");
        expect(script).toContain('findParentConversationUrl');
        expect(script).toContain('[role="menuitem"]');
        expect(script).toContain("'Hide reply'");
        expect(script).toContain("'hideReply'");
        expect(script).toContain("'隐藏回复'");
        expect(script).toContain('hideItem.click()');
        // Article scoping comes from the shared helper (buildTwitterArticleScopeSource):
        // emits __twHasLinkToTarget + __twGetStatusIdFromHref + the anchored
        // tweet-path regex. JSDOM-level coverage lives in shared.test.js.
        expect(script).toContain('__twHasLinkToTarget');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain("document.querySelectorAll('article')");
        expect(result).toEqual([
            { status: 'success', message: 'Reply successfully hidden.' },
        ]);
    });

    it('retries in the parent conversation when standalone reply page lacks the hide menu item', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const replyUrl = 'https://x.com/bob/status/222';
        const parentUrl = 'https://x.com/alice/status/111';
        const pages = {
            [replyUrl]: makeVisibleDom(`
                <main data-testid="primaryColumn">
                    <article id="parent"><a href="${parentUrl}"><time datetime="2026-08-23">parent</time></a></article>
                    <article id="reply">
                        <a href="${replyUrl}">reply</a>
                        <button aria-label="更多">menu</button>
                    </article>
                </main>
            `, replyUrl),
            [parentUrl]: makeVisibleDom(`
                <main data-testid="primaryColumn">
                    <article id="parent"><a href="${parentUrl}"><time datetime="2026-08-23">parent</time></a></article>
                    <article id="reply">
                        <a href="${replyUrl}">reply</a>
                        <button aria-label="更多">menu</button>
                    </article>
                </main>
                <div role="menuitem" data-testid="hideReply">隐藏回复</div>
            `, parentUrl),
        };
        const page = createMultiPageDomPage(pages, replyUrl);

        const result = await cmd.func(page, { url: replyUrl });

        expect(page.goto).toHaveBeenNthCalledWith(1, replyUrl);
        expect(page.goto).toHaveBeenNthCalledWith(2, parentUrl);
        expect(page.wait).toHaveBeenCalledTimes(3);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(result).toEqual([
            { status: 'success', message: 'Reply successfully hidden.' },
        ]);
    });

    it('uses the parent tweet time permalink instead of an earlier quoted status link', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const replyUrl = 'https://x.com/bob/status/222';
        const parentUrl = 'https://x.com/alice/status/111';
        const quotedUrl = 'https://x.com/quoted/status/999';
        const pages = {
            [replyUrl]: makeVisibleDom(`
                <main data-testid="primaryColumn">
                    <article id="parent">
                        <a href="${quotedUrl}">quoted card</a>
                        <a href="${parentUrl}"><time datetime="2026-08-23">parent</time></a>
                    </article>
                    <article id="reply">
                        <a href="${replyUrl}">reply</a>
                        <button aria-label="More">menu</button>
                    </article>
                </main>
            `, replyUrl),
            [parentUrl]: makeVisibleDom(`
                <main data-testid="primaryColumn">
                    <article id="parent"><a href="${parentUrl}"><time datetime="2026-08-23">parent</time></a></article>
                    <article id="reply">
                        <a href="${replyUrl}">reply</a>
                        <button aria-label="More">menu</button>
                    </article>
                </main>
                <div role="menuitem">Hide reply</div>
            `, parentUrl),
        };
        const page = createMultiPageDomPage(pages, replyUrl);

        const result = await cmd.func(page, { url: replyUrl });

        expect(page.goto).toHaveBeenNthCalledWith(1, replyUrl);
        expect(page.goto).toHaveBeenNthCalledWith(2, parentUrl);
        expect(page.goto).not.toHaveBeenCalledWith(quotedUrl);
        expect(result).toEqual([
            { status: 'success', message: 'Reply successfully hidden.' },
        ]);
    });

    it('does not retry a parent conversation URL from a different Twitter/X origin', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const replyUrl = 'https://x.com/bob/status/222';
        const crossOriginParentUrl = 'https://twitter.com/alice/status/111';
        const pages = {
            [replyUrl]: makeVisibleDom(`
                <main data-testid="primaryColumn">
                    <article id="parent"><a href="${crossOriginParentUrl}"><time datetime="2026-08-23">parent</time></a></article>
                    <article id="reply">
                        <a href="${replyUrl}">reply</a>
                        <button aria-label="More">menu</button>
                    </article>
                </main>
            `, replyUrl),
        };
        const page = createMultiPageDomPage(pages, replyUrl);

        await expect(cmd.func(page, { url: replyUrl })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.',
        });
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('typed-fails without re-waiting when the hide-reply script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.',
            },
        ]);
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects invalid tweet URLs before navigation', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com.evil.com/alice/status/2040254679301718161',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
