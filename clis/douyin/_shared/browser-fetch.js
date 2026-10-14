import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './evaluate-result.js';

const BROWSER_FETCH_ERROR_MARKER = '__opencli_douyin_error';
const BROWSER_FETCH_HTTP_STATUS = '__opencli_douyin_http_status';
const BROWSER_FETCH_PAYLOAD = '__opencli_douyin_payload';
const REQUEST_ERROR_CODES = {
    EMPTY_RESPONSE: 'DOUYIN_EMPTY_RESPONSE',
    HTTP: 'DOUYIN_HTTP_ERROR',
    NETWORK: 'DOUYIN_NETWORK_ERROR',
    TIMEOUT: 'DOUYIN_TIMEOUT',
    PARSE: 'DOUYIN_PARSE_ERROR',
    API: 'DOUYIN_API_ERROR',
    MALFORMED: 'DOUYIN_MALFORMED_RESPONSE',
    EVALUATE: 'DOUYIN_EVALUATE_ERROR',
};

export class DouyinRequestError extends CommandExecutionError {
    constructor(errorCode, message, { hint, phase, httpStatus, apiCode, url } = {}) {
        super(message, hint);
        // Keep COMMAND_EXEC as the public envelope code. Consumers can use the
        // request-specific code without depending on error-message wording.
        this.errorCode = errorCode;
        if (phase) this.phase = phase;
        if (httpStatus !== undefined) this.httpStatus = httpStatus;
        if (apiCode !== undefined) this.apiCode = apiCode;
        if (url) this.url = url;
    }
}

function isAuthLikeError(code, message) {
    const text = String(message ?? '');
    return code === 401 || code === 403 || /login|cookie|auth|captcha|verify|forbidden|permission|登录|登陆|权限|验证|验证码/i.test(text);
}

function requestError(code, message, options) {
    return new DouyinRequestError(code, message, options);
}

function getRequestErrorCode(marker, statusCode) {
    switch (marker) {
        case 'HTTP':
            return REQUEST_ERROR_CODES.HTTP;
        case 'NETWORK':
            return REQUEST_ERROR_CODES.NETWORK;
        case 'TIMEOUT':
            return REQUEST_ERROR_CODES.TIMEOUT;
        case 'PARSE':
            return REQUEST_ERROR_CODES.PARSE;
        default:
            if (statusCode === -1) return REQUEST_ERROR_CODES.NETWORK;
            if (statusCode === -2) return REQUEST_ERROR_CODES.PARSE;
            return REQUEST_ERROR_CODES.API;
    }
}

/**
 * Execute a fetch() call inside the Chrome browser context via page.evaluate.
 * This ensures a_bogus signing and cookies are handled automatically by the browser.
 */
export async function browserFetch(page, method, url, options = {}) {
    const js = `
    (async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ${Number(options.timeoutMs ?? 30000)});
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...${JSON.stringify(options.headers ?? {})}
          },
          ${options.body ? `body: JSON.stringify(${JSON.stringify(options.body)}),` : ''}
        });
        const text = await res.text();
        // A retired or gated endpoint answers 200 with no body. Reporting that
        // as a parse failure sends readers after the JSON instead of the
        // endpoint (issue #1405 fixed it, #1587 dropped it again).
        if (!text.trim()) {
          return res.ok ? null : {
            ${JSON.stringify(BROWSER_FETCH_ERROR_MARKER)}: 'HTTP',
            ${JSON.stringify(BROWSER_FETCH_HTTP_STATUS)}: res.status,
            ${JSON.stringify(BROWSER_FETCH_PAYLOAD)}: { status_msg: 'Empty response body' },
          };
        }
        try {
          const payload = JSON.parse(text);
          return res.ok ? payload : {
            ${JSON.stringify(BROWSER_FETCH_ERROR_MARKER)}: 'HTTP',
            ${JSON.stringify(BROWSER_FETCH_HTTP_STATUS)}: res.status,
            ${JSON.stringify(BROWSER_FETCH_PAYLOAD)}: payload,
          };
        } catch (error) {
          return {
            ${JSON.stringify(BROWSER_FETCH_ERROR_MARKER)}: res.ok ? 'PARSE' : 'HTTP',
            ${JSON.stringify(BROWSER_FETCH_HTTP_STATUS)}: res.ok ? undefined : res.status,
            ${JSON.stringify(BROWSER_FETCH_PAYLOAD)}: {
              status_code: res.ok ? -2 : undefined,
              status_msg: \`JSON parse failed: \${text.slice(0, 500) || String(error && error.message || error)}\`,
            },
          };
        }
      } catch (error) {
        return {
          ${JSON.stringify(BROWSER_FETCH_ERROR_MARKER)}: timedOut ? 'TIMEOUT' : 'NETWORK',
          ${JSON.stringify(BROWSER_FETCH_PAYLOAD)}: {
            status_code: -1,
            status_msg: String(error && error.message || error),
          },
        };
      } finally {
        clearTimeout(timer);
      }
    })()
  `;
    let result;
    try {
        result = unwrapEvaluateResult(await page.evaluate(js));
    }
    catch (error) {
        const code = error?.code === 'TIMEOUT' || error?.name === 'TimeoutError'
            ? REQUEST_ERROR_CODES.TIMEOUT
            : REQUEST_ERROR_CODES.EVALUATE;
        throw requestError(
            code,
            `Douyin API request failed (${method} ${url}): ${error instanceof Error ? error.message : String(error)}`,
            { phase: options.phase, url },
        );
    }
    const markedResult = result && typeof result === 'object' && !Array.isArray(result)
        ? result[BROWSER_FETCH_ERROR_MARKER]
        : undefined;
    if (markedResult) {
        const httpStatus = result[BROWSER_FETCH_HTTP_STATUS];
        const payload = result[BROWSER_FETCH_PAYLOAD] ?? result;
        const apiCode = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload.status_code
            : undefined;
        const msg = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload.status_msg ?? payload.message ?? `HTTP ${httpStatus}`
            : `HTTP ${httpStatus}`;
        if (markedResult === 'HTTP' && (isAuthLikeError(httpStatus, msg) || isAuthLikeError(apiCode, msg))) {
            const error = new AuthRequiredError('creator.douyin.com', `Douyin API auth/permission error ${apiCode ?? httpStatus} at ${method} ${url}: ${msg}`);
            if (options.phase) error.phase = options.phase;
            if (httpStatus !== undefined) error.httpStatus = httpStatus;
            if (apiCode !== undefined) error.apiCode = apiCode;
            error.url = url;
            throw error;
        }
        const errorCode = getRequestErrorCode(markedResult, apiCode);
        throw requestError(
            errorCode,
            `Douyin API error ${apiCode ?? httpStatus} at ${method} ${url}: ${msg}`,
            { phase: options.phase, httpStatus, apiCode, url },
        );
    }
    if (result == null) {
        throw requestError(
            REQUEST_ERROR_CODES.EMPTY_RESPONSE,
            `Empty response from Douyin API (${method} ${url})`,
            {
                hint: 'The endpoint may have been retired or may now require signed parameters.',
                phase: options.phase,
                url,
            },
        );
    }
    if (Array.isArray(result) || typeof result !== 'object') {
        throw requestError(
            REQUEST_ERROR_CODES.MALFORMED,
            `Malformed response from Douyin API (${method} ${url})`,
            { phase: options.phase, url },
        );
    }
    if (result && typeof result === 'object' && 'status_code' in result) {
        const code = result.status_code;
        if (code !== 0) {
            const msg = result.status_msg ?? result.message ?? 'unknown error';
            const marker = result[BROWSER_FETCH_ERROR_MARKER];
            if (isAuthLikeError(code, msg)) {
                const error = new AuthRequiredError('creator.douyin.com', `Douyin API auth/permission error ${code} at ${method} ${url}: ${msg}`);
                if (options.phase) error.phase = options.phase;
                error.apiCode = code;
                error.url = url;
                throw error;
            }
            throw requestError(
                getRequestErrorCode(marker, code),
                `Douyin API error ${code} at ${method} ${url}: ${msg}`,
                { phase: options.phase, apiCode: code, url },
            );
        }
    }
    return result;
}
