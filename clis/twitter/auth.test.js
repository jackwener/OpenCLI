import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './auth.js';

const SESSION_COOKIES = [
    { name: 'auth_token', value: 'auth' },
    { name: 'ct0', value: 'csrf' },
    { name: 'twid', value: 'u%3D1234567890' },
];

function viewerPayload(screenName, { legacy = false } = {}) {
    const result = legacy
        ? { __typename: 'User', rest_id: '1234567890', legacy: { screen_name: screenName } }
        : { __typename: 'User', rest_id: '1234567890', core: { screen_name: screenName }, legacy: {} };
    return { data: { user: { result } } };
}

/**
 * Page whose operation resolver finds nothing (so the baked UserByRestId
 * fallback is used) and whose viewer lookup answers with `lookup`. Results
 * are wrapped in the browser-bridge envelope the adapter unwraps.
 */
function createPageMock(lookup, cookies = SESSION_COOKIES) {
    return {
        getCookies: vi.fn().mockResolvedValue(cookies),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('placeholder.json')) return { session: 'site:twitter', data: null };
            if (text.includes('/UserByRestId')) return { session: 'site:twitter', data: lookup };
            throw new Error(`Unexpected evaluate: ${text.slice(0, 80)}`);
        }),
    };
}

function lookupUrl(page) {
    const call = page.evaluate.mock.calls.find(([script]) => String(script).includes('/UserByRestId'));
    return decodeURIComponent(String(call?.[0] ?? ''));
}

function whoamiCommand() {
    const command = getRegistry().get('twitter/whoami');
    expect(command?.func).toBeTypeOf('function');
    return command;
}

describe('twitter whoami command', () => {
    it('resolves the account from the twid cookie without reading the DOM', async () => {
        const page = createPageMock(viewerPayload('current_acct'));

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({
            logged_in: true,
            username: 'current_acct',
            url: 'https://x.com/current_acct',
        });
        expect(lookupUrl(page)).toContain('"userId":"1234567890"');
        expect(page.wait).not.toHaveBeenCalled();
        expect(page.sleep).not.toHaveBeenCalled();
    });

    it('accepts the legacy screen_name location', async () => {
        const page = createPageMock(viewerPayload('legacy_acct', { legacy: true }));

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({ username: 'legacy_acct' });
    });

    it('typed-fails before navigating when the session cookies are missing', async () => {
        const page = createPageMock(viewerPayload('current_acct'), [{ name: 'ct0', value: 'csrf' }]);

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('typed-fails when the twid cookie is absent or malformed', async () => {
        for (const twid of [null, 'u%3D', 'u%3Dabc', 'garbage']) {
            const cookies = SESSION_COOKIES.filter((cookie) => cookie.name !== 'twid');
            if (twid) cookies.push({ name: 'twid', value: twid });
            const page = createPageMock(viewerPayload('current_acct'), cookies);

            await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
            expect(page.evaluate.mock.calls.some(([script]) => String(script).includes('/UserByRestId'))).toBe(false);
        }
    });

    it('maps a rejected viewer lookup to AUTH_REQUIRED', async () => {
        const page = createPageMock({ error: 401 });

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('typed-fails other lookup errors instead of reporting logged out', async () => {
        const page = createPageMock({ error: 500 });

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not accept a lookup without a valid screen_name', async () => {
        for (const payload of [{ data: { user: {} } }, viewerPayload('home'), viewerPayload('not a handle')]) {
            const page = createPageMock(payload);

            await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(CommandExecutionError);
        }
    });
});

describe('twitter login command', () => {
    it('reports the account once the session cookies appear', async () => {
        const page = createPageMock(viewerPayload('polled_acct'));
        page.getCookies.mockResolvedValueOnce([]);

        const command = getRegistry().get('twitter/login');
        await expect(command.func(page, {})).resolves.toMatchObject({
            status: 'login_complete',
            username: 'polled_acct',
        });
    });
});
