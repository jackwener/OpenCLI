import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './delete.js';
describe('twitter delete command', () => {
    it('targets the matched tweet article instead of the first More button on the page', async () => {
        const cmd = getRegistry().get('twitter/delete');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ ok: true, message: 'Tweet successfully deleted.' }),
        };
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161?s=20',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161?s=20');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Article-scoping must come from the shared helper (not an inline
        // `pathname.includes('/status/' + tweetId)` substring match — see
        // codex-mini0 #1400 catch where `/status/123` would match
        // `/status/1234567`). The helper emits `__twHasLinkToTarget` and
        // `__twGetStatusIdFromHref` plus the canonical anchored regex.
        expect(script).toContain('__twHasLinkToTarget');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain("document.querySelectorAll('article')");
        expect(script).toContain("targetArticle.querySelectorAll('button,[role=\"button\"]')");
        expect(script).toContain("closest('article') === targetArticle");
        expect(script).toContain(".filter(belongsToTargetArticle)");
        // Localized "More" caret: prefer the language-agnostic data-testid, fall
        // back to a multilingual aria-label match (zh-Hans 更多), and poll for the
        // late-hydrating target article before giving up.
        expect(script).toContain('[data-testid="caret"]');
        expect(script).toContain('/^(More|更多)/');
        expect(script).toContain('i < 20');
        // Delete menu item is localized (删除) and must exclude the Lists item in
        // both languages (List / 列表).
        expect(script).toContain('删除');
        expect(script).toContain('列表');
        // Substring match must NOT appear — exact-id match only.
        expect(script).not.toContain("'/status/' + tweetId");
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Tweet successfully deleted.',
            },
        ]);
    });
    it('passes through matched-tweet lookup failures', async () => {
        const cmd = getRegistry().get('twitter/delete');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                message: 'Could not find the tweet card matching the requested URL.',
            }),
        };
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Could not find the tweet card matching the requested URL.',
            },
        ]);
        expect(page.wait).toHaveBeenCalledTimes(1);
    });
    it('unwraps Browser Bridge evaluate envelopes before checking delete success', async () => {
        const cmd = getRegistry().get('twitter/delete');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                session: 'twitter',
                data: { ok: true, message: 'Tweet successfully deleted.' },
            }),
        };
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Tweet successfully deleted.',
            },
        ]);
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
    });
    it('ignores stale non-target delete menu items that existed before opening the matched tweet menu', async () => {
        const dom = new JSDOM(`
            <body>
              <div role="menuitem" data-stale-delete>删除</div>
              <article>
                <a href="https://x.com/bob/status/999">wrong tweet</a>
                <button data-testid="caret" aria-label="更多"></button>
              </article>
              <article>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button data-testid="caret" aria-label="更多" data-target-caret></button>
              </article>
            </body>
        `, { runScripts: 'outside-only', url: 'https://x.com/alice/status/2040254679301718161' });
        dom.window.setTimeout = (handler) => {
            if (typeof handler === 'function') handler();
            return 0;
        };
        Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
            configurable: true,
            value() {
                return [{ bottom: 1, height: 1, left: 0, right: 1, top: 0, width: 1 }];
            },
        });
        let staleDeleteClicked = false;
        let targetCaretClicked = false;
        dom.window.document.querySelector('[data-stale-delete]')?.addEventListener('click', () => {
            staleDeleteClicked = true;
        });
        dom.window.document.querySelector('[data-target-caret]')?.addEventListener('click', () => {
            targetCaretClicked = true;
            const item = dom.window.document.createElement('div');
            item.setAttribute('role', 'menuitem');
            item.textContent = 'Pin to your profile';
            dom.window.document.body.appendChild(item);
        });
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(targetCaretClicked).toBe(true);
        expect(staleDeleteClicked).toBe(false);
        expect(result).toEqual({
            ok: false,
            message: 'The matched tweet menu did not contain Delete. This tweet may not belong to you.',
        });
    });
    it('rejects malformed or off-domain URLs with ArgumentError before navigation', async () => {
        const cmd = getRegistry().get('twitter/delete');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };
        // parseTweetUrl bubbles ArgumentError directly (no CommandExecutionError
        // wrapping); replaces the previous local extractTweetId path that hid
        // typed-input failures behind a generic CliError.
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/home',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.wait).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/delete');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(CommandExecutionError);
    });
});
