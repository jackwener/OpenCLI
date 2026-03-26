import type { IPage } from '../../types.js';

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function sanitizeQueryId(resolved: unknown, fallbackId: string): string {
  return typeof resolved === 'string' && QUERY_ID_PATTERN.test(resolved) ? resolved : fallbackId;
}

export async function resolveTwitterQueryId(
  page: Pick<IPage, 'evaluate'>,
  operationName: string,
  fallbackId: string,
): Promise<string> {
  const resolved = await page.evaluate(`async () => {
    const operationName = ${JSON.stringify(operationName)};
    try {
      const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
      if (ghResp.ok) {
        const data = await ghResp.json();
        const entry = data?.[operationName];
        if (entry && entry.queryId) return entry.queryId;
      }
    } catch {}
    try {
      const scripts = performance.getEntriesByType('resource')
        .filter(r => r.name.includes('client-web') && r.name.endsWith('.js'))
        .map(r => r.name);
      for (const scriptUrl of scripts.slice(0, 15)) {
        try {
          const text = await (await fetch(scriptUrl)).text();
          const re = new RegExp('queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"' + operationName + '"');
          const match = text.match(re);
          if (match) return match[1];
        } catch {}
      }
    } catch {}
    return null;
  }`);

  return sanitizeQueryId(resolved, fallbackId);
}

export const __test__ = {
  sanitizeQueryId,
};
