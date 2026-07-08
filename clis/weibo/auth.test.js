import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__ } from './auth.js';

function makePage({ cookies = [{ name: 'SUB' }, { name: 'SUBP' }], evalResults = [] } = {}) {
    let i = 0;
    return {
        getCookies: vi.fn().mockResolvedValue(cookies),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(() => Promise.resolve(evalResults[i++])),
    };
}

describe('weibo auth identity probe', () => {
    it('probes /ajax/profile/info with the resolved uid (not the bare 400-prone endpoint)', () => {
        const script = __test__.buildWeiboIdentityProbe('12345');
        expect(script).toContain('/ajax/profile/info?uid=12345');
        // the uid-less form is what returns HTTP 400 — it must be gone
        expect(script).not.toContain("fetch('/ajax/profile/info'");
    });

    it('url-encodes the uid', () => {
        expect(__test__.buildWeiboIdentityProbe('a b')).toContain('/ajax/profile/info?uid=a%20b');
    });

    it('resolves the logged-in identity via uid before probing', async () => {
        const page = makePage({
            evalResults: [
                '12345', // getSelfUid → current uid
                { ok: true, user_id: '12345', screen_name: 'Alice', profile_url: '/u/12345' }, // probe
            ],
        });
        const result = await __test__.verifyWeiboIdentity(page);
        expect(result).toEqual({ user_id: '12345', screen_name: 'Alice', profile_url: '/u/12345' });
        // the second evaluate is the identity probe, carrying the resolved uid
        expect(page.evaluate.mock.calls[1][0]).toContain('/ajax/profile/info?uid=12345');
    });

    it('unwraps Browser Bridge envelopes from uid and profile probes', async () => {
        const page = makePage({
            evalResults: [
                { session: 's1', data: '12345' },
                { session: 's1', data: { ok: true, user_id: '12345', screen_name: 'Alice', profile_url: '/u/12345' } },
            ],
        });
        await expect(__test__.verifyWeiboIdentity(page)).resolves.toEqual({
            user_id: '12345',
            screen_name: 'Alice',
            profile_url: '/u/12345',
        });
        expect(page.evaluate.mock.calls[1][0]).toContain('/ajax/profile/info?uid=12345');
    });

    it('typed-fails malformed uid payloads instead of probing /ajax/profile/info with garbage', async () => {
        const page = makePage({ evalResults: [{ uid: '12345' }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('typed-fails malformed probe payloads', async () => {
        const page = makePage({ evalResults: ['12345', null] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws AuthRequiredError when SUB/SUBP cookies are missing, before navigating', async () => {
        const page = makePage({ cookies: [{ name: 'SUB' }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequiredError when the logged-in uid cannot be resolved', async () => {
        const page = makePage({ evalResults: [null, null] }); // getSelfUid store + config both empty
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps a non-ok probe response to CommandExecutionError', async () => {
        const page = makePage({ evalResults: ['12345', { kind: 'http', httpStatus: 400 }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps an auth-kind probe response to AuthRequiredError', async () => {
        const page = makePage({ evalResults: ['12345', { kind: 'auth', detail: 'anonymous' }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps an exception-kind probe response to CommandExecutionError', async () => {
        const page = makePage({ evalResults: ['12345', { kind: 'exception', detail: 'boom' }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails success-shaped probes missing user_id', async () => {
        const page = makePage({ evalResults: ['12345', { ok: true, screen_name: 'Alice', profile_url: '/u/12345' }] });
        await expect(__test__.verifyWeiboIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
