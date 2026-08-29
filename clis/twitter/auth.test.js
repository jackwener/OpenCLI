import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './auth.js';

const SESSION_COOKIES = [{ name: 'auth_token' }, { name: 'ct0' }];

/**
 * Build a page whose profile link returns the given hrefs in order, so a read
 * that lands before the home surface settles is distinguishable from a settled
 * one. Hrefs are wrapped in the browser-bridge envelope the adapter unwraps.
 */
function createPageMock(hrefs, cookies = SESSION_COOKIES) {
    let index = 0;
    return {
        getCookies: vi.fn().mockResolvedValue(cookies),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => {
            if (!String(script).includes('AppTabBar_Profile_Link')) return Promise.resolve(undefined);
            const href = hrefs[Math.min(index, hrefs.length - 1)];
            index += 1;
            return Promise.resolve({ session: 'site:twitter', data: href });
        }),
    };
}

function whoamiCommand() {
    const command = getRegistry().get('twitter/whoami');
    expect(command?.func).toBeTypeOf('function');
    return command;
}

describe('twitter whoami command', () => {
    it('waits out a page that still shows the previous account', async () => {
        const page = createPageMock(['/old_acct', '/old_acct', '/old_acct', '/old_acct', '/new_acct', '/new_acct', '/new_acct', '/new_acct']);

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({
            logged_in: true,
            username: 'new_acct',
            url: 'https://x.com/new_acct',
        });
    });

    it('waits the full settle window before trusting a steady handle', async () => {
        const page = createPageMock(['/steady_acct']);

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({ username: 'steady_acct' });
        expect(page.evaluate).toHaveBeenCalledTimes(8);
        expect(page.sleep).toHaveBeenCalledTimes(7);
    });

    it('accepts a link that only appears after several polls', async () => {
        const page = createPageMock([null, null, '/late_acct', '/late_acct', '/late_acct', '/late_acct', '/late_acct', '/late_acct']);

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({ username: 'late_acct' });
    });

    it('accepts a new account after an old value clears during the settle window', async () => {
        const page = createPageMock(['/old_acct', '/old_acct', null, '/new_acct', '/new_acct', '/new_acct', '/new_acct', '/new_acct']);

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({ username: 'new_acct' });
    });

    it('does not trust a transient new account that reverts before the window ends', async () => {
        const page = createPageMock(['/old_acct', '/new_acct', '/new_acct', '/old_acct', '/old_acct', '/old_acct', '/old_acct', '/old_acct']);

        await expect(whoamiCommand().func(page)).resolves.toMatchObject({ username: 'old_acct' });
    });

    it('typed-fails instead of returning an unconfirmed account', async () => {
        const flapping = ['/aaa', '/bbb', '/aaa', '/bbb', '/aaa', '/bbb', '/aaa', '/bbb'];
        const page = createPageMock(flapping);

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.evaluate).toHaveBeenCalledTimes(8);
    });

    it('typed-fails when the profile link never appears', async () => {
        const page = createPageMock([null]);

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('typed-fails malformed Browser Bridge profile-link envelopes', async () => {
        const page = createPageMock([]);
        page.evaluate.mockResolvedValue({ session: { id: 'site:twitter' }, data: '/current_acct' });

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not accept non-profile paths as identity evidence', async () => {
        const page = createPageMock(['/home', '/i/bookmarks', '/current_acct/status/123', 'https://evil.example/current_acct']);

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('typed-fails before navigating when the session cookies are missing', async () => {
        const page = createPageMock(['/current_acct'], [{ name: 'ct0' }]);

        await expect(whoamiCommand().func(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('waits for the home surface the sibling readers wait for', async () => {
        const page = createPageMock(['/steady_acct']);

        await whoamiCommand().func(page);

        expect(page.wait).toHaveBeenCalledWith({ selector: '[data-testid="primaryColumn"]' });
    });
});

describe('twitter login command', () => {
    it('keeps each poll to a single profile-link read', async () => {
        const page = createPageMock(['/polled_acct']);
        page.getCookies.mockResolvedValueOnce([]);

        const command = getRegistry().get('twitter/login');
        await expect(command.func(page, {})).resolves.toMatchObject({
            status: 'login_complete',
            username: 'polled_acct',
        });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });
});
