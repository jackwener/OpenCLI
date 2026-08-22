import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './auth.js';

function doubanWhoami() {
    return getRegistry().get('douban/whoami');
}

function makePage({ cookies, probe }) {
    return {
        getCookies: vi.fn().mockResolvedValue(cookies),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(probe),
    };
}

describe('douban auth commands', () => {
    it('resolves identity from the /mine redirect result instead of account-settings nav hrefs', async () => {
        const page = makePage({
            cookies: [{ name: 'dbcl2', value: '"123456:session"' }, { name: 'ck', value: 'token' }],
            probe: { ok: true, user_id: '123456', name: 'Ada' },
        });

        await expect(doubanWhoami().func(page, {})).resolves.toEqual({
            logged_in: true,
            site: 'douban',
            user_id: '123456',
            name: 'Ada',
        });
        expect(page.goto).toHaveBeenCalledWith('https://www.douban.com/mine/');
    });

    it('falls back to the dbcl2 cookie uid when page links no longer expose /people/<uid>', async () => {
        const page = makePage({
            cookies: [{ name: 'dbcl2', value: '"654321:session"' }, { name: 'ck', value: 'token' }],
            probe: {
                kind: 'unknown',
                detail: 'Douban user_id parse failed: href=https://accounts.douban.com/passport/setting/ location=https://www.douban.com/',
            },
        });

        await expect(doubanWhoami().func(page, {})).resolves.toEqual({
            logged_in: true,
            site: 'douban',
            user_id: '654321',
            name: '',
        });
    });

    it('does not mistake an unrelated /people/<uid> link for the signed-in user', async () => {
        const dom = new JSDOM('<a href="/people/999999/">Recommended profile</a>', {
            url: 'https://www.douban.com/',
            runScripts: 'outside-only',
        });
        const page = makePage({
            cookies: [{ name: 'dbcl2', value: '"654321:session"' }, { name: 'ck', value: 'token' }],
            probe: null,
        });
        page.evaluate.mockImplementation((script) => dom.window.eval(script));

        await expect(doubanWhoami().func(page, {})).resolves.toEqual({
            logged_in: true,
            site: 'douban',
            user_id: '654321',
            name: '',
        });
    });

    it('rejects a stale dbcl2 cookie when /mine redirects to the login flow', async () => {
        const dom = new JSDOM('<h1>Sign in</h1>', {
            url: 'https://accounts.douban.com/passport/login',
            runScripts: 'outside-only',
        });
        const page = makePage({
            cookies: [{ name: 'dbcl2', value: '"654321:stale"' }],
            probe: null,
        });
        page.evaluate.mockImplementation((script) => dom.window.eval(script));

        await expect(doubanWhoami().func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws auth-required when Douban session cookies are missing', async () => {
        const page = makePage({ cookies: [], probe: null });

        await expect(doubanWhoami().func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
