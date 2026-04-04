import { AuthRequiredError, CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN } from './shared.js';

export type NotebooklmPageAuth = {
  csrfToken: string;
  sessionId: string;
  sourcePath: string;
};

type NotebooklmAuthProbe = {
  html: string;
  sourcePath: string;
  readyState: string;
  csrfToken: string;
  sessionId: string;
};

export type NotebooklmFetchResponse = {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
};

export type NotebooklmRpcCallResult = {
  auth: NotebooklmPageAuth;
  url: string;
  requestBody: string;
  response: NotebooklmFetchResponse;
  result: unknown;
};

export function extractNotebooklmPageAuthFromHtml(
  html: string,
  sourcePath: string = '/',
  preferredTokens?: { csrfToken?: string; sessionId?: string },
): NotebooklmPageAuth {
  const csrfMatch = html.match(/"SNlM0e":"([^"]+)"/);
  const sessionMatch = html.match(/"FdrFJe":"([^"]+)"/);
  const csrfToken = preferredTokens?.csrfToken?.trim() || (csrfMatch ? csrfMatch[1] : '');
  const sessionId = preferredTokens?.sessionId?.trim() || (sessionMatch ? sessionMatch[1] : '');

  if (!csrfToken || !sessionId) {
    throw new CliError(
      'NOTEBOOKLM_TOKENS',
      'NotebookLM page tokens were not found in the current page HTML',
      'Open the NotebookLM notebook page in Chrome, wait for it to finish loading, then retry with --verbose if it still fails.',
    );
  }

  return { csrfToken, sessionId, sourcePath: sourcePath || '/' };
}

async function probeNotebooklmPageAuth(page: IPage): Promise<NotebooklmAuthProbe> {
  const raw = await page.evaluate(`(() => {
    const wiz = window.WIZ_global_data || {};
    const html = document.documentElement.innerHTML;
    return {
      html,
      sourcePath: location.pathname || '/',
      readyState: document.readyState || '',
      csrfToken: typeof wiz.SNlM0e === 'string' ? wiz.SNlM0e : '',
      sessionId: typeof wiz.FdrFJe === 'string' ? wiz.FdrFJe : '',
    };
  })()`) as Partial<NotebooklmAuthProbe> | null;

  return {
    html: String(raw?.html ?? ''),
    sourcePath: String(raw?.sourcePath ?? '/'),
    readyState: String(raw?.readyState ?? ''),
    csrfToken: String(raw?.csrfToken ?? ''),
    sessionId: String(raw?.sessionId ?? ''),
  };
}

export async function getNotebooklmPageAuth(page: IPage): Promise<NotebooklmPageAuth> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const probe = await probeNotebooklmPageAuth(page);
    try {
      return extractNotebooklmPageAuthFromHtml(
        probe.html,
        probe.sourcePath,
        { csrfToken: probe.csrfToken, sessionId: probe.sessionId },
      );
    } catch (error) {
      lastError = error;
      if (attempt === 0 && typeof page.wait === 'function') {
        await page.wait(0.5).catch(() => undefined);
        continue;
      }
    }
  }

  throw lastError;
}

export function buildNotebooklmRpcBody(
  rpcId: string,
  params: unknown[] | Record<string, unknown> | null,
  csrfToken: string,
): string {
  const rpcRequest = [[[rpcId, JSON.stringify(params), null, 'generic']]];
  return `f.req=${encodeURIComponent(JSON.stringify(rpcRequest))}&at=${encodeURIComponent(csrfToken)}&`;
}

export function stripNotebooklmAntiXssi(rawBody: string): string {
  if (!rawBody.startsWith(")]}'")) return rawBody;
  return rawBody.replace(/^\)\]\}'\r?\n/, '');
}

export function parseNotebooklmChunkedResponse(rawBody: string): unknown[] {
  const cleaned = stripNotebooklmAntiXssi(rawBody).trim();
  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const chunks: unknown[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    if (/^\d+$/.test(line)) {
      const nextLine = lines[i + 1];
      if (!nextLine) continue;
      try {
        chunks.push(JSON.parse(nextLine));
      } catch {
        // Ignore malformed chunks and keep scanning.
      }
      i += 1;
      continue;
    }

    if (line.startsWith('[')) {
      try {
        chunks.push(JSON.parse(line));
      } catch {
        // Ignore malformed chunks and keep scanning.
      }
    }
  }

  return chunks;
}

export function extractNotebooklmRpcResult(rawBody: string, rpcId: string): unknown {
  const chunks = parseNotebooklmChunkedResponse(rawBody);

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    const items = Array.isArray(chunk[0]) ? chunk : [chunk];

    for (const item of items) {
      if (!Array.isArray(item) || item.length < 1) continue;

      if (item[0] === 'er') {
        const errorCode = typeof item[2] === 'number'
          ? item[2]
          : typeof item[5] === 'number'
            ? item[5]
            : null;

        if (errorCode === 401 || errorCode === 403) {
          throw new AuthRequiredError(
            NOTEBOOKLM_DOMAIN,
            `NotebookLM RPC returned auth error (${errorCode})`,
          );
        }

        throw new CliError(
          'NOTEBOOKLM_RPC',
          `NotebookLM RPC failed${errorCode ? ` (code=${errorCode})` : ''}`,
          'Retry from an already logged-in NotebookLM session, or inspect the raw response with debug logging.',
        );
      }

      if (item[0] === 'wrb.fr' && item[1] === rpcId) {
        const payload = item[2];
        if (typeof payload === 'string') {
          try {
            return JSON.parse(payload);
          } catch {
            return payload;
          }
        }
        return payload;
      }
    }
  }

  return null;
}

export async function fetchNotebooklmInPage(
  page: IPage,
  url: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<NotebooklmFetchResponse> {
  const method = options.method ?? 'GET';
  const headers = options.headers ?? {};
  const body = options.body ?? '';

  const raw = await page.evaluate(`(async () => {
    const request = {
      url: ${JSON.stringify(url)},
      method: ${JSON.stringify(method)},
      headers: ${JSON.stringify(headers)},
      body: ${JSON.stringify(body)},
    };

    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : request.body,
      credentials: 'include',
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
      finalUrl: response.url,
    };
  })()`) as Partial<NotebooklmFetchResponse> | null;

  return {
    ok: Boolean(raw?.ok),
    status: Number(raw?.status ?? 0),
    body: String(raw?.body ?? ''),
    finalUrl: String(raw?.finalUrl ?? url),
  };
}

export async function callNotebooklmRpc(
  page: IPage,
  rpcId: string,
  params: unknown[] | Record<string, unknown> | null,
  options: {
    hl?: string;
  } = {},
): Promise<NotebooklmRpcCallResult> {
  const auth = await getNotebooklmPageAuth(page);
  const requestBody = buildNotebooklmRpcBody(rpcId, params, auth.csrfToken);
  const url =
    `https://${NOTEBOOKLM_DOMAIN}/_/LabsTailwindUi/data/batchexecute` +
    `?rpcids=${rpcId}&source-path=${encodeURIComponent(auth.sourcePath)}` +
    `&hl=${encodeURIComponent(options.hl ?? 'en')}` +
    `&f.sid=${encodeURIComponent(auth.sessionId)}&rt=c`;

  const response = await fetchNotebooklmInPage(page, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: requestBody,
  });

  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError(
      NOTEBOOKLM_DOMAIN,
      `NotebookLM RPC returned auth error (${response.status})`,
    );
  }

  if (!response.ok) {
    throw new CliError(
      'NOTEBOOKLM_RPC',
      `NotebookLM RPC request failed with HTTP ${response.status}`,
      'Retry from the NotebookLM home page in an already logged-in Chrome session.',
    );
  }

  return {
    auth,
    url,
    requestBody,
    response,
    result: extractNotebooklmRpcResult(response.body, rpcId),
  };
}
