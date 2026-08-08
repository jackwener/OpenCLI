import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './block.js';
import { createPageMock } from '../test-utils.js';

describe('twitter block command', () => {
    it('navigates to the profile URL and reports success when the block script confirms', async () => {
        const cmd = getRegistry().get('twitter/block');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Successfully blocked @alice.' },
        ]);
        const result = await cmd.func(page, {
            username: 'alice',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency probe: when already blocking ([data-testid$="-unblock"] present),
        // the script returns ok:true with an "already blocking" message.
        expect(script).toContain('[data-testid$="-unblock"]');
        expect(script).toContain('[data-testid="userActions"]');
        expect(script).toContain("includes('Block')");
        expect(script).toContain('blockItem.click()');
        expect(script).toContain('[data-testid="confirmationSheetConfirm"]');
        expect(result).toEqual([
            { status: 'success', message: 'Successfully blocked @alice.' },
        ]);
    });

    it('typed-fails without re-waiting when the block script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/block');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find user actions menu. Are you logged in?',
            },
        ]);
        await expect(cmd.func(page, {
            username: 'alice',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find user actions menu. Are you logged in?',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/block');
        await expect(cmd.func(undefined, {
            username: 'alice',
        })).rejects.toThrow(CommandExecutionError);
    });
});
