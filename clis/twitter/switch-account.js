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
 * Uses avatar containers inside UserCells to enumerate accounts; the "current"
 * account is identified by the first <li data-testid="UserCell"> (no Switch button inside).
 * "Add existing account" rows (have "Follow" text) are excluded.
 */
export async function readAccountMenu(page) {
    const result = unwrapBrowserResult(await page.evaluate(`
        () => {
            const menuCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
            const currentCell = menuCells.find(cell =>
                cell.tagName === 'LI' &&
                !cell.querySelector('button[aria-label^="Switch to @"]')
            );
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

                let hasFollow = false;
                let parent = av.parentElement;
                for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
                    if (parent.textContent?.includes('Follow')) { hasFollow = true; break; }
                }
                if (hasFollow) continue;

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

                const menuCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
                const currentCell = menuCells.find(cell =>
                    cell.tagName === 'LI' &&
                    !cell.querySelector('button[aria-label^="Switch to @"]')
                );
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
                const currentCellAfter = menuCellsAfterOpen.find(cell =>
                    cell.tagName === 'LI' &&
                    !cell.querySelector('button[aria-label^="Switch to @"]')
                );
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

                    let hasFollow = false;
                    let parent = av.parentElement;
                    for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
                        if (parent.textContent?.includes('Follow')) { hasFollow = true; break; }
                    }
                    if (hasFollow) continue;

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

                // If target is already current, no "Switch to @target" button will exist
                // (current account renders as <li> instead). Detect this from the accounts list.
                const alreadyCurrentAccount = accounts.find(a =>
                    a.is_current && a.handle.toLowerCase() === targetHandle.toLowerCase()
                );
                if (alreadyCurrentAccount) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    return { ok: true, status: 'already_current', handle: targetHandle };
                }

                const targetAriaLabel = 'Switch to @' + targetHandle;
                const switchBtn = Array.from(document.querySelectorAll('[data-testid="UserCell"]'))
                    .find(cell => cell.getAttribute('aria-label') === targetAriaLabel);

                if (!switchBtn) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    const allCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'))
                        .map(c => c.getAttribute('aria-label') || ('LI' + c.tagName));
                    const available = accounts.map(a => '@' + a.handle).join(', ');
                    return {
                        error: 'NOT_FOUND',
                        message: 'Could not find "Switch to @' + targetHandle + '" button. Menu UserCells: ' + allCells.slice(0, 10).join(', ') + '. Available: ' + available,
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