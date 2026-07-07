import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__ } from './auth.js';

function makePage({ cookies = [], evalResults = [] } = {}) {
    let i = 0;
    return {
        getCookies: vi.fn().mockResolvedValue(cookies),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(() => Promise.resolve(evalResults[i++])),
    };
}

describe('chatgpt auth', () => {
    it('recognizes chunked NextAuth session cookies (.0 / .1)', async () => {
        const page = makePage({ cookies: [{ name: '__Secure-next-auth.session-token.0', value: 'x' }] });
        expect(await __test__.hasChatgptSessionCookie(page)).toBe(true);
    });

    it('still recognizes the legacy unchunked cookie', async () => {
        const page = makePage({ cookies: [{ name: '__Secure-next-auth.session-token', value: 'x' }] });
        expect(await __test__.hasChatgptSessionCookie(page)).toBe(true);
    });

    it('does not treat a non-session cookie as logged in', async () => {
        const page = makePage({ cookies: [{ name: 'oai-did', value: 'x' }] });
        expect(await __test__.hasChatgptSessionCookie(page)).toBe(false);
    });

    it('probes the authoritative /api/auth/session endpoint', () => {
        expect(__test__.buildChatgptIdentityProbe()).toContain('/api/auth/session');
    });

    it('verifies identity via the session endpoint without gating on the legacy cookie', async () => {
        // No session cookie at all, yet the endpoint reports a logged-in user:
        // the fix must NOT pre-reject with AUTH_REQUIRED (#2087).
        const page = makePage({ cookies: [], evalResults: [{ ok: true, user_id: 'u-123', name: 'Ada' }] });
        const result = await __test__.verifyChatgptIdentity(page);
        expect(result).toEqual({ user_id: 'u-123', name: 'Ada' });
        expect(page.goto).toHaveBeenCalledWith('https://chatgpt.com/');
    });

    it('maps an anonymous session to AuthRequiredError', async () => {
        const page = makePage({ evalResults: [{ kind: 'auth', detail: 'anonymous' }] });
        await expect(__test__.verifyChatgptIdentity(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps a non-ok probe response to CommandExecutionError', async () => {
        const page = makePage({ evalResults: [{ kind: 'http', httpStatus: 500 }] });
        await expect(__test__.verifyChatgptIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps an exception-kind probe response to CommandExecutionError', async () => {
        const page = makePage({ evalResults: [{ kind: 'exception', detail: 'boom' }] });
        await expect(__test__.verifyChatgptIdentity(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('unwraps Browser Bridge evaluate envelopes', () => {
        const payload = { ok: true, user_id: 'u', name: 'n' };
        expect(__test__.unwrapEvaluateResult({ session: 'site:chatgpt', data: payload })).toBe(payload);
    });
});
