/** Evidence-oriented discovery. Static candidates are never executed. */
import { parse } from 'acorn';
import type { IPage } from '../types.js';
import { inferShape } from './shape.js';
import { type SafeNetworkRequest, sanitizeCapturedUrl } from './network-request.js';

type Node = any;
export interface EndpointEvidence {
  url: string;
  method: string;
  queryParams: string[];
  bodyParams: string[];
  evidence: 'static' | 'network' | 'network+static';
  sources: Array<{ script: string; line: number }>;
  requests: Array<{ key: string; status?: number; shape?: unknown }>;
  unresolved: boolean;
  operationName?: string;
}
export interface DiscoveryRequest {
  url: string; method?: string; status?: number; body?: unknown;
  request?: SafeNetworkRequest; key?: string;
}
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const NOISE = /google-analytics|googletagmanager|doubleclick|hotjar|sentry|segment\.com/i;
function safeUrl(value: string): string {
  if (value.startsWith('//')) return sanitizeCapturedUrl(`https:${value}`).slice(6);
  if (!/^[a-z]+:/i.test(value)) {
    const prefix = `https://placeholder.invalid${value.startsWith('/') ? '' : '/'}`;
    return sanitizeCapturedUrl(prefix + value).slice(prefix.length);
  }
  return sanitizeCapturedUrl(value);
}

function children(n: Node): Node[] {
  return Object.values(n).flatMap(v => Array.isArray(v) ? v : [v])
    .filter((v: any) => v && typeof v === 'object' && typeof v.type === 'string');
}
function expression(n: Node): string { return String(expressionValue(n)); }
function expressionValue(n: Node): string | number {
  if (!n) return 'EXPR';
  if (n.type === 'Literal' && ['string', 'number'].includes(typeof n.value)) return n.value;
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const left = expressionValue(n.left), right = expressionValue(n.right);
    return typeof left === 'number' && typeof right === 'number' ? left + right : String(left) + String(right);
  }
  if (n.type === 'TemplateLiteral') return n.quasis.map((q: Node, i: number) => (q.value.cooked ?? q.value.raw) + (i < n.expressions.length ? expression(n.expressions[i]) : '')).join('');
  return 'EXPR';
}
function properties(n: Node): Map<string, Node> {
  return new Map((n?.type === 'ObjectExpression' ? n.properties : [])
    .filter((p: Node) => p.type === 'Property' && !p.computed)
    .map((p: Node) => [p.key.name ?? p.key.value, p.value]));
}
function bodyKeys(n: Node): string[] {
  if (n?.type === 'CallExpression' && member(n.callee) === 'JSON.stringify') n = n.arguments[0];
  return [...properties(n).keys()];
}
function member(n: Node): string {
  if (n?.type === 'Identifier') return n.name;
  if (n?.type === 'MemberExpression' && !n.computed) return `${member(n.object)}.${n.property.name}`;
  return '';
}
function queryKeys(url: string): string[] {
  try { return [...new URL(url, 'https://placeholder.invalid').searchParams.keys()].sort(); } catch { return []; }
}

export function analyzeScript(source: string, script = 'inline'): { endpoints: EndpointEvidence[]; error?: string } {
  if (Buffer.byteLength(source) > MAX_SCRIPT_BYTES) return { endpoints: [], error: 'script_too_large' };
  let tree: Node;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch (error) { return { endpoints: [], error: `parse_error: ${(error as Error).message}` }; }
  const endpoints: EndpointEvidence[] = [];
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    for (const child of children(node)) stack.push(child);
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') continue;
    const name = member(node.callee);
    let url: Node | undefined; let method = 'GET'; let body: Node; let params: Node;
    const args = node.arguments;
    if (name === 'fetch' || name === 'window.fetch' || name === 'Request') {
      url = args[0]; const opts = properties(args[1]);
      method = opts.has('method') ? expression(opts.get('method')).toUpperCase() : 'GET';
      body = opts.get('body');
    } else if (/^(axios|\$|jQuery|api|client|http|httpClient)\.(get|post|put|patch|delete|head|options)$/.test(name)) {
      url = args[0]; method = name.split('.').at(-1)!.toUpperCase();
      if (['GET', 'HEAD', 'DELETE'].includes(method)) params = properties(args[1]).get('params');
      else { body = args[1]; params = properties(args[2]).get('params'); }
    } else if (name === 'axios' || name === 'axios.request' || name === '$.ajax' || name === 'jQuery.ajax') {
      const opts = properties(args[0]); url = opts.get('url');
      method = expression(opts.get('method') ?? opts.get('type') ?? { type: 'Literal', value: 'GET' }).toUpperCase();
      body = opts.get('data'); params = opts.get('params');
    } else if (name.endsWith('.open') && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(expression(args[0]).toUpperCase())) {
      method = expression(args[0]).toUpperCase(); url = args[1];
    } else if (name === 'WebSocket' || name === 'EventSource') url = args[0];
    else continue;
    const value = expression(url);
    if (!value || value === 'EXPR' || /^(data|javascript|blob):/i.test(value)) continue;
    const payload = body?.type === 'CallExpression' && member(body.callee) === 'JSON.stringify' ? body.arguments[0] : body;
    const operationName = operation({
      url: value,
      request: { body: { operationName: expression(properties(payload).get('operationName')) } }
    });
    endpoints.push({
      ...(operationName && operationName !== 'EXPR' ? { operationName } : {}), url: safeUrl(value), method, queryParams: [...new Set([...queryKeys(value), ...properties(params).keys()])].sort(),
      bodyParams: bodyKeys(body).sort(), evidence: 'static', sources: [{ script, line: node.loc.start.line }], requests: [],
      unresolved: value.includes('EXPR') || method === 'EXPR'
    });
  }
  return { endpoints };
}

function normalized(url: string, base: string): string {
  try { const u = new URL(url, base); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return url; }
}
function requestFields(request: DiscoveryRequest): Record<string, unknown> {
  const body = request.request?.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}
function operation(request: DiscoveryRequest): string {
  try {
    const value = new URL(request.url, 'https://placeholder.invalid').searchParams.get('operationName') || requestFields(request).operationName;
    return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : '';
  } catch { return ''; }
}
export function mergeEvidence(base: string, staticEvidence: EndpointEvidence[], network: DiscoveryRequest[]): EndpointEvidence[] {
  const result = new Map<string, EndpointEvidence>();
  for (const request of network) {
    const method = (request.method || 'GET').toUpperCase();
    const key = `${method} ${normalized(request.url, base)} ${operation(request)}`;
    let entry = result.get(key);
    if (!entry) {
      entry = { url: sanitizeCapturedUrl(request.url), method, queryParams: queryKeys(request.url), bodyParams: [], ...(operation(request) ? { operationName: operation(request) } : {}), evidence: 'network', sources: [], requests: [], unresolved: false };
      result.set(key, entry);
    }
    entry.queryParams = [...new Set([...entry.queryParams, ...queryKeys(request.url)])].sort();
    entry.bodyParams = [...new Set([...entry.bodyParams, ...Object.keys(requestFields(request))])].sort();
    entry.requests.push({ key: request.key || key.trim(), status: request.status, ...(request.body !== undefined ? { shape: inferShape(request.body) } : {}) });
  }
  for (const candidate of staticEvidence) {
    // Never guess that an unresolved template is the same endpoint as a captured request.
    const matches = candidate.unresolved ? [] : [...result.values()].filter(e => e.requests.length > 0 && e.method === candidate.method && normalized(e.url, base) === normalized(candidate.url, base) && (!candidate.operationName || e.operationName === candidate.operationName));
    if (matches.length) {
      for (const entry of matches) {
        entry.evidence = 'network+static'; entry.sources.push(...candidate.sources);
        entry.bodyParams = [...new Set([...entry.bodyParams, ...candidate.bodyParams])].sort();
        entry.queryParams = [...new Set([...entry.queryParams, ...candidate.queryParams])].sort();
      }
    } else {
      const key = `static ${candidate.method} ${candidate.url} ${candidate.operationName || ''}`;
      const prior = result.get(key);
      if (prior) {
        prior.sources.push(...candidate.sources);
        prior.bodyParams = [...new Set([...prior.bodyParams, ...candidate.bodyParams])].sort();
        prior.queryParams = [...new Set([...prior.queryParams, ...candidate.queryParams])].sort();
      } else result.set(key, { ...candidate, sources: [...candidate.sources] });
    }
  }
  return [...result.values()].sort((a, b) => Number(b.requests.length > 0) - Number(a.requests.length > 0));
}

async function fetchScript(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_SCRIPT_BYTES) throw new Error('script_too_large'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function discoverEndpoints(page: IPage, network: DiscoveryRequest[], includeStatic = false) {
  const pageUrl = await page.getCurrentUrl?.() || await page.evaluate<string>('location.href');
  const sources: Array<{ script: string; analyzed: boolean; error?: string }> = [];
  const candidates: EndpointEvidence[] = [];
  let omittedScripts = 0;
  if (includeStatic) {
    // Bound the response in the page before sending script text over the bridge.
    const { scripts: relevant, omitted } = await page.evaluate<{
      scripts: Array<{ src: string; text: string; oversized: boolean }>; omitted: number;
    }>(`(() => {
      const scripts = Array.from(document.scripts).filter(s => !${NOISE}.test(s.src)
        && (!s.src || /^https?:/.test(s.src))
        && (!s.type || ['module', 'text/javascript', 'application/javascript'].includes(s.type.toLowerCase())));
      let budget = ${MAX_SCRIPT_BYTES};
      return { omitted: Math.max(0, scripts.length - 20), scripts: scripts.slice(0, 20).map(s => {
        const text = s.src ? '' : (s.textContent || '');
        const size = new TextEncoder().encode(text).length;
        const oversized = size > budget;
        if (!oversized) budget -= size;
        return { src: s.src, text: oversized ? '' : text, oversized };
      }) };
    })()`);
    omittedScripts = omitted;
    // Small batches bound memory and load on the origin.
    for (let i = 0;i < Math.min(relevant.length, 20);i += 4) {
      await Promise.all(relevant.slice(i, Math.min(i + 4, 20)).map(async (script, j) => {
        const name = script.src || `inline:${i + j + 1}`;
        try {
          if (script.oversized) throw new Error('script_too_large');
          const analysis = analyzeScript(script.src ? await fetchScript(script.src) : script.text, sanitizeCapturedUrl(name));
          sources.push({ script: sanitizeCapturedUrl(name), analyzed: !analysis.error, ...(analysis.error ? { error: analysis.error } : {}) });
          candidates.push(...analysis.endpoints);
        } catch (error) { sources.push({ script: sanitizeCapturedUrl(name), analyzed: false, error: (error as Error).message }); }
      }));
    }
  }
  return {
    pageUrl: sanitizeCapturedUrl(pageUrl), staticRequested: includeStatic, scripts: sources, omittedScripts,
    analysisComplete: omittedScripts === 0 && sources.every(s => s.analyzed), endpoints: mergeEvidence(pageUrl, candidates, network),
    scope: 'Captured requests and currently loaded document scripts; candidates require authentication, pagination and business-result verification.'
  };
}
