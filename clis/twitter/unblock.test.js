import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './unblock.js';
import { createPageMock } from '../test-utils.js';
import { createInteractiveTwitterDomPage } from './test-dom-utils.js';

describe('twitter unblock command', () => {
    it('navigates to the profile URL and reports success when the unblock script confirms', async () => {
        const cmd = getRegistry().get('twitter/unblock');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Successfully unblocked @alice.' },
        ]);
        const result = await cmd.func(page, {
            username: 'alice',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/alice');
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="primaryColumn"]' });
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
        const script = page.evaluate.mock.calls[0][0];
        // Idempotency probe: when the Follow button is visible ([data-testid$="-follow"]
        // present, so not blocked), the script returns ok:true with an "already unblocked" message.
        expect(script).toContain("document.querySelector('[data-testid=\"primaryColumn\"]')");
        expect(script).toContain('[data-testid$="-follow"]');
        expect(script).toContain('[data-testid$="-unblock"]');
        expect(script).toContain('unblockBtn.click()');
        expect(script).toContain('[data-testid="confirmationSheetConfirm"]');
        expect(result).toEqual([
            { status: 'success', message: 'Successfully unblocked @alice.' },
        ]);
    });

    it('typed-fails without re-waiting when the unblock script reports a UI mismatch', async () => {
        const cmd = getRegistry().get('twitter/unblock');
        const page = createPageMock([
            {
                ok: false,
                message: 'Could not find Unblock button. Are you logged in?',
            },
        ]);
        await expect(cmd.func(page, {
            username: 'alice',
        })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find Unblock button. Are you logged in?',
        });
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('ignores sidebar follow buttons when deciding whether the profile is already unblocked', async () => {
        const cmd = getRegistry().get('twitter/unblock');
        const { page, dom } = createInteractiveTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="alice-unblock">Unblock</button>
            </main>
            <aside>
                <button data-testid="370654420-follow">Follow suggested account</button>
            </aside>
            <button data-testid="confirmationSheetConfirm">Confirm</button>
        `, 'https://x.com/alice');
        dom.window.document
            .querySelector('[data-testid="confirmationSheetConfirm"]')
            .addEventListener('click', () => {
                dom.window.document
                    .querySelector('[data-testid="primaryColumn"]')
                    .insertAdjacentHTML('beforeend', '<button data-testid="alice-follow">Follow</button>');
            });

        const result = await cmd.func(page, { username: 'alice' });

        expect(result).toEqual([
            { status: 'success', message: 'Successfully unblocked @alice.' },
        ]);
    });

    it('verifies against the current primary column after confirmation replaces the profile surface', async () => {
        const cmd = getRegistry().get('twitter/unblock');
        const { page, dom } = createInteractiveTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="alice-unblock">Unblock</button>
            </main>
            <button data-testid="confirmationSheetConfirm">Confirm</button>
        `, 'https://x.com/alice');
        dom.window.document
            .querySelector('[data-testid="confirmationSheetConfirm"]')
            .addEventListener('click', () => {
                dom.window.document
                    .querySelector('[data-testid="primaryColumn"]')
                    .outerHTML = '<main data-testid="primaryColumn"><button data-testid="alice-follow">Follow</button></main>';
            });

        const result = await cmd.func(page, { username: 'alice' });

        expect(result).toEqual([
            { status: 'success', message: 'Successfully unblocked @alice.' },
        ]);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/unblock');
        await expect(cmd.func(undefined, {
            username: 'alice',
        })).rejects.toThrow(CommandExecutionError);
    });
});
