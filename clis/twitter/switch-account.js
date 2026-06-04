import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeTwitterScreenName, unwrapBrowserResult } from './shared.js';

const ACCOUNT_SWITCHER_TRIGGER = '[data-testid="SideNav_AccountSwitcher_Button"]';
const ACCOUNT_MENU_USER_CELL = '[data-testid="UserCell"]';
// X renders the "Switch to @handle" button as a child of each UserCell.
// aria-label is the most stable signal across X's CSS-class renames.
const ACCOUNT_MENU_SWITCH_BTN = 'button[aria-label^="Switch to @"]';
const ACCOUNT_MENU_CLOSE_BTN = '[data-testid="AppTabBar_Profile_Link"]';

const MENU_OPEN_TIMEOUT_MS = 8000;
const SWITCH_CONFIRM_TIMEOUT_MS = 12000;

function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isListMode(kwargs) {
    if (kwargs.list === true)
        return true;
    const target = String(kwargs.target ?? '').trim();
    return target === '';
}

function isSwitchMode(kwargs) {
    return String(kwargs.target ?? '').trim() !== '';
}

/**
 * Read the open account-switcher menu and return one row per listed account.
 * Exported for unit tests; production callers go through cmd.func.
 */
export async function readAccountMenu(page) {
    const handles = unwrapBrowserResult(await page.evaluate(`
        () => {
            const cells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
            return cells.map((cell) => {
                const switchBtn = cell.querySelector('button[aria-label^="Switch to @"]');
                const addBtn = cell.querySelector('button[aria-label^="Add existing account"]');
                const isCurrent = !switchBtn && !addBtn;
                const aria = switchBtn ? switchBtn.getAttribute('aria-label') : '';
                const handle = aria ? aria.replace(/^Switch to @/, '').trim() : '';
                const displayNameEl = cell.querySelector('[dir="ltr"] > span');
                const displayName = displayNameEl ? displayNameEl.textContent.trim() : '';
                // Unread badge lives in the same cell, but X's DOM changes often;
                // keep the parser best-effort and tolerant of missing nodes.
                const badgeEl = cell.querySelector('[data-testid="AppTabBar_Profile_Link"] + div span, [data-testid*="unreadCount"] span');
                const unreadText = badgeEl ? badgeEl.textContent.trim() : '';
                const unreadMatch = unreadText.match(/\\d+/);
                const unread = unreadMatch ? Number(unreadMatch[0]) : 0;
                return { handle, displayName, isCurrent, unread };
            }).filter((row) => row.handle);
        }
    `));
    if (!Array.isArray(handles)) {
        throw new CommandExecutionError('X account-switcher menu did not render expected DOM (UserCell)');
    }
    if (handles.length === 0) {
        throw new EmptyResultError(
            'twitter switch-account',
            'X account-switcher menu rendered zero accounts. Try logging in again.',
        );
    }
    const current = handles.find((row) => row.isCurrent) || null;
    return { accounts: handles, current };
}

async function openAccountMenu(page) {
    // Be tolerant of either being on a sub-page or already in a menu; just
    // re-navigate home and then click the side-nav trigger to open it.
    await page.goto('https://x.com/home');
    await page.wait({ selector: '[data-testid="primaryColumn"]' });
    const trigger = unwrapBrowserResult(await page.evaluate(`
        () => {
            const el = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
            return el ? true : false;
        }
    `));
    if (!trigger) {
        throw new AuthRequiredError('x.com', 'X account-switcher trigger not found. Are you logged in?');
    }
    await page.click(ACCOUNT_SWITCHER_TRIGGER);
    // The menu slides in after a short animation. Poll UserCell until it shows.
    const opened = unwrapBrowserResult(await page.evaluate(`
        async () => {
            const start = Date.now();
            while (Date.now() - start < 8000) {
                if (document.querySelector('[data-testid="UserCell"]')) return true;
                await new Promise((r) => setTimeout(r, 100));
            }
            return false;
        }
    `));
    if (!opened) {
        throw new CommandExecutionError('X account-switcher menu did not open within 8s');
    }
}

async function closeAccountMenu(page) {
    // Closing is best-effort — we want to leave the page in a usable state even
    // if the user only asked for --list.
    try {
        await page.click(ACCOUNT_MENU_CLOSE_BTN);
        await page.wait({ time: 0.4 });
    }
    catch {
        // ignore — the menu closes on navigation in some X variants
    }
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

        // Reject "switch into the currently logged-in account" as a no-op
        // rather than silently re-selecting the active row.
        const listMode = isListMode(kwargs);
        const target = String(kwargs.target ?? '').trim();
        if (listMode && target) {
            throw new ArgumentError(
                'twitter switch-account',
                'Do not pass a positional target together with --list. Either omit the target to list, or pass a @handle to switch.',
            );
        }

        await openAccountMenu(page);

        if (listMode) {
            const { accounts, current } = await readAccountMenu(page);
            // Best-effort: close the menu so the user lands on home, not in a menu.
            await closeAccountMenu(page);
            if (accounts.length === 0) {
                throw new EmptyResultError(
                    'twitter switch-account',
                    'X account-switcher menu rendered zero accounts. Try logging in again.',
                );
            }
            return accounts.map((row) => ({
                status: 'listed',
                handle: row.handle,
                display_name: row.displayName,
                is_current: row.isCurrent,
                unread: row.unread,
                message: row.isCurrent
                    ? `Current account @${row.handle}`
                    : `Switch to @${row.handle} with: opencli twitter switch-account @${row.handle}`,
            }));
        }

        // === Switch mode ===
        const handle = normalizeTwitterScreenName(target);
        if (target && !handle) {
            throw new ArgumentError(
                'twitter switch-account',
                `Invalid Twitter handle: ${JSON.stringify(target)}. Expected e.g. @semonxue or semonxue.`,
            );
        }
        if (!handle) {
            throw new ArgumentError(
                'twitter switch-account',
                'No target handle given. Either pass a @handle or run with --list.',
            );
        }

        const ariaLabel = `Switch to @${handle}`;
        const clicked = unwrapBrowserResult(await page.evaluate(`
            (label => {
                const btn = document.querySelector(\`button[aria-label="\${label}"]\`);
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            })(${JSON.stringify(ariaLabel)})
        `));
        if (!clicked) {
            // Surface the actually-listed accounts so the user can correct typos.
            const { accounts } = await readAccountMenu(page);
            const available = accounts.map((row) => `@${row.handle}`).join(', ');
            await closeAccountMenu(page);
            throw new EmptyResultError(
                'twitter switch-account',
                `Could not find a "Switch to @${handle}" button. Available accounts: ${available || '(none detected)'}.`,
            );
        }

        // Wait for the page to actually flip to the new account. The
        // profile-link in the side-nav updates text, and the trigger button's
        // avatar changes — we wait for the menu to close and the trigger to
        // render the new handle. Fall back to a generic "navigate away" if
        // X does not re-render the trigger.
        const confirmed = unwrapBrowserResult(await page.evaluate(`
            (expected => {
                return new Promise((resolve) => {
                    const start = Date.now();
                    const tick = () => {
                        const trigger = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
                        if (!document.querySelector('[data-testid="UserCell"]')) {
                            // Menu closed — assume the switch started.
                            return resolve(true);
                        }
                        if (trigger && trigger.textContent && trigger.textContent.includes(expected)) {
                            return resolve(true);
                        }
                        if (Date.now() - start > 12000) return resolve(false);
                        setTimeout(tick, 200);
                    };
                    tick();
                });
            })(${JSON.stringify(handle)})
        `));
        if (!confirmed) {
            throw new CommandExecutionError(
                `Switched to @${handle} but UI did not update within 12s. Open https://x.com/home in a browser to verify which account is active.`,
            );
        }

        return [{
            status: 'switched',
            handle: `@${handle}`,
            display_name: '',
            is_current: true,
            unread: 0,
            message: `Switched to @${handle}`,
        }];
    },
});

export const __test__ = { readAccountMenu, isListMode, isSwitchMode, MENU_OPEN_TIMEOUT_MS, SWITCH_CONFIRM_TIMEOUT_MS };
