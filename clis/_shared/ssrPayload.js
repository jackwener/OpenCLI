/**
 * Shared SSR-payload extractors for adapters that target server-side rendered
 * pages. Lives under clis/_shared/ rather than under any one site directory
 * so future SSR-using adapters (rednote, xiaohongshu, ...) can `import` the
 * extractor without knowing which existing adapter introduced it.
 *
 * The Nuxt SSR layout we know: window.__NUXT__ = (function(NAMES){ return {...} })
 *   (arg1, arg2, ... ); </script> — the assignment spans until the first
 * closing script tag.
 */

import { CliError } from '@jackwener/opencli/errors';

/**
 * Locate the `window.__NUXT__ = ...` block in an HTML page and evaluate it
 * inside a sandboxed `Function`. Returns the SSR data graph as a plain object.
 *
 * @param {string} html — full server-rendered HTML
 * @returns {object}
 * @throws {CliError} SSR_PAYLOAD_MISSING / SSR_PAYLOAD_PARSE / SSR_PAYLOAD_EVAL
 */
export function extractNuxtPayload(html) {
    const assignmentStart = html.indexOf('window.__NUXT__=');
    if (assignmentStart < 0) {
        throw new CliError(
            'SSR_PAYLOAD_MISSING',
            'Could not locate window.__NUXT__ block; the page layout may have changed.',
        );
    }
    const expressionStart = assignmentStart + 'window.__NUXT__='.length;
    const expressionEnd = html.indexOf(';</script>', expressionStart);
    if (expressionEnd < 0) {
        throw new CliError(
            'SSR_PAYLOAD_PARSE',
            'Could not find end of __NUXT__ script tag.',
        );
    }
    const expression = html.slice(expressionStart, expressionEnd);
    let payload;
    try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (${expression});`);
        payload = fn();
    } catch (err) {
        throw new CliError(
            'SSR_PAYLOAD_EVAL',
            `Failed to evaluate window.__NUXT__: ${err && err.message ? err.message : err}`,
        );
    }
    return payload;
}

/**
 * Generic page-text fetch with CliError mapping for non-2xx and JSON-capable
 * text-only adapters. Returns the response body as a string. Use a JSON.parse
 * step on top to convert.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {object} [opts.headers]
 * @param {number} [opts.timeoutMs=10000] AbortController timeout
 */
export async function fetchText(url, opts = {}) {
    const { headers = {}, timeoutMs = 10000 } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
        resp = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') {
            throw new CliError('TIMEOUT_ERR', `${url}: timed out after ${timeoutMs}ms`);
        }
        throw new CliError('COMMAND_EXEC', `${url}: fetch failed (${err && err.message ? err.message : err})`);
    }
    clearTimeout(timer);
    if (!resp.ok) {
        throw new CliError(
            'HTTP_ERROR',
            `HTTP ${resp.status} ${resp.statusText || ''} from ${url}`.trim(),
        );
    }
    return resp.text();
}
