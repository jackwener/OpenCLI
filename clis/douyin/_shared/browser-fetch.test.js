import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { browserFetch } from './browser-fetch.js';
function makePage(result) {
    return {
        goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result),
        getCookies: vi.fn(), snapshot: vi.fn(), click: vi.fn(),
        typeText: vi.fn(), pressKey: vi.fn(), scrollTo: vi.fn(),
        getFormState: vi.fn(), wait: vi.fn(), tabs: vi.fn(),
        networkRequests: vi.fn(), consoleMessages: vi.fn(),
        scroll: vi.fn(), autoScroll: vi.fn(),
        installInterceptor: vi.fn(), getInterceptedRequests: vi.fn(),
        screenshot: vi.fn(),
    };
}
describe('browserFetch', () => {
    it('returns parsed JSON on success', async () => {
        const page = makePage({ status_code: 0, data: { ak: 'KEY' } });
        const result = await browserFetch(page, 'GET', 'https://creator.douyin.com/api/test');
        expect(result).toEqual({ status_code: 0, data: { ak: 'KEY' } });
    });
    it('unwraps Browser Bridge {session,data} envelopes', async () => {
        const page = makePage({ session: 'site:douyin:test', data: { status_code: 0, data: { ok: true } } });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .resolves.toEqual({ status_code: 0, data: { ok: true } });
    });
    it('throws when status_code is non-zero', async () => {
        const page = makePage({ status_code: 8, message: 'fail' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Douyin API error 8');
    });
    it('maps auth-like API errors to AuthRequiredError', async () => {
        const page = makePage({ status_code: 401, status_msg: 'login required' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('returns result even when no status_code field', async () => {
        const page = makePage({ some_field: 'value' });
        const result = await browserFetch(page, 'GET', 'https://creator.douyin.com/api/test');
        expect(result).toEqual({ some_field: 'value' });
    });
    it('throws on empty response body (null from evaluate)', async () => {
        const page = makePage(null);
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Empty response from Douyin API');
    });
    it('throws on undefined response body', async () => {
        const page = makePage(undefined);
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Empty response from Douyin API');
    });
    it('throws typed on malformed primitive response body', async () => {
        const page = makePage('not-json-object');
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws typed when browser fetch returns a non-JSON body', async () => {
        const page = makePage({ status_code: -2, status_msg: 'JSON parse failed: <html>not-json</html>' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toThrow('Douyin API error -2');
    });
    it('wraps browser-side fetch or JSON parse failures', async () => {
        const page = makePage(null);
        page.evaluate.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'));
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Douyin API request failed (GET https://creator.douyin.com/api/test): Unexpected token < in JSON');
    });
});
