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
    it('typed-fails on matched-tweet lookup failures', async () => {
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
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find the tweet card matching the requested URL.',
        });
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
    // Regression: `twitter delete` failed on the first invocation and then
    // succeeded on a byte-identical immediate retry. Window mode is a confound,
    // not the cause — the first call in either mode loses the same race, and
    // `--window foreground` does not avoid it. What decides it is whether the
    // page and renderer are cold: X hydrates the tweet card in stages and
    // appends the "More" caret after the action bar. Measured on a real
    // x.com/<user>/status page — a warm visible window matched the article at
    // 0ms and grew the caret at ~250ms; a cold minimized one matched at ~0.9s
    // and grew the caret at ~1.9s; menu items landed ~1s after the caret click.
    // In both cases the caret was absent from the entire document at check
    // time, and once present it reported offsetParent and one client rect even
    // while hidden — so the failure is "not hydrated yet", not "invisible", and
    // every stage of this flow must poll rather than sample once.
    function createDeleteDom(html, url = 'https://x.com/alice/status/2040254679301718161') {
        const dom = new JSDOM(html, { runScripts: 'outside-only', url });
        const state = { ticks: 0, onTick: () => { } };
        dom.window.setTimeout = (handler) => {
            state.ticks += 1;
            state.onTick(state.ticks);
            if (typeof handler === 'function') handler();
            return 0;
        };
        return { dom, state };
    }
    function stubLayoutMetrics(dom) {
        Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
            configurable: true,
            value() {
                return [{ bottom: 1, height: 1, left: 0, right: 1, top: 0, width: 1 }];
            },
        });
    }
    function appendMenuItem(dom, text) {
        const item = dom.window.document.createElement('div');
        item.setAttribute('role', 'menuitem');
        item.textContent = text;
        dom.window.document.body.appendChild(item);
        return item;
    }
    function wireDeleteFlow(dom, clicks, { menuDelay = 0, confirmDelay = 0, state } = {}) {
        const schedule = (delay, run) => {
            if (!delay) return run();
            const due = state.ticks + delay;
            const previous = state.onTick;
            state.onTick = (tick) => {
                previous(tick);
                if (tick === due) run();
            };
        };
        const onDeleteClick = () => {
            clicks.push('delete');
            schedule(confirmDelay, () => {
                const confirm = dom.window.document.createElement('button');
                confirm.setAttribute('data-testid', 'confirmationSheetConfirm');
                confirm.addEventListener('click', () => clicks.push('confirm'));
                dom.window.document.body.appendChild(confirm);
            });
        };
        return () => {
            clicks.push('caret');
            schedule(menuDelay, () => {
                // X paints the popup in more than one chunk; the first chunk can
                // arrive without the row we need.
                appendMenuItem(dom, 'Pin to your profile');
                schedule(1, () => {
                    appendMenuItem(dom, 'Delete').addEventListener('click', onDeleteClick);
                });
            });
        };
    }
    it('polls for the "More" caret X appends after the article hydrates', async () => {
        const { dom, state } = createDeleteDom(`
            <body>
              <article data-target>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button aria-label="12 Replies. Reply"></button>
              </article>
            </body>
        `);
        stubLayoutMetrics(dom);
        const clicks = [];
        const caretHandler = wireDeleteFlow(dom, clicks, { state, menuDelay: 3, confirmDelay: 2 });
        // The article is matchable from the first tick, so the pre-existing
        // findTargetArticle() poll never runs and never gives the caret a chance
        // to land: before the fix this returned the "More" lookup failure.
        state.onTick = (tick) => {
            if (tick !== 3) return;
            const caret = dom.window.document.createElement('button');
            caret.setAttribute('data-testid', 'caret');
            caret.setAttribute('aria-label', 'More');
            caret.addEventListener('click', caretHandler);
            dom.window.document.querySelector('[data-target]').appendChild(caret);
        };
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(clicks).toEqual(['caret', 'delete', 'confirm']);
        expect(result).toEqual({ ok: true, message: 'Tweet successfully deleted.' });
    });
    it('waits for the whole context menu instead of reading it after one fixed sleep', async () => {
        const { dom, state } = createDeleteDom(`
            <body>
              <article data-target>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button data-testid="caret" aria-label="更多" data-target-caret></button>
              </article>
            </body>
        `);
        stubLayoutMetrics(dom);
        const clicks = [];
        dom.window.document.querySelector('[data-target-caret]')
            .addEventListener('click', wireDeleteFlow(dom, clicks, { state, menuDelay: 4, confirmDelay: 3 }));
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(clicks).toEqual(['caret', 'delete', 'confirm']);
        expect(result).toEqual({ ok: true, message: 'Tweet successfully deleted.' });
    });
    it('uses controls that report no layout metrics once they are scoped to the matched article', async () => {
        // No getClientRects stub here: in jsdom offsetParent is null and
        // getClientRects() is empty for every node, which is the degenerate case
        // the old `visible()` gate treated as "the button does not exist".
        const { dom, state } = createDeleteDom(`
            <body>
              <article>
                <a href="https://x.com/bob/status/999">wrong tweet</a>
                <button data-testid="caret" aria-label="More" data-wrong-caret></button>
              </article>
              <article data-target>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button data-testid="caret" aria-label="More" data-target-caret></button>
              </article>
            </body>
        `);
        const clicks = [];
        dom.window.document.querySelector('[data-wrong-caret]')
            .addEventListener('click', () => clicks.push('wrong-caret'));
        dom.window.document.querySelector('[data-target-caret]')
            .addEventListener('click', wireDeleteFlow(dom, clicks, { state, menuDelay: 2, confirmDelay: 1 }));
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        // Scoping still decides which caret is clicked — the fallback only
        // relaxes the visibility tie-breaker, never the article scope.
        expect(clicks).toEqual(['caret', 'delete', 'confirm']);
        expect(result).toEqual({ ok: true, message: 'Tweet successfully deleted.' });
    });
    it('completes on the first call when the caret hydrates late AND reports no layout metrics', async () => {
        // The cold-start worst case, and the one the user actually hit: neither
        // the element nor its measurements are there when the script first
        // looks. Before the fix this is the run that failed and sent the user
        // back for a byte-identical retry — fatal for callers like ml-scout's
        // retract flow, which is deliberately zero-retry.
        const { dom, state } = createDeleteDom(`
            <body>
              <article data-target>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button aria-label="12 Replies. Reply"></button>
              </article>
            </body>
        `);
        const clicks = [];
        const caretHandler = wireDeleteFlow(dom, clicks, { state, menuDelay: 2, confirmDelay: 2 });
        state.onTick = (tick) => {
            if (tick !== 4) return;
            const caret = dom.window.document.createElement('button');
            caret.setAttribute('data-testid', 'caret');
            caret.setAttribute('aria-label', 'More');
            caret.addEventListener('click', caretHandler);
            dom.window.document.querySelector('[data-target]').appendChild(caret);
        };
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(clicks).toEqual(['caret', 'delete', 'confirm']);
        expect(result).toEqual({ ok: true, message: 'Tweet successfully deleted.' });
    });
    it('still reports the "More" failure when the caret never hydrates', async () => {
        const { dom } = createDeleteDom(`
            <body>
              <article>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
              </article>
            </body>
        `);
        stubLayoutMetrics(dom);
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(result).toEqual({
            ok: false,
            message: 'Could not find the "More" context menu on the matched tweet. Are you sure you are logged in and looking at a valid tweet?',
        });
    });
    it('reports a missing confirmation sheet instead of claiming success', async () => {
        const { dom } = createDeleteDom(`
            <body>
              <article>
                <a href="https://x.com/alice/status/2040254679301718161">target tweet</a>
                <button data-testid="caret" aria-label="More" data-target-caret></button>
              </article>
            </body>
        `);
        stubLayoutMetrics(dom);
        dom.window.document.querySelector('[data-target-caret]').addEventListener('click', () => {
            appendMenuItem(dom, '删除');
        });
        const result = await dom.window.eval(__test__.buildDeleteScript('2040254679301718161'));
        expect(result).toEqual({ ok: false, message: 'Delete confirmation dialog did not appear.' });
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
