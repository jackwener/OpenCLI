import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './auth.js';

/**
 * Page mock whose evaluate() runs the adapter's in-page script against a
 * stubbed fetch that answers /api/auth/session with the given body.
 */
function createPageMock({ session, status = 200, cookies = [] }) {
    const fetch = vi.fn(async () => ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => session,
    }));
    return {
        fetch,
        getCookies: vi.fn(async () => cookies),
        goto: vi.fn(async () => {}),
        wait: vi.fn(async () => {}),
        evaluate: vi.fn(async (script) => new Function('fetch', `return ${script}`)(fetch)),
    };
}

function command(name) {
    const cmd = getRegistry().get(`grok/${name}`);
    expect(cmd?.func).toBeTypeOf('function');
    return cmd;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('grok whoami', () => {
    it('reads the current session shape without requiring a specific cookie', async () => {
        const page = createPageMock({
            session: { status: 'authenticated', session: { userId: 'u-1', email: 'a@example.invalid', xUsername: 'grokker' } },
        });

        await expect(command('whoami').func(page)).resolves.toEqual({
            logged_in: true,
            site: 'grok',
            user_id: 'u-1',
            name: 'grokker',
        });
        expect(page.getCookies).not.toHaveBeenCalled();
    });

    it('still reads the older next-auth user shape', async () => {
        const page = createPageMock({ session: { user: { id: 'u-2', name: 'Old Shape' } } });

        await expect(command('whoami').func(page)).resolves.toMatchObject({ user_id: 'u-2', name: 'Old Shape' });
    });

    it('reports an anonymous session as AUTH_REQUIRED', async () => {
        const page = createPageMock({ session: {} });

        await expect(command('whoami').func(page)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });
});

describe('grok auth quick check', () => {
    it('accepts current session cookie hints and ignores tracking-only cookies', async () => {
        const quickCheck = command('whoami').authStatus.quickCheck;

        await expect(quickCheck(createPageMock({ cookies: [{ name: 'x-userid', value: 'u-1' }] })))
            .resolves.toMatchObject({ logged_in: true });
        await expect(quickCheck(createPageMock({ cookies: [{ name: '__cuid', value: 'anon' }, { name: 'sa-user-id', value: 'anon' }] })))
            .resolves.toMatchObject({ logged_in: false });
    });
});

describe('grok login polling', () => {
    it('does not navigate away from the sign-in page before a session cookie appears', async () => {
        vi.useFakeTimers();
        const page = createPageMock({ session: {} });
        page.wait = vi.fn(async (seconds) => { vi.advanceTimersByTime(seconds * 1000); });

        await expect(command('login').func(page, { timeout: 6 })).rejects.toMatchObject({ code: 'TIMEOUT' });

        // One goto for the initial already-logged-in probe, one for the login page.
        expect(page.goto.mock.calls.map(([url]) => url)).toEqual(['https://grok.com/', 'https://grok.com/auth/sign-in']);
        expect(page.getCookies.mock.calls.length).toBeGreaterThan(1);
    });
});
