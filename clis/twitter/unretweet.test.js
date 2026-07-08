import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './unretweet.js';
import { createPageMock } from '../test-utils.js';

describe('twitter unretweet command', () => {
    it('clicks the unretweet button then the confirm menu item and reports success', async () => {
        const cmd = getRegistry().get('twitter/unretweet');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Tweet successfully unretweeted.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice/status/2040254679301718161');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Two-step UI flow must be present:
        //   1) click the unretweet button
        //   2) wait for and click the confirm menu item (data-testid="unretweetConfirm")
        expect(script).toContain('unretweetBtn.click()');
        expect(script).toContain("document.querySelector('[data-testid=\"unretweetConfirm\"]')");
        expect(script).toContain('confirmBtn.click()');
        // Article scoping comes from the shared helper (buildTwitterArticleScopeSource):
        // emits __twHasLinkToTarget + __twGetStatusIdFromHref + the anchored
        // tweet-path regex. JSDOM-level coverage lives in shared.test.js.
        expect(script).toContain('__twHasLinkToTarget');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain("document.querySelectorAll('article')");
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"unretweet\"]')");
        // Idempotency probe: when already not retweeted ([data-testid="retweet"] present),
        // the script returns ok:true with an "already removed" message.
        expect(script).toContain("targetArticle?.querySelector('[data-testid=\"retweet\"]')");
        expect(result).toEqual([
            { status: 'success', message: 'Tweet successfully unretweeted.' },
        ]);
    });

    it('returns a failed row when the confirm menu item never appears', async () => {
        const cmd = getRegistry().get('twitter/unretweet');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: false, message: 'Unretweet menu opened but the confirm option did not appear.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            { status: 'failed', message: 'Unretweet menu opened but the confirm option did not appear.' },
        ]);
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/unretweet');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects invalid tweet URLs before navigation', async () => {
        const cmd = getRegistry().get('twitter/unretweet');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'http://x.com/alice/status/2040254679301718161',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
