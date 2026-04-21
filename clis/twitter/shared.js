const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export function sanitizeQueryId(resolved, fallbackId) {
    return typeof resolved === 'string' && QUERY_ID_PATTERN.test(resolved) ? resolved : fallbackId;
}
export async function resolveTwitterQueryId(page, operationName, fallbackId) {
    const resolved = await page.evaluate(`async () => {
    const operationName = ${JSON.stringify(operationName)};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json', { signal: controller.signal });
      clearTimeout(timeout);
      if (ghResp.ok) {
        const data = await ghResp.json();
        const entry = data?.[operationName];
        if (entry && entry.queryId) return entry.queryId;
      }
    } catch {
      clearTimeout(timeout);
    }
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
