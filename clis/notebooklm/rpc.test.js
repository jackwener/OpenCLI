import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { callNotebooklmRpc, extractNotebooklmRpcResult, getNotebooklmPageAuth } from './rpc.js';

function rpcBody(rpcId = 'wXbhsf', payload = []) {
    return `)]}'\n1\n${JSON.stringify([['wrb.fr', rpcId, JSON.stringify(payload)]])}`;
}

function makeExecutablePage({
    url = 'https://notebook.google.com/',
    responseUrl = `${new URL(url).origin}/_/LabsTailwindUi/data/batchexecute`,
    status = 200,
    ok = true,
    body = rpcBody(),
    envelope = false,
} = {}) {
    const requests = [];
    const location = new URL(url);
    const window = {
        WIZ_global_data: {
            SNlM0e: 'csrf-wiz',
            FdrFJe: 'sess-wiz',
        },
    };
    const document = {
        documentElement: { innerHTML: '<html><body>NotebookLM</body></html>' },
        readyState: 'complete',
    };
    const fetch = vi.fn(async (requestUrl, options) => {
        requests.push({ url: String(requestUrl), options });
        return {
            ok,
            status,
            url: responseUrl,
            text: async () => body,
        };
    });
    const page = {
        evaluate: vi.fn(async (script) => {
            const run = new Function('window', 'document', 'location', 'fetch', 'URL', `return (${script});`);
            const data = await run(window, document, location, fetch, URL);
            return envelope ? { session: 'site:notebooklm:test', data } : data;
        }),
        wait: vi.fn(async () => undefined),
    };
    return { page, requests };
}

describe('notebooklm rpc transport', () => {
    it.each([
        'https://notebook.google.com/?pli=1',
        'https://notebooklm.google.com/notebook/legacy-id',
    ])('extracts page tokens and the active trusted origin from %s', async (url) => {
        const { page } = makeExecutablePage({ url, envelope: true });
        await expect(getNotebooklmPageAuth(page)).resolves.toEqual({
            csrfToken: 'csrf-wiz',
            sessionId: 'sess-wiz',
            sourcePath: new URL(url).pathname,
            authuser: '',
            origin: new URL(url).origin,
        });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('typed-fails auth and malformed RPC frames', () => {
        const auth = `)]}'\n1\n${JSON.stringify([['er', null, null, null, null, 401, 'generic']])}`;
        expect(() => extractNotebooklmRpcResult(auth, 'wXbhsf')).toThrow(AuthRequiredError);
        expect(() => extractNotebooklmRpcResult(`)]}'\n1\n[]`, 'wXbhsf')).toThrowError(expect.objectContaining({ code: 'NOTEBOOKLM_RPC_SCHEMA' }));
        const malformedJson = `)]}'\n1\n${JSON.stringify([['wrb.fr', 'wXbhsf', '{bad']])}`;
        expect(() => extractNotebooklmRpcResult(malformedJson, 'wXbhsf')).toThrowError(expect.objectContaining({ code: 'NOTEBOOKLM_RPC_SCHEMA' }));
    });

    it.each([
        'https://notebook.google.com/?pli=1',
        'https://notebooklm.google.com/notebook/legacy-id',
    ])('resolves the relative RPC path against the active origin for %s', async (url) => {
        const { page, requests } = makeExecutablePage({ url, envelope: true });
        const result = await callNotebooklmRpc(page, 'wXbhsf', [null, 1, null, [2]]);
        const request = new URL(requests[0].url);
        expect(request.origin).toBe(new URL(url).origin);
        expect(request.pathname).toBe('/_/LabsTailwindUi/data/batchexecute');
        expect(request.searchParams.get('rpcids')).toBe('wXbhsf');
        expect(requests[0].options).toMatchObject({ method: 'POST', credentials: 'include' });
        expect(result.url).toBe(request.href);
    });

    it('rejects RPC redirects to another trusted origin or an off-origin endpoint', async () => {
        const trustedRedirect = makeExecutablePage({ responseUrl: 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute' });
        await expect(callNotebooklmRpc(trustedRedirect.page, 'wXbhsf', [])).rejects.toBeInstanceOf(CommandExecutionError);
        const offOrigin = makeExecutablePage({ responseUrl: 'https://evil.test/_/LabsTailwindUi/data/batchexecute' });
        await expect(callNotebooklmRpc(offOrigin.page, 'wXbhsf', [])).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('classifies a same-origin login redirect and HTTP auth as AuthRequiredError', async () => {
        const login = makeExecutablePage({ responseUrl: 'https://notebook.google.com/login?continue=x' });
        await expect(callNotebooklmRpc(login.page, 'wXbhsf', [])).rejects.toBeInstanceOf(AuthRequiredError);
        const forbidden = makeExecutablePage({ status: 403, ok: false });
        await expect(callNotebooklmRpc(forbidden.page, 'wXbhsf', [])).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('typed-fails malformed Browser Bridge transport data', async () => {
        const { page } = makeExecutablePage();
        page.evaluate
            .mockImplementationOnce(async () => ({
                html: '<html>"SNlM0e":"csrf","FdrFJe":"session"</html>',
                sourcePath: '/',
                readyState: 'complete',
                csrfToken: '',
                sessionId: '',
                authuser: '',
                url: 'https://notebook.google.com/',
            }))
            .mockResolvedValueOnce({
                session: 'site:notebooklm:test',
                data: {
                    ok: true,
                    status: 200,
                    body: rpcBody(),
                    requestUrl: 'https://notebook.google.com/_/LabsTailwindUi/data/batchexecute',
                },
            });
        await expect(callNotebooklmRpc(page, 'wXbhsf', [])).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('wraps raw bridge failures but preserves existing typed timeouts', async () => {
        const rawFailure = { evaluate: vi.fn().mockRejectedValue(new Error('bridge disconnected')) };
        await expect(getNotebooklmPageAuth(rawFailure)).rejects.toBeInstanceOf(CommandExecutionError);
        const timeout = new TimeoutError('NotebookLM bridge', 60);
        const timedOut = { evaluate: vi.fn().mockRejectedValue(timeout) };
        await expect(getNotebooklmPageAuth(timedOut)).rejects.toBe(timeout);
    });

});
