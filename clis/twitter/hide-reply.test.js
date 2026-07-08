import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './hide-reply.js';
import { createPageMock } from '../test-utils.js';

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
        expect(script).toContain('[role="menuitem"]');
        expect(script).toContain("'Hide reply'");
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

    it('returns a failed row without re-waiting when the hide-reply script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/hide-reply');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.',
            },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.',
            },
        ]);
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
