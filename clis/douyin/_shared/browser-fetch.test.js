import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { browserFetch, DouyinRequestError } from './browser-fetch.js';
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
function makeScriptPage(body, { ok = true, status = 200, envelope = false, fetchError, hang = false } = {}) {
    const page = makePage(null);
    page.evaluate = vi.fn(async (script) => {
        const stubFetch = async (_url, requestOptions) => {
            if (fetchError) throw new Error(fetchError);
            if (hang) {
                return new Promise((_, reject) => {
                    requestOptions.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true });
                });
            }
            return { ok, status, text: async () => body };
        };
        const value = await new Function('fetch', `return (${script});`)(stubFetch);
        return envelope ? { session: 'site:douyin:test', data: value } : value;
    });
    return page;
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
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_API_ERROR', apiCode: 8 });
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
    it('reports an empty body as an empty response, not a parse failure', async () => {
        const page = makeScriptPage('');
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EMPTY_RESPONSE' });
    });
    it('treats a whitespace-only body the same way', async () => {
        const page = makeScriptPage('  \n  ');
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EMPTY_RESPONSE' });
    });
    it('reports an empty body through a Browser Bridge {session,data} envelope', async () => {
        const page = makeScriptPage('', { envelope: true });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EMPTY_RESPONSE' });
    });
    it('still reports a non-JSON body as a parse failure', async () => {
        const page = makeScriptPage('<html>gateway</html>');
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_PARSE_ERROR', apiCode: -2 });
    });
    it('parses a JSON body from the generated script', async () => {
        const page = makeScriptPage('{"status_code":0,"challenge_list":[]}');
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .resolves.toEqual({ status_code: 0, challenge_list: [] });
    });
    it('keeps the auth classification when an empty body comes with 403', async () => {
        const page = makeScriptPage('', { ok: false, status: 403 });
        const error = await browserFetch(page, 'GET', 'https://creator.douyin.com/api/test').catch((caught) => caught);
        expect(error).toBeInstanceOf(AuthRequiredError);
        expect(error).toMatchObject({ httpStatus: 403 });
    });
    it('keeps the status when an empty body comes with 404', async () => {
        const page = makeScriptPage('', { ok: false, status: 404 });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_HTTP_ERROR', httpStatus: 404 });
    });
    it('uses the HTTP status when a non-2xx response has a successful API body', async () => {
        const page = makeScriptPage('{"status_code":0,"data":{"ok":true}}', { ok: false, status: 404 });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({
                code: 'COMMAND_EXEC',
                errorCode: 'DOUYIN_HTTP_ERROR',
                httpStatus: 404,
                apiCode: 0,
            });
    });
    it('does not treat an API 404 as an HTTP 404', async () => {
        const page = makePage({ status_code: 404, status_msg: 'business record not found' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({
                code: 'COMMAND_EXEC',
                errorCode: 'DOUYIN_API_ERROR',
                apiCode: 404,
            });
    });
    it('throws on empty response body (null from evaluate)', async () => {
        const page = makePage(null);
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EMPTY_RESPONSE' });
    });
    it('throws on undefined response body', async () => {
        const page = makePage(undefined);
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EMPTY_RESPONSE' });
    });
    it('throws typed on malformed primitive response body', async () => {
        const page = makePage('not-json-object');
        const error = await browserFetch(page, 'GET', 'https://creator.douyin.com/api/test').catch((caught) => caught);
        expect(error).toBeInstanceOf(DouyinRequestError);
        expect(error).toBeInstanceOf(CommandExecutionError);
        expect(error).toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_MALFORMED_RESPONSE' });
    });
    it('throws typed when browser fetch returns a non-JSON body', async () => {
        const page = makePage({ status_code: -2, status_msg: 'JSON parse failed: <html>not-json</html>' });
        await expect(browserFetch(page, 'GET', 'https://creator.douyin.com/api/test'))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_PARSE_ERROR', apiCode: -2 });
    });
    it('wraps evaluator failures with a stable error code', async () => {
        const page = makePage(null);
        page.evaluate.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'));
        const error = await browserFetch(page, 'GET', 'https://creator.douyin.com/api/test').catch((caught) => caught);
        expect(error).toMatchObject({ code: 'COMMAND_EXEC', errorCode: 'DOUYIN_EVALUATE_ERROR' });
        expect(error.message).toBe('Douyin API request failed (GET https://creator.douyin.com/api/test): Unexpected token < in JSON');
    });
    it('preserves the fast-detect phase on transient request errors', async () => {
        const page = makeScriptPage('');
        await expect(browserFetch(page, 'POST', 'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/pre_check', {
            phase: 'fast_detect/pre_check',
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            errorCode: 'DOUYIN_EMPTY_RESPONSE',
            phase: 'fast_detect/pre_check',
        });
    });
    it('classifies network failures without inspecting their message', async () => {
        const page = makeScriptPage('', { fetchError: 'transport wording changed' });
        await expect(browserFetch(page, 'POST', 'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/poll', {
            phase: 'fast_detect/poll',
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            errorCode: 'DOUYIN_NETWORK_ERROR',
            phase: 'fast_detect/poll',
        });
    });
    it('classifies an aborted request as a timeout', async () => {
        const page = makeScriptPage('', { hang: true });
        await expect(browserFetch(page, 'POST', 'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/poll', {
            timeoutMs: 1,
            phase: 'fast_detect/poll',
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            errorCode: 'DOUYIN_TIMEOUT',
            phase: 'fast_detect/poll',
        });
    });
});
