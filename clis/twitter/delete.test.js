import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './delete.js';
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
