import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './switch-account.js';
import './switch-account.js';

const SAMPLE_MENU = [
    { handle: 'semonxue', displayName: 'Semon Xue', isCurrent: true, unread: 12 },
    { handle: '2nd_ai50196', displayName: '2nd AI', isCurrent: false, unread: 0 },
    { handle: 'news_bot', displayName: 'News Bot', isCurrent: false, unread: 3 },
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
            if (code.includes('UserCell') && code.includes('cells.map')) return SAMPLE_MENU;
            throw new Error(`Unhandled evaluate in readAccountMenu test: ${code.slice(0, 80)}`);
        });
        const out = await __test__.readAccountMenu(page);
        expect(out.current).toEqual({ handle: 'semonxue', displayName: 'Semon Xue', isCurrent: true, unread: 12 });
        expect(out.accounts).toHaveLength(3);
        expect(out.accounts.find((r) => r.handle === '2nd_ai50196').isCurrent).toBe(false);
    });

    it('throws EmptyResultError when the menu rendered zero accounts', async () => {
        const page = createPageMock((code) => {
            if (code.includes('UserCell') && code.includes('cells.map')) return [];
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
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            if (code.includes('UserCell') && code.includes('return true')) return true;
            if (code.includes('UserCell') && code.includes('cells.map')) return SAMPLE_MENU;
            if (code.includes('AppTabBar_Profile_Link') && code.includes('click()')) return undefined;
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
    }

    it('opens menu, reads accounts, closes menu, returns 3 rows', async () => {
        const click = vi.fn().mockResolvedValue(undefined);
        const page = { ...listPageMock(), click };
        const cmd = getRegistry().get('twitter/switch-account');
        const rows = await cmd.func(page, { list: true, target: '' });
        expect(click).toHaveBeenCalledWith('[data-testid="SideNav_AccountSwitcher_Button"]');
        expect(click).toHaveBeenCalledWith('[data-testid="AppTabBar_Profile_Link"]');
        expect(rows).toHaveLength(3);
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

    it('throws EmptyResultError when the menu is empty', async () => {
        const page = createPageMock((code) => {
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            if (code.includes('UserCell') && code.includes('return true')) return true;
            if (code.includes('UserCell') && code.includes('cells.map')) return [];
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: true, target: '' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

// ---------------------------------------------------------------------------
// CLI functional tests — switch mode
// ---------------------------------------------------------------------------
describe('twitter switch-account — switch mode', () => {
    function switchPageMock(evaluateImpl) {
        return createPageMock((code) => {
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return true;
            if (code.includes('UserCell') && code.includes('return true')) return true;
            if (code.includes('UserCell') && code.includes('cells.map')) return SAMPLE_MENU;
            if (code.includes('AppTabBar_Profile_Link') && code.includes('click()')) return undefined;
            // Catch-all: let the test-specific impl handle switch / confirm evaluate calls.
            return evaluateImpl(code);
        });
    }

    it('raises AuthRequiredError when the side-nav trigger is absent', async () => {
        const page = createPageMock((code) => {
            if (code.includes('SideNav_AccountSwitcher_Button') && code.includes('return el ? true : false')) return false;
            throw new Error(`Unhandled evaluate: ${code.slice(0, 80)}`);
        });
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: false, target: '@semonxue' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rejects a malformed handle', async () => {
        const page = switchPageMock(() => { throw new Error('should not be reached'); });
        const cmd = getRegistry().get('twitter/switch-account');
        await expect(cmd.func(page, { list: false, target: '!!!' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('raises EmptyResultError with available list when the target button is not found', async () => {
        const page = switchPageMock((code) => {
            if (code.includes('`button[aria-label=') && code.includes('Switch to @')) return false;
            if (code.includes('querySelector') && code.includes('aria-label')) return true;
            if (code.includes('expected =>')) return true;
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
            // The available list goes into the hint field.
            expect(err.hint).toContain('@missing');
            expect(err.hint).toContain('semonxue');
        }
    });
});