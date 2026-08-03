import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, parseTrustedNotebooklmUrl } from './shared.js';

const NOTEBOOKLM_RPC_PATH = '/_/LabsTailwindUi/data/batchexecute';

function requireNotebooklmObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`NotebookLM ${label} returned a malformed Browser Bridge payload`);
    }
    return value;
}

function rethrowNotebooklmTransport(error, label) {
    if (error instanceof CliError)
        throw error;
    throw new CommandExecutionError(`NotebookLM ${label} failed: ${error?.message || error}`);
}

export function unwrapNotebooklmEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function extractNotebooklmPageAuthFromHtml(html, sourcePath = '/', preferredTokens) {
    const csrfMatch = html.match(/"SNlM0e":"([^"]+)"/);
    const sessionMatch = html.match(/"FdrFJe":"([^"]+)"/);
    const csrfToken = preferredTokens?.csrfToken?.trim() || (csrfMatch ? csrfMatch[1] : '');
    const sessionId = preferredTokens?.sessionId?.trim() || (sessionMatch ? sessionMatch[1] : '');
    if (!csrfToken || !sessionId) {
        throw new CliError('NOTEBOOKLM_TOKENS', 'NotebookLM page tokens were not found in the current page HTML', 'Open the NotebookLM notebook page in Chrome, wait for it to finish loading, then retry with --verbose if it still fails.');
    }
    return { csrfToken, sessionId, sourcePath: sourcePath || '/', authuser: preferredTokens?.authuser ?? '' };
}
async function probeNotebooklmPageAuth(page) {
    let evaluated;
    try {
        evaluated = await page.evaluate(`(() => {
    const wiz = window.WIZ_global_data || {};
    const html = document.documentElement.innerHTML;
    const authMatch = (location.search || '').match(/[?&]authuser=(\\d+)/);
    const pathMatch = (location.pathname || '').match(/^\\/u\\/(\\d+)\\//);
    return {
      html,
      sourcePath: location.pathname || '/',
      readyState: document.readyState || '',
      csrfToken: typeof wiz.SNlM0e === 'string' ? wiz.SNlM0e : '',
      sessionId: typeof wiz.FdrFJe === 'string' ? wiz.FdrFJe : '',
      authuser: authMatch ? authMatch[1] : (pathMatch ? pathMatch[1] : ''),
      url: location.href,
    };
  })()`);
    }
    catch (error) {
        rethrowNotebooklmTransport(error, 'page auth probe');
    }
    const raw = requireNotebooklmObject(unwrapNotebooklmEvaluateResult(evaluated), 'page auth probe');
    const pageUrl = parseTrustedNotebooklmUrl(raw.url);
    if (!pageUrl) {
        throw new CommandExecutionError('NotebookLM page auth probe is not on a trusted HTTPS NotebookLM origin');
    }
    if (typeof raw.html !== 'string' || typeof raw.sourcePath !== 'string' || typeof raw.csrfToken !== 'string' || typeof raw.sessionId !== 'string' || typeof raw.authuser !== 'string') {
        throw new CommandExecutionError('NotebookLM page auth probe returned malformed fields');
    }
    if (raw.sourcePath !== pageUrl.pathname || (raw.authuser && !/^\d+$/.test(raw.authuser))) {
        throw new CommandExecutionError('NotebookLM page auth probe returned an invalid path or authuser');
    }
    return {
        html: raw.html,
        sourcePath: raw.sourcePath,
        readyState: typeof raw.readyState === 'string' ? raw.readyState : '',
        csrfToken: raw.csrfToken,
        sessionId: raw.sessionId,
        authuser: raw.authuser,
        origin: pageUrl.origin,
    };
}
export async function getNotebooklmPageAuth(page) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const probe = await probeNotebooklmPageAuth(page);
        try {
            return {
                ...extractNotebooklmPageAuthFromHtml(probe.html, probe.sourcePath, { csrfToken: probe.csrfToken, sessionId: probe.sessionId, authuser: probe.authuser }),
                origin: probe.origin,
            };
        }
        catch (error) {
            lastError = error;
            if (attempt === 0 && typeof page.wait === 'function') {
                await page.wait(0.5).catch(() => undefined);
                continue;
            }
        }
    }
    throw lastError;
}
export function buildNotebooklmRpcBody(rpcId, params, csrfToken) {
    const rpcRequest = [[[rpcId, JSON.stringify(params), null, 'generic']]];
    return `f.req=${encodeURIComponent(JSON.stringify(rpcRequest))}&at=${encodeURIComponent(csrfToken)}&`;
}
export function stripNotebooklmAntiXssi(rawBody) {
    if (!rawBody.startsWith(")]}'"))
        return rawBody;
    return rawBody.replace(/^\)\]\}'\r?\n/, '');
}
export function parseNotebooklmChunkedResponse(rawBody) {
    const cleaned = stripNotebooklmAntiXssi(rawBody).trim();
    if (!cleaned)
        return [];
    const lines = cleaned.split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line)
            continue;
        if (/^\d+$/.test(line)) {
            const nextLine = lines[i + 1];
            if (!nextLine)
                continue;
            try {
                chunks.push(JSON.parse(nextLine));
            }
            catch {
                // Ignore malformed chunks and keep scanning.
            }
            i += 1;
            continue;
        }
        if (line.startsWith('[')) {
            try {
                chunks.push(JSON.parse(line));
            }
            catch {
                // Ignore malformed chunks and keep scanning.
            }
        }
    }
    return chunks;
}
export function extractNotebooklmRpcResult(rawBody, rpcId) {
    const chunks = parseNotebooklmChunkedResponse(rawBody);
    for (const chunk of chunks) {
        if (!Array.isArray(chunk))
            continue;
        const items = Array.isArray(chunk[0]) ? chunk : [chunk];
        for (const item of items) {
            if (!Array.isArray(item) || item.length < 1)
                continue;
            if (item[0] === 'er') {
                const errorCode = typeof item[2] === 'number'
                    ? item[2]
                    : typeof item[5] === 'number'
                        ? item[5]
                        : null;
                if (errorCode === 401 || errorCode === 403) {
                    throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, `NotebookLM RPC returned auth error (${errorCode})`);
                }
                throw new CliError('NOTEBOOKLM_RPC', `NotebookLM RPC failed${errorCode ? ` (code=${errorCode})` : ''}`, 'Retry from an already logged-in NotebookLM session, or inspect the raw response with debug logging.');
            }
            if (item[0] === 'wrb.fr' && item[1] === rpcId) {
                const payload = item[2];
                if (typeof payload === 'string') {
                    try {
                        return JSON.parse(payload);
                    }
                    catch {
                        throw new CliError('NOTEBOOKLM_RPC_SCHEMA', `NotebookLM RPC ${rpcId} returned malformed JSON`, 'Retry from the NotebookLM page; the internal RPC response shape may have changed.');
                    }
                }
                return payload;
            }
        }
    }
    throw new CliError('NOTEBOOKLM_RPC_SCHEMA', `NotebookLM RPC ${rpcId} returned no matching response frame`, 'Retry from the NotebookLM page; the internal RPC response shape may have changed.');
}
export async function fetchNotebooklmInPage(page, url, options = {}) {
    const method = options.method ?? 'GET';
    const headers = options.headers ?? {};
    const body = options.body ?? '';
    let evaluated;
    try {
        evaluated = await page.evaluate(`(async () => {
    const request = {
      url: ${JSON.stringify(url)},
      method: ${JSON.stringify(method)},
      headers: ${JSON.stringify(headers)},
      body: ${JSON.stringify(body)},
    };

    const requestUrl = new URL(request.url, location.href).href;
    const response = await fetch(requestUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : request.body,
      credentials: 'include',
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
      requestUrl,
      finalUrl: response.url,
    };
  })()`);
    }
    catch (error) {
        rethrowNotebooklmTransport(error, 'RPC transport');
    }
    const raw = requireNotebooklmObject(unwrapNotebooklmEvaluateResult(evaluated), 'RPC transport');
    if (typeof raw.ok !== 'boolean' || !Number.isInteger(raw.status) || typeof raw.body !== 'string' || typeof raw.requestUrl !== 'string' || typeof raw.finalUrl !== 'string') {
        throw new CommandExecutionError('NotebookLM RPC transport returned malformed response fields');
    }
    return {
        ok: raw.ok,
        status: raw.status,
        body: raw.body,
        requestUrl: raw.requestUrl,
        finalUrl: raw.finalUrl,
    };
}
export async function callNotebooklmRpc(page, rpcId, params, options = {}) {
    const auth = await getNotebooklmPageAuth(page);
    const requestBody = buildNotebooklmRpcBody(rpcId, params, auth.csrfToken);
    const authuser = auth.authuser || '';
    const url = NOTEBOOKLM_RPC_PATH +
        `?rpcids=${rpcId}&source-path=${encodeURIComponent(auth.sourcePath)}` +
        (authuser ? `&authuser=${encodeURIComponent(authuser)}` : '') +
        `&hl=${encodeURIComponent(options.hl ?? 'en')}` +
        `&f.sid=${encodeURIComponent(auth.sessionId)}&rt=c`;
    const response = await fetchNotebooklmInPage(page, url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: requestBody,
    });
    const requestUrl = parseTrustedNotebooklmUrl(response.requestUrl);
    const finalUrl = parseTrustedNotebooklmUrl(response.finalUrl);
    if (!requestUrl || requestUrl.origin !== auth.origin || requestUrl.pathname !== NOTEBOOKLM_RPC_PATH) {
        throw new CommandExecutionError('NotebookLM RPC request resolved outside the active trusted origin');
    }
    if (finalUrl?.origin === auth.origin && (finalUrl.pathname === '/login' || finalUrl.pathname.startsWith('/login/'))) {
        throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, 'NotebookLM RPC redirected to the login page');
    }
    if (!finalUrl || finalUrl.origin !== auth.origin || finalUrl.pathname !== NOTEBOOKLM_RPC_PATH) {
        throw new CommandExecutionError('NotebookLM RPC response redirected outside the active trusted endpoint');
    }
    if (response.status === 401 || response.status === 403) {
        throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, `NotebookLM RPC returned auth error (${response.status})`);
    }
    if (!response.ok) {
        throw new CliError('NOTEBOOKLM_RPC', `NotebookLM RPC request failed with HTTP ${response.status}`, 'Retry from the NotebookLM home page in an already logged-in Chrome session.');
    }
    return {
        auth,
        url: requestUrl.href,
        requestBody,
        response,
        result: extractNotebooklmRpcResult(response.body, rpcId),
    };
}
