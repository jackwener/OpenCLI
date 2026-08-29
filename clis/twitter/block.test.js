import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './block.js';
import { createPageMock } from '../test-utils.js';
import { createInteractiveTwitterDomPage, createTwitterDomPage } from './test-dom-utils.js';

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
        expect(script).toContain("lower.includes('block')");
        expect(script).toContain("text.includes('屏蔽')");
        expect(script).toContain("text.includes('取消屏蔽')");
        expect(script).toContain("item.getAttribute('data-testid') === 'block'");
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

    it('keeps a missing confirmation dialog a definite pre-write failure', async () => {
        const cmd = getRegistry().get('twitter/block');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="userActions">More</button>
            </main>
            <button role="menuitem">Block @alice</button>
        `, 'https://x.com/alice');

        await expect(cmd.func(page, { username: 'alice' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Block confirmation dialog did not appear.',
        });
    });

    it('treats a missing post-confirm profile state change as unconfirmed', async () => {
        const cmd = getRegistry().get('twitter/block');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="userActions">More</button>
            </main>
            <button role="menuitem">Block @alice</button>
            <button data-testid="confirmationSheetConfirm">Confirm</button>
        `, 'https://x.com/alice');

        await expect(cmd.func(page, { username: 'alice' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('may already have succeeded'),
        });
    });

    it('blocks via localized menu text and data-testid="block"', async () => {
        const cmd = getRegistry().get('twitter/block');
        const { page, dom } = createInteractiveTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="userActions">更多</button>
            </main>
            <div role="menuitem" data-testid="block">屏蔽 @alice</div>
            <button data-testid="confirmationSheetConfirm">确认</button>
        `, 'https://x.com/alice');
        dom.window.document
            .querySelector('[data-testid="confirmationSheetConfirm"]')
            .addEventListener('click', () => {
                dom.window.document
                    .querySelector('[data-testid="primaryColumn"]')
                    .insertAdjacentHTML('beforeend', '<button data-testid="alice-unblock">已屏蔽</button>');
            });

        const result = await cmd.func(page, { username: 'alice' });

        expect(result).toEqual([
            { status: 'success', message: 'Successfully blocked @alice.' },
        ]);
    });

    it('does not click localized unblock menu items while looking for Block', async () => {
        const cmd = getRegistry().get('twitter/block');
        const { page, dom } = createInteractiveTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="userActions">更多</button>
            </main>
            <div role="menuitem">取消屏蔽 @alice</div>
            <button data-testid="confirmationSheetConfirm">确认</button>
        `, 'https://x.com/alice');
        let cancelClicked = false;
        let confirmClicked = false;
        dom.window.document
            .querySelector('[role="menuitem"]')
            .addEventListener('click', () => {
                cancelClicked = true;
            });
        dom.window.document
            .querySelector('[data-testid="confirmationSheetConfirm"]')
            .addEventListener('click', () => {
                confirmClicked = true;
            });

        await expect(cmd.func(page, { username: 'alice' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find Block option in menu.',
        });
        expect(cancelClicked).toBe(false);
        expect(confirmClicked).toBe(false);
    });

    it('verifies against the current primary column after confirmation replaces the profile surface', async () => {
        const cmd = getRegistry().get('twitter/block');
        const { page, dom } = createInteractiveTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button data-testid="userActions">More</button>
            </main>
            <div role="menuitem">Block @alice</div>
            <button data-testid="confirmationSheetConfirm">Confirm</button>
        `, 'https://x.com/alice');
        dom.window.document
            .querySelector('[data-testid="confirmationSheetConfirm"]')
            .addEventListener('click', () => {
                dom.window.document
                    .querySelector('[data-testid="primaryColumn"]')
                    .outerHTML = '<main data-testid="primaryColumn"><button data-testid="alice-unblock">Blocked</button></main>';
            });

        const result = await cmd.func(page, { username: 'alice' });

        expect(result).toEqual([
            { status: 'success', message: 'Successfully blocked @alice.' },
        ]);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/block');
        await expect(cmd.func(undefined, {
            username: 'alice',
        })).rejects.toThrow(CommandExecutionError);
    });
});
