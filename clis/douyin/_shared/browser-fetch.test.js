import { describe, expect, it, vi } from 'vitest';
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
    it('throws when status_code is non-zero', async () => {
        const page = makePage({ status_code: 8, message: 'fail' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Douyin API error 8');
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
    it('wraps browser-side fetch or JSON parse failures', async () => {
        const page = makePage(null);
        page.evaluate.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'));
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test')).rejects.toThrow('Douyin API request failed: Unexpected token < in JSON');
    });
});
