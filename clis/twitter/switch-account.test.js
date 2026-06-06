import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './switch-account.js';
import './switch-account.js';

const SAMPLE_MENU = [
    { handle: 'semonxue', display_name: 'Semon Xue', is_current: true, unread: 12 },
    { handle: '2nd_ai50196', display_name: '2nd AI', is_current: false, unread: 0 },
    { handle: 'news_bot', display_name: 'News Bot', is_current: false, unread: 3 },
];

function createPageMock(evaluateImpl) {
    const evaluate = vi.fn();
    evaluate.mockImplementation(async (js) => evaluateImpl(String(js)));
    const goto = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    return { goto, wait, click, evaluate };
}

// ---------------------------------------------------------------------------
// argument routing — pure unit tests, no browser involvement
// ---------------------------------------------------------------------------
describe('twitter switch-account — argument routing', () => {
    it('no target defaults to list mode', () => {
        expect(__test__.isListMode({ list: false, target: '' })).toBe(true);
        expect(__test__.isListMode({ list: false, target: undefined })).toBe(true);
    });

    it('--list overrides a non-empty target (validation happens later)', () => {
        expect(__test__.isListMode({ list: true, target: 'someone' })).toBe(true);
    });

    it('any non-empty target is switch mode', () => {
        expect(__test__.isSwitchMode({ list: false, target: '@semonxue' })).toBe(true);
        expect(__test__.isSwitchMode({ list: false, target: 'semonxue' })).toBe(true);
        expect(__test__.isSwitchMode({ list: false, target: '' })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// readAccountMenu — pure unit tests
// ---------------------------------------------------------------------------
describe('twitter switch-account — readAccountMenu', () => {
    it('parses all UserCell rows, marking the one without a Switch button as current', async () => {
        const page = createPageMock((code) => {
            if (code.includes('UserAvatar-Container-')) {
                // readAccountMenu returns { accounts: [...] } (full list, current has isCurrent: true)
                return { accounts: SAMPLE_MENU, currentHandle: 'semonxue' };
            }
            throw new Error(`Unhandled evaluate in readAccountMenu test: ${code.slice(0, 80)}`);
        });
        const out = await __test__.readAccountMenu(page);
        // readAccountMenu returns { accounts } — find current by isCurrent flag
        const current = out.accounts.find((r) => r.is_current);
        expect(current).toMatchObject({ handle: 'semonxue', display_name: 'Semon Xue', is_current: true });
        expect(out.accounts).toHaveLength(3);
        expect(out.accounts.find((r) => r.handle === '2nd_ai50196').is_current).toBe(false);
    });

    it('throws EmptyResultError when the menu rendered zero accounts', async () => {
        const page = createPageMock((code) => {
            if (code.includes('UserAvatar-Container-')) {
                // Return empty accounts → readAccountMenu throws EmptyResultError
                return { accounts: [], currentHandle: '' };
            }
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        await expect(__test__.readAccountMenu(page)).rejects.toBeInstanceOf(EmptyResultError);
    });
});

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------
describe('twitter switch-account — registration', () => {
    it('is registered as a write command with the correct columns', () => {
        const cmd = getRegistry().get('twitter/switch-account');
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('write');
        expect(cmd.columns).toEqual(['status', 'handle', 'display_name', 'is_current', 'unread', 'message']);
    });
});

// ---------------------------------------------------------------------------
// CLI functional tests — --list mode
// ---------------------------------------------------------------------------
describe('twitter switch-account — --list mode', () => {
    function listPageMock() {
        return createPageMock((code) => {
            // Check if trigger exists (async evaluate checks trigger)
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            // Check menu is open (has UserCell)
            if (code.includes('UserCell') && code.includes('return true')) return true;
            // Main evaluate: list mode returns the accounts array directly
            // (no wrapper). readAccountMenu returns { accounts, currentHandle }.
            if (code.includes('doList')) return SAMPLE_MENU;
            if (code.includes('UserAvatar-Container-')) {
                return { accounts: SAMPLE_MENU, currentHandle: 'semonxue' };
            }
            // Close menu (AppTabBar click)
            if (code.includes('AppTabBar_Profile_Link') && code.includes('click()')) return undefined;
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
    }

    it('opens menu, reads accounts, closes menu, returns 3 rows', async () => {
        const page = listPageMock();
        const cmd = getRegistry().get('twitter/switch-account');
        const rows = await cmd.func(page, { list: true, target: '' });
        expect(rows).toHaveLength(3);
        // Verify rows have expected structure
        expect(rows[0]).toHaveProperty('handle');
        expect(rows[0]).toHaveProperty('status');
        expect(rows[0]).toHaveProperty('is_current');
        expect(rows[0]).toHaveProperty('message');
    });

    it('marks the current account and shows its full message', async () => {
        const page = listPageMock();
        const cmd = getRegistry().get('twitter/switch-account');
        const rows = await cmd.func(page, { list: true, target: '' });
        const current = rows.find((r) => r.handle === 'semonxue');
        expect(current.is_current).toBe(true);
        expect(current.message).toContain('Current account @semonxue');
    });

    it('shows the switch command hint for non-current accounts', async () => {
        const page = listPageMock();
        const cmd = getRegistry().get('twitter/switch-account');
        const rows = await cmd.func(page, { list: true, target: '' });
        const row = rows.find((r) => r.handle === '2nd_ai50196');
        expect(row.message).toContain('opencli twitter switch-account @2nd_ai50196');
    });

    it('rejects --list with a positional target', async () => {
        const page = listPageMock();
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: true, target: '@semonxue' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('returns empty array when the menu is empty (verify empty list path)', async () => {
        const page = createPageMock((code) => {
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            if (code.includes('UserCell') && code.includes('return true')) return true;
            // List mode returns the accounts array directly. Empty menu → [].
            if (code.includes('doList')) return [];
            if (code.includes('UserAvatar-Container-')) {
                return { accounts: [], currentHandle: '' };
            }
            if (code.includes('AppTabBar_Profile_Link') && code.includes('click()')) return undefined;
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        // Empty accounts → empty rows array (mode 'list' with no accounts returns [])
        const rows = await cmd.func(page, { list: true, target: '' });
        expect(rows).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// CLI functional tests — switch mode
// ---------------------------------------------------------------------------
describe('twitter switch-account — switch mode', () => {
    function switchPageMock(evaluateImpl) {
        return createPageMock((code) => {
            // Check trigger exists
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            // Check menu open
            if (code.includes('UserCell') && code.includes('return true')) return true;
            // Read accounts: list mode returns array directly, readAccountMenu
            // returns { accounts, currentHandle }.
            if (code.includes('doList')) return SAMPLE_MENU;
            if (code.includes('UserAvatar-Container-')) {
                return { accounts: SAMPLE_MENU, currentHandle: 'semonxue' };
            }
            // Close menu
            if (code.includes('AppTabBar_Profile_Link') && code.includes('click()')) return undefined;
            // Let the specific test handle switch/confirmation logic
            return evaluateImpl(code);
        });
    }

    it('raises AuthRequiredError when the side-nav trigger is absent', async () => {
        const page = createPageMock((code) => {
            // Main evaluate: AUTH_REQUIRED (trigger always missing in this test)
            if (code.includes('doList') || code.includes('UserAvatar-Container-')) {
                return { error: 'AUTH_REQUIRED', message: 'Account-switcher trigger not found. Are you logged in?' };
            }
            // Trigger check (happens first in evaluate code) → also returns false
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return false;
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: false, target: '@semonxue' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rejects a malformed handle', async () => {
        // normalizeTwitterScreenName('!!!') returns '' → ARGUMENT error
        const page = createPageMock((code) => {
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            if (code.includes('UserCell') && code.includes('return true')) return true;
            throw new Error('should not be reached for malformed handle validation');
        });
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: false, target: '!!!' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('returns already_current when target matches the current account', async () => {
        const page = createPageMock((code) => {
            // Match the already_current return site, not the bare "doList" declaration
            // (every page.evaluate string contains `const doList = ...`).
            if (code.includes("status: 'already_current'")) {
                return { ok: true, status: 'already_current', handle: 'semonxue' };
            }
            if (code.includes('UserAvatar-Container-')) {
                return { accounts: SAMPLE_MENU, currentHandle: 'semonxue' };
            }
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        const rows = await cmd.func(page, { list: false, target: '@semonxue' });
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('already_current');
        expect(rows[0].handle).toBe('@semonxue');
        expect(rows[0].is_current).toBe(true);
        expect(rows[0].message).toBe('@semonxue is already the current account.');
    });

    it('raises EmptyResultError with available list when the target button is not found', async () => {
        const page = createPageMock((code) => {
            // Trigger check
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            // Menu open check
            if (code.includes('UserCell') && code.includes('return true')) return true;
            // Match the NOT_FOUND return site precisely (the message is unique to that path)
            if (code.includes('Could not find "Switch to @')) {
                return {
                    error: 'NOT_FOUND',
                    message: 'Could not find "Switch to @missing" button. Menu UserCells: ... . Available: @semonxue, @ai__cream, @2nd_ai50196',
                };
            }
            if (code.includes('UserAvatar-Container-')) {
                return { accounts: SAMPLE_MENU, currentHandle: 'semonxue' };
            }
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        try {
            await cmd.func(page, { list: false, target: '@missing' });
            throw new Error('expected EmptyResultError');
        }
        catch (err) {
            expect(err).toBeInstanceOf(EmptyResultError);
            expect(err.message).toContain('returned no data');
            // Detailed message goes into the hint field of EmptyResultError.
            expect(err.hint).toContain('@missing');
            expect(err.hint).toContain('semonxue');
        }
    });
});
