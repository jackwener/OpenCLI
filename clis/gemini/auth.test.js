import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { probeGoogleAccount } from '../_shared/google-account.js';
async function verifyGeminiIdentity(page) {
    const result = await probeGoogleAccount(page, 'gemini.google.com');
    return { name: result.name };
}

function pageFor(label, href = 'https://accounts.google.com/SignOutOptions?continue=https://gemini.google.com') {
    const dom = new JSDOM('<a></a>', { url: 'https://gemini.google.com/app', runScripts: 'outside-only' });
    const anchor = dom.window.document.querySelector('a');
    anchor.setAttribute('href', href);
    anchor.setAttribute('aria-label', label);
    return {
        getCookies: vi.fn(async () => [{ name: 'SID', value: 'synthetic-session' }]),
        goto: vi.fn(async () => {}),
        wait: vi.fn(async () => {}),
        evaluate: vi.fn(async script => dom.window.eval(script)),
    };
}

describe('Gemini localized account identity', () => {
    it.each([
        'Google Account: Test User (test@example.invalid)',
        'Google 账号： Test User  \n(test@example.invalid), Google One 会员',
        'Google 帳戶：Test User（test@example.invalid）',
        'Google アカウント: Test User (test@example.invalid)',
    ])('extracts the account name from %s', async label => {
        await expect(verifyGeminiIdentity(pageFor(label))).resolves.toEqual({ name: 'Test User' });
    });

    it('does not accept a lookalike account host', async () => {
        await expect(verifyGeminiIdentity(pageFor('Google Account: Test User (test@example.invalid)', 'https://accounts.google.com.evil.invalid/SignOutOptions'))).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('reports a schema error without leaking the label or pretending the account is signed out', async () => {
        await expect(verifyGeminiIdentity(pageFor('unrecognized private account label'))).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
});
