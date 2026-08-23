import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';

export const DOMAIN = 'www.linkedin.com';
export const MAX_LIMIT = 50;

export function normalizeWhitespace(value) {
    return String(value ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 10;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

export function buildFetchScript(url, csrf) {
    return String.raw`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: {
          'csrf-token': ${JSON.stringify(csrf)},
          'x-restli-protocol-version': '2.0.0',
          accept: 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return { authRequired: true, status: res.status };
      if (!res.ok) return { error: 'HTTP ' + res.status };
      return { json: await res.json() };
    } catch (e) {
      return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
  })()`;
}

export async function fetchLinkedInLearningApi(page, url) {
    await page.goto('https://www.linkedin.com/learning/');
    await page.wait(3);

    const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
    const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    if (!jsession) {
        throw new AuthRequiredError(DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
    }
    const csrf = jsession.replace(/^"|"$/g, '');

    const result = unwrapEvaluateResult(await page.evaluate(buildFetchScript(url, csrf)));
    if (result?.authRequired) {
        throw new AuthRequiredError(DOMAIN, `LinkedIn Learning auth failed (HTTP ${result.status ?? ''}).`);
    }
    return result;
}
