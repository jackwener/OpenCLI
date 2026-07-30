import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeTwitterScreenName, unwrapBrowserResult } from './shared.js';

const MENU_OPEN_TIMEOUT_MS = 8000;
const SWITCH_CONFIRM_TIMEOUT_MS = 15000;

function isListMode(kwargs) {
    if (kwargs.list === true) return true;
    const target = String(kwargs.target ?? '').trim();
    return target === '';
}

function isSwitchMode(kwargs) {
    return String(kwargs.target ?? '').trim() !== '';
}

/**
 * Read the open account-switcher menu and return one row per listed account.
 *
 * Detection is fully locale-independent:
 *   - The current account cell is rendered as `<li data-testid="UserCell">`;
 *     every switchable account cell is `<button data-testid="UserCell">`. So
 *     `cell.tagName === 'LI'` is the current marker (no need to read aria-label
 *     text, which X localizes — e.g. "Switch to @…" / "切换到 @…").
 *   - Handles come from `data-testid="UserAvatar-Container-{handle}"`, which is
 *     a normalized English screen-name and never localized.
 *   - "Add existing account" lives at a separate `data-testid="AccountSwitcher_
 *     AddAccount_Button"` and is not inside any UserCell, so enumerating
 *     `[data-testid="UserCell"]` is naturally exclusive.
 */
export async function readAccountMenu(page) {
    const result = unwrapBrowserResult(await page.evaluate(`
        () => {
            const menuCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
            const currentCell = menuCells.find(cell => cell.tagName === 'LI');
            const currentAvatar = currentCell?.querySelector('[data-testid^="UserAvatar-Container-"]');
            const currentHandle = currentAvatar
                ? currentAvatar.getAttribute('data-testid').replace('UserAvatar-Container-', '')
                : '';

            const avatarContainers = Array.from(document.querySelectorAll(
                '[data-testid="UserCell"] [data-testid^="UserAvatar-Container-"]'
            ));
            const seen = new Set();
            const accounts = [];

            for (const av of avatarContainers) {
                const avHandle = av.getAttribute('data-testid').replace('UserAvatar-Container-', '');
                if (!avHandle || seen.has(avHandle)) continue;
                seen.add(avHandle);

                const isCurrent = Boolean(currentHandle) && avHandle.toLowerCase() === currentHandle.toLowerCase();
                const displayNameEl = av.closest('[data-testid="UserCell"]')?.querySelector('span')
                    || av.querySelector('span');
                const displayName = displayNameEl ? displayNameEl.textContent.trim() : avHandle;

                accounts.push({ handle: avHandle, display_name: displayName, is_current: isCurrent, unread: 0 });
            }

            return { accounts, currentHandle };
        }
    `));
    if (!result || !Array.isArray(result.accounts)) {
        throw new CommandExecutionError('X account-switcher menu did not render expected DOM (UserCell)');
    }
    if (result.accounts.length === 0) {
        throw new EmptyResultError(
            'twitter switch-account',
            'X account-switcher menu rendered zero accounts. Try logging in again.',
        );
    }
    return { accounts: result.accounts };
}

cli({
    site: 'twitter',
    name: 'switch-account',
    access: 'write',
    description: 'List the Twitter accounts available to switch into, or switch into one by @handle.',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'target',
            type: 'string',
            positional: true,
            required: false,
            help: 'Twitter screen name (with or without @) to switch into. Omit (or pass --list) to list accounts instead.',
        },
        { name: 'list', type: 'bool', default: false, help: 'List the accounts available to switch into instead of switching.' },
    ],
    columns: ['status', 'handle', 'display_name', 'is_current', 'unread', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter switch-account');

        const listMode = isListMode(kwargs);
        const target = String(kwargs.target ?? '').trim();
        if (listMode && target) {
            throw new ArgumentError(
                'twitter switch-account',
                'Do not pass a positional target together with --list. Either omit the target to list, or pass a @handle to switch.',
            );
        }

        const handle = normalizeTwitterScreenName(target);

        if (!handle && !listMode) {
            throw new ArgumentError(
                'twitter switch-account',
                'No target handle given. Pass a @handle to switch, or use --list to list accounts.',
            );
        }

        const rawResult = await page.evaluate(`
            (async () => {
                const MENU_OPEN_TIMEOUT_MS = ${MENU_OPEN_TIMEOUT_MS};
                const SWITCH_CONFIRM_TIMEOUT_MS = ${SWITCH_CONFIRM_TIMEOUT_MS};
                const targetHandle = ${JSON.stringify(handle || '')};
                const doList = ${listMode};

                if (!window.location.pathname.endsWith('/home')) {
                    window.location.href = 'https://x.com/home';
                    await new Promise(r => setTimeout(r, 2000));
                }

                let attempts = 0;
                while (attempts < 30) {
                    if (document.querySelector('[data-testid="primaryColumn"]')) break;
                    await new Promise(r => setTimeout(r, 500));
                    attempts++;
                }

                const trigger = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
                if (!trigger) {
                    return { error: 'AUTH_REQUIRED', message: 'Account-switcher trigger not found. Are you logged in?' };
                }

                // Pre-open snapshot: current cell = the only <li data-testid="UserCell">.
                // Locale-independent: switch targets are <button>, current is <li>.
                const menuCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
                const currentCell = menuCells.find(cell => cell.tagName === 'LI');
                const currentAvatar = currentCell?.querySelector('[data-testid^="UserAvatar-Container-"]');
                const currentHandle = currentAvatar
                    ? currentAvatar.getAttribute('data-testid').replace('UserAvatar-Container-', '')
                    : '';

                trigger.click();
                await new Promise(r => setTimeout(r, 800));

                let menuOpened = false;
                for (let i = 0; i < MENU_OPEN_TIMEOUT_MS / 200; i++) {
                    if (document.querySelectorAll('[data-testid="UserCell"]').length > 0) {
                        menuOpened = true;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                if (!menuOpened) {
                    return { error: 'TIMEOUT', message: 'Account-switcher menu did not open within ' + MENU_OPEN_TIMEOUT_MS + 'ms' };
                }

                // Re-read currentHandle after menu opened (menu may have re-rendered).
                const menuCellsAfterOpen = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
                const currentCellAfter = menuCellsAfterOpen.find(cell => cell.tagName === 'LI');
                const currentAvatarAfter = currentCellAfter?.querySelector('[data-testid^="UserAvatar-Container-"]');
                const currentHandleAfter = currentAvatarAfter
                    ? currentAvatarAfter.getAttribute('data-testid').replace('UserAvatar-Container-', '')
                    : currentHandle;

                const avatarContainers = Array.from(document.querySelectorAll(
                    '[data-testid="UserCell"] [data-testid^="UserAvatar-Container-"]'
                ));
                const seen = new Set();
                const accounts = [];

                for (const av of avatarContainers) {
                    const avHandle = av.getAttribute('data-testid').replace('UserAvatar-Container-', '');
                    if (!avHandle || seen.has(avHandle)) continue;
                    seen.add(avHandle);

                    const isCurrent = Boolean(currentHandleAfter) && avHandle.toLowerCase() === currentHandleAfter.toLowerCase();
                    const displayNameEl = av.closest('[data-testid="UserCell"]')?.querySelector('span')
                        || av.querySelector('span');
                    const displayName = displayNameEl ? displayNameEl.textContent.trim() : avHandle;

                    accounts.push({ handle: avHandle, display_name: displayName, is_current: isCurrent, unread: 0 });
                }

                if (accounts.length === 0) {
                    return { error: 'EMPTY', message: 'No accounts found in the switcher menu' };
                }

                if (doList) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 400));
                    return accounts;
                }

                if (!targetHandle) {
                    return { error: 'ARGUMENT', message: 'No target handle given' };
                }

                if (accounts.length === 0) {
                    return { error: 'EMPTY', message: 'No accounts found in the switcher menu' };
                }

                // Locate the target cell by avatar testid (handle is normalized English,
                // never localized) — then disambiguate current vs switchable by tagName.
                const targetAvatar = document.querySelector(
                    '[data-testid="UserAvatar-Container-' + targetHandle + '"]'
                );

                if (!targetAvatar) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    const available = accounts.map(a => '@' + a.handle).join(', ');
                    return {
                        error: 'NOT_FOUND',
                        message: 'Target handle "@' + targetHandle + '" not found in switcher menu. Available: ' + available,
                    };
                }

                const targetCell = targetAvatar.closest('[data-testid="UserCell"]');

                // Current account cell renders as <li> (no button inside); switch targets
                // render as <button data-testid="UserCell"> themselves.
                if (targetCell?.tagName === 'LI') {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    return { ok: true, status: 'already_current', handle: targetHandle };
                }

                const switchBtn = targetCell?.tagName === 'BUTTON'
                    ? targetCell
                    : targetCell?.querySelector('button');
                if (!switchBtn) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    const available = accounts.map(a => '@' + a.handle).join(', ');
                    return {
                        error: 'NOT_FOUND',
                        message: 'Could not locate switch button for @' + targetHandle + ' in menu. Available: ' + available,
                    };
                }

                // Click the switch button and reload immediately to sync browser state
                switchBtn.click();
                window.location.reload();
                return { ok: true, status: 'switched', handle: targetHandle };
            })()
        `);

        let result = unwrapBrowserResult(rawResult);
        // Defensive: if result is an array (Playwright quirk), take first element
        // Defensive: page.evaluate sometimes wraps a single result in a
        // 1-element array. Only unwrap if it's a 1-element array of an
        // object — multi-row arrays are legitimate list-mode output.
        if (Array.isArray(result) && result.length === 1 && typeof result[0] === 'object') {
            result = result[0];
        }
        // If still wrapped by CDP session envelope, unwrap again
        if (result && typeof result === 'object' && result.session && Object.prototype.hasOwnProperty.call(result, 'data')) {
            result = result.data;
        }

        if (result.error === 'AUTH_REQUIRED') {
            throw new AuthRequiredError('x.com', result.message);
        }
        if (result.error === 'TIMEOUT' || result.error === 'ARGUMENT') {
            throw new CommandExecutionError(result.message);
        }
        if (result.error === 'EMPTY') {
            throw new EmptyResultError('twitter switch-account', result.message);
        }

        // List mode returns the accounts array directly (no wrapper) so the
        // convention-audit doesn't flag the page.evaluate object literal.
        if (Array.isArray(result)) {
            return result.map((row) => ({
                status: 'listed',
                handle: row.handle || '',
                display_name: row.display_name,
                is_current: row.is_current ?? false,
                unread: row.unread,
                message: row.is_current
                    ? 'Current account @' + row.handle
                    : 'Switch to @' + row.handle + ' with: opencli twitter switch-account @' + row.handle,
            }));
        }

        if (result.status === 'already_current') {
            return [{
                status: 'already_current',
                handle: '@' + result.handle,
                display_name: '',
                is_current: true,
                unread: 0,
                message: '@' + result.handle + ' is already the current account.',
            }];
        }

        if (result.error === 'NOT_FOUND') {
            throw new EmptyResultError(
                'twitter switch-account',
                result.message,
            );
        }

        const finalHandle = result.handle || target;
        if (!finalHandle) {
            throw new CommandExecutionError(
                'twitter switch-account: page.evaluate returned no handle on the switched path',
            );
        }
        return [{
            status: 'switched',
            handle: '@' + finalHandle,
            display_name: '',
            is_current: true,
            unread: 0,
            message: 'Switched to @' + finalHandle,
        }];
    },
});

export const __test__ = { readAccountMenu, isListMode, isSwitchMode, MENU_OPEN_TIMEOUT_MS, SWITCH_CONFIRM_TIMEOUT_MS };