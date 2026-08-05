import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './follow.js';
import { createPageMock } from '../test-utils.js';

describe('twitter follow command', () => {
    it('navigates to the profile URL and reports success when the follow script confirms', async () => {
        const cmd = getRegistry().get('twitter/follow');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Successfully followed @alice.' },
        ]);
        const result = await cmd.func(page, {
            username: 'alice',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency probe: when already following ([data-testid$="-unfollow"] present),
        // the script returns ok:true with an "already following" message.
        expect(script).toContain('[data-testid$="-unfollow"]');
        expect(script).toContain('[data-testid$="-follow"]');
        expect(script).toContain('followBtn.click()');
        expect(result).toEqual([
            { status: 'success', message: 'Successfully followed @alice.' },
        ]);
    });

    it('typed-fails without re-waiting when the follow script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/follow');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find Follow button. Are you logged in?',
            },
        ]);
        await expect(cmd.func(page, {
            username: 'alice',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find Follow button. Are you logged in?',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/follow');
        await expect(cmd.func(undefined, {
            username: 'alice',
        })).rejects.toThrow(CommandExecutionError);
    });
});
