import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './unfollow.js';
import { createPageMock } from '../test-utils.js';

describe('twitter unfollow command', () => {
    it('navigates to the profile URL and reports success when the unfollow script confirms', async () => {
        const cmd = getRegistry().get('twitter/unfollow');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Successfully unfollowed @alice.' },
        ]);
        const result = await cmd.func(page, {
            username: 'alice',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency probe: when the Follow button is visible ([data-testid$="-follow"]
        // present, so not following), the script returns ok:true with an "already unfollowed" message.
        expect(script).toContain('[data-testid$="-follow"]');
        expect(script).toContain('[data-testid$="-unfollow"]');
        expect(script).toContain('unfollowBtn.click()');
        expect(script).toContain('[data-testid="confirmationSheetConfirm"]');
        expect(result).toEqual([
            { status: 'success', message: 'Successfully unfollowed @alice.' },
        ]);
    });

    it('typed-fails without re-waiting when the unfollow script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/unfollow');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find Unfollow button. Are you logged in?',
            },
        ]);
        await expect(cmd.func(page, {
            username: 'alice',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find Unfollow button. Are you logged in?',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/unfollow');
        await expect(cmd.func(undefined, {
            username: 'alice',
        })).rejects.toThrow(CommandExecutionError);
    });
});
