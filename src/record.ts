/**
 * Record mode — capture API calls from a live browser session.
 *
 * Flow:
 *   1. Navigate to the target URL in an automation tab
 *   2. Inject a full-capture fetch/XHR interceptor (records url + method + body)
 *   3. Poll every 2s and print newly captured requests
 *   4. User operates the page; press Enter to stop
 *   5. Analyze captured requests → infer capabilities → write YAML candidates
 *
 * Design: no new daemon endpoints, no extension changes.
 * Uses existing exec + navigate actions only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import chalk from 'chalk';

import { sendCommand } from './browser/daemon-client.js';
import type { IPage } from './types.js';
import { SEARCH_PARAMS, PAGINATION_PARAMS, FIELD_ROLES } from './constants.js';
import {
  urlToPattern,
  findArrayPath,
  inferCapabilityName,
  inferStrategy,
  detectAuthFromContent,
  classifyQueryParams,
  isNoiseUrl,
} from './analysis.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RecordedRequest {
  url: string;
  method: string;
  status: number | null;
  /** Request content type captured at record time, if available. */
  requestContentType: string | null;
  /** Response content type captured at record time, if available. */
  responseContentType: string | null;
  /** Parsed JSON request body for replayable write requests. */
  requestBody: unknown;
  /** Parsed JSON response body captured from the network call. */
  responseBody: unknown;
  contentType: string;
  body: unknown;
  capturedAt: number;
}

export interface RecordResult {
  site: string;
  url: string;
  requests: RecordedRequest[];
  outDir: string;
  candidateCount: number;
  candidates: Array<{ name: string; path: string; strategy: string }>;
}

type RecordedCandidateKind = 'read' | 'write';

export interface RecordedCandidate {
  kind: RecordedCandidateKind;
  req: RecordedRequest;
  arrayResult: ReturnType<typeof findArrayPath> | null;
}

interface GeneratedRecordedCandidate {
  kind: RecordedCandidateKind;
  name: string;
  strategy: string;
  yaml: unknown;
}

/** Keep the later candidate when multiple recordings share one bucket (prefer fresher data). */
function preferRecordedCandidate(_current: RecordedCandidate, next: RecordedCandidate): RecordedCandidate {
  return next;
}

/** Build a candidate-level dedupe key. */
function getRecordedCandidateKey(candidate: RecordedCandidate): string {
  return `${candidate.kind} ${getRecordedRequestKey(candidate.req)}`;
}

/** Build a request dedupe key from method and URL pattern. */
function getRecordedRequestKey(req: RecordedRequest): string {
  return `${req.method.toUpperCase()} ${urlToPattern(req.url)}`;
}

/** Deduplicate recorded requests by method and URL pattern. */
function dedupeRecordedRequests(requests: RecordedRequest[]): RecordedRequest[] {
  const deduped = new Map<string, RecordedRequest>();
  for (const req of requests) {
    deduped.set(getRecordedRequestKey(req), req);
  }
  return [...deduped.values()];
}

/** Check whether a content type should be treated as JSON. */
function isJsonContentType(contentType: string | null | undefined): boolean {
  const normalized = contentType?.toLowerCase() ?? '';
  return normalized.includes('application/json') || normalized.includes('+json');
}

/** Parse a captured request body only when the request advertises JSON. */
function parseJsonBodyText(contentType: string | null | undefined, raw: string | null | undefined): unknown {
  if (!isJsonContentType(contentType)) return null;
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Build one normalized recorded entry from captured request and response values. */
export function createRecordedEntry(input: {
  url: string;
  method: string;
  requestContentType?: string | null;
  requestBodyText?: string | null;
  responseBody: unknown;
  responseContentType?: string | null;
  status?: number | null;
  capturedAt?: number;
}): RecordedRequest {
  const requestBody = parseJsonBodyText(input.requestContentType ?? null, input.requestBodyText ?? null);
  const responseContentType = input.responseContentType ?? 'application/json';
  return {
    url: input.url,
    method: input.method.toUpperCase(),
    status: input.status ?? null,
    requestContentType: input.requestContentType ?? null,
    responseContentType,
    requestBody,
    responseBody: input.responseBody,
    // Keep legacy fields in sync until the analyzer/template path is migrated.
    contentType: responseContentType,
    body: input.responseBody,
    capturedAt: input.capturedAt ?? Date.now(),
  };
}

// ── Interceptor JS ─────────────────────────────────────────────────────────

/**
 * Generates a full-capture interceptor that stores {url, method, status, body}
 * for every JSON response. No URL pattern filter — captures everything.
 */
export function generateFullCaptureInterceptorJs(): string {
  return `
    (() => {
      // Restore original fetch/XHR if previously patched, then re-patch (idempotent injection)
      if (window.__opencli_record_patched) {
        if (window.__opencli_orig_fetch) window.fetch = window.__opencli_orig_fetch;
        if (window.__opencli_orig_xhr_open) XMLHttpRequest.prototype.open = window.__opencli_orig_xhr_open;
        if (window.__opencli_orig_xhr_send) XMLHttpRequest.prototype.send = window.__opencli_orig_xhr_send;
        if (window.__opencli_orig_xhr_set_request_header) XMLHttpRequest.prototype.setRequestHeader = window.__opencli_orig_xhr_set_request_header;
        window.__opencli_record_patched = false;
      }
      // Preserve existing capture buffer across re-injections
      window.__opencli_record = window.__opencli_record || [];

      const _tryParseJson = (contentType, raw) => {
        try {
          const normalized = String(contentType || '').toLowerCase();
          if (!normalized.includes('application/json') && !normalized.includes('+json')) return null;
          if (typeof raw !== 'string' || !raw.trim()) return null;
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const _push = (entry) => {
        try {
          const responseBody = entry.responseBody;
          if (typeof responseBody !== 'object' || responseBody === null) return;
          const isReplayableWrite = ['POST', 'PUT', 'PATCH'].includes(String(entry.method).toUpperCase())
            && (() => {
              const normalized = String(entry.requestContentType || '').toLowerCase();
              return normalized.includes('application/json') || normalized.includes('+json');
            })()
            && entry.requestBody
            && typeof entry.requestBody === 'object';
          const keys = Object.keys(responseBody);
          if (keys.length < 2 && !isReplayableWrite) return;
          window.__opencli_record.push({
            url: String(entry.url),
            method: String(entry.method).toUpperCase(),
            status: null,
            requestContentType: entry.requestContentType || null,
            responseContentType: entry.responseContentType || 'application/json',
            requestBody: entry.requestBody || null,
            responseBody,
            contentType: entry.responseContentType || 'application/json',
            body: responseBody,
            capturedAt: Date.now(),
          });
        } catch {}
      };

      // Patch fetch — save original for future restore
      window.__opencli_orig_fetch = window.fetch;
      window.fetch = async function(...args) {
        const req = args[0];
        const init = args[1] || {};
        const reqUrl = typeof req === 'string' ? req : (req instanceof Request ? req.url : String(req));
        const method = (init?.method || (req instanceof Request ? req.method : 'GET') || 'GET');
        const requestContentType = (() => {
          if (init?.headers) {
            try {
              const headers = new Headers(init.headers);
              const value = headers.get('content-type');
              if (value) return value;
            } catch {}
          }
          if (req instanceof Request) {
            return req.headers.get('content-type');
          }
          return null;
        })();
        const requestBodyText = (() => {
          if (typeof init?.body === 'string') return init.body;
          return null;
        })();
        const shouldReadRequestBodyFromRequest = req instanceof Request
          && !requestBodyText
          && ['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())
          && (() => {
            const normalized = String(requestContentType || '').toLowerCase();
            return normalized.includes('application/json') || normalized.includes('+json');
          })();
        let requestBodyTextFromRequest = null;
        if (shouldReadRequestBodyFromRequest) {
          try {
            requestBodyTextFromRequest = await req.clone().text();
          } catch {}
        }
        const requestBody = _tryParseJson(requestContentType, requestBodyText || requestBodyTextFromRequest);
        const res = await window.__opencli_orig_fetch.apply(this, args);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          try {
            const responseBody = await res.clone().json();
            _push({
              url: reqUrl,
              method,
              requestContentType,
              requestBody,
              responseContentType: ct,
              responseBody,
            });
          } catch {}
        }
        return res;
      };

      // Patch XHR — save originals for future restore
      const _XHR = XMLHttpRequest.prototype;
      window.__opencli_orig_xhr_open = _XHR.open;
      window.__opencli_orig_xhr_send = _XHR.send;
      window.__opencli_orig_xhr_set_request_header = _XHR.setRequestHeader;
      _XHR.open = function(method, url) {
        this.__rec_url = String(url);
        this.__rec_method = String(method);
        this.__rec_request_content_type = null;
        this.__rec_listener_added = false;  // reset per open() call
        return window.__opencli_orig_xhr_open.apply(this, arguments);
      };
      _XHR.setRequestHeader = function(name, value) {
        if (String(name).toLowerCase() === 'content-type') {
          this.__rec_request_content_type = String(value);
        }
        return window.__opencli_orig_xhr_set_request_header.apply(this, arguments);
      };
      _XHR.send = function() {
        const requestBody = _tryParseJson(this.__rec_request_content_type, typeof arguments[0] === 'string' ? arguments[0] : null);
        // Guard: only add one listener per XHR instance to prevent duplicate captures
        if (!this.__rec_listener_added) {
          this.__rec_listener_added = true;
          this.addEventListener('load', function() {
            const ct = this.getResponseHeader?.('content-type') || '';
            if (ct.includes('json')) {
              try {
                _push({
                  url: this.__rec_url,
                  method: this.__rec_method || 'GET',
                  requestContentType: this.__rec_request_content_type,
                  requestBody,
                  responseContentType: ct,
                  responseBody: JSON.parse(this.responseText),
                });
              } catch {}
            }
          });
        }
        return window.__opencli_orig_xhr_send.apply(this, arguments);
      };

      window.__opencli_record_patched = true;
      return 1;
    })()
  `;
}

/** Read and clear captured requests from the page */
function generateReadRecordedJs(): string {
  return `
    (() => {
      const data = window.__opencli_record || [];
      window.__opencli_record = [];
      return data;
    })()
  `;
}

// ── Analysis helpers ───────────────────────────────────────────────────────

/** Check whether one recorded request is safe to treat as a write candidate. */
function isWriteCandidate(req: RecordedRequest): boolean {
  return ['POST', 'PUT', 'PATCH'].includes(req.method)
    && isJsonContentType(req.requestContentType)
    && !!req.requestBody
    && typeof req.requestBody === 'object'
    && !Array.isArray(req.requestBody)
    && !!req.responseBody
    && typeof req.responseBody === 'object'
    && !Array.isArray(req.responseBody);
}

/** Analyze recorded requests into read and write candidates, filtering out noise. */
export function analyzeRecordedRequests(requests: RecordedRequest[]): { candidates: RecordedCandidate[] } {
  const candidates: RecordedCandidate[] = [];
  for (const req of requests) {
    if (isNoiseUrl(req.url)) continue;
    const arrayResult = findArrayPath(req.responseBody);
    if (isWriteCandidate(req)) {
      candidates.push({ kind: 'write', req, arrayResult: null });
      continue;
    }
    if (arrayResult) {
      candidates.push({ kind: 'read', req, arrayResult });
    }
  }
  return { candidates };
}

// ── YAML generation ────────────────────────────────────────────────────────

function buildRecordedYaml(
  site: string,
  pageUrl: string,
  req: RecordedRequest,
  capName: string,
  arrayResult: ReturnType<typeof findArrayPath>,
  authIndicators: string[],
): { name: string; yaml: unknown } {
  const strategy = inferStrategy(authIndicators);
  const domain = (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })();

  // Detect fields from first array item
  const detectedFields: Record<string, string> = {};
  if (arrayResult?.items[0] && typeof arrayResult.items[0] === 'object') {
    const sampleKeys = Object.keys(arrayResult.items[0] as object).map(k => k.toLowerCase());
    for (const [role, aliases] of Object.entries(FIELD_ROLES)) {
      const match = aliases.find(a => sampleKeys.includes(a));
      if (match) detectedFields[role] = match;
    }
  }

  const itemPath = arrayResult?.path ?? null;
  // When path is '' (root-level array), access data directly; otherwise chain with optional chaining
  const pathChain = itemPath === null
    ? ''
    : itemPath === ''
      ? ''
      : itemPath.split('.').map(p => `?.${p}`).join('');

  // Detect search/limit/page params (must be before fetch URL building to use hasSearch/hasPage)
  const { hasSearch, hasPagination: hasPage } = classifyQueryParams(req.url);

  // Build evaluate script
  const mapLines = Object.entries(detectedFields)
    .map(([role, field]) => `          ${role}: item?.${field}`)
    .join(',\n');
  const mapExpr = mapLines
    ? `.map(item => ({\n${mapLines}\n        }))`
    : '';

  // Build fetch URL — for search/page args, replace query param values with template vars
  let fetchUrl = req.url;
  try {
    const u = new URL(req.url);
    if (hasSearch) {
      for (const p of SEARCH_PARAMS) {
        if (u.searchParams.has(p)) { u.searchParams.set(p, '${{ args.keyword }}'); break; }
      }
    }
    if (hasPage) {
      for (const p of PAGINATION_PARAMS) {
        if (u.searchParams.has(p)) { u.searchParams.set(p, '${{ args.page | default(1) }}'); break; }
      }
    }
    fetchUrl = u.toString();
    fetchUrl = fetchUrl
      .replaceAll(encodeURIComponent('${{ args.keyword }}'), '${{ args.keyword }}')
      .replaceAll('%24%7B%7B+args.keyword+%7D%7D', '${{ args.keyword }}')
      .replaceAll(encodeURIComponent('${{ args.page | default(1) }}'), '${{ args.page | default(1) }}');
    fetchUrl = fetchUrl.replaceAll('%24%7B%7B+args.page+%7C+default%281%29+%7D%7D', '${{ args.page | default(1) }}');
  } catch {}

  // When itemPath is empty, the array IS the response root; otherwise chain with ?.
  const dataAccess = pathChain ? `data${pathChain}` : 'data';

  const evaluateScript = [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(fetchUrl)}, { credentials: 'include' });`,
    '  const data = await res.json();',
    `  return (${dataAccess} || [])${mapExpr};`,
    '})()',
  ].join('\n');

  const args: Record<string, unknown> = {};
  if (hasSearch) args['keyword'] = { type: 'str', required: true, description: 'Search keyword', positional: true };
  args['limit'] = { type: 'int', default: 20, description: 'Number of items' };
  if (hasPage) args['page'] = { type: 'int', default: 1, description: 'Page number' };

  const columns = ['rank', ...Object.keys(detectedFields).length ? Object.keys(detectedFields) : ['title', 'url']];

  const mapStep: Record<string, string> = { rank: '${{ index + 1 }}' };
  for (const col of columns.filter(c => c !== 'rank')) {
    mapStep[col] = `\${{ item.${col} }}`;
  }

  const pipeline: unknown[] = [
    { navigate: pageUrl },
    { evaluate: evaluateScript },
    { map: mapStep },
    { limit: '${{ args.limit | default(20) }}' },
  ];

  return {
    name: capName,
    yaml: {
      site,
      name: capName,
      description: `${site} ${capName} (recorded)`,
      domain,
      strategy,
      browser: true,
      args,
      pipeline,
      columns,
    },
  };
}

/** Build a minimal YAML candidate for replayable JSON write requests. */
export function buildWriteRecordedYaml(
  site: string,
  pageUrl: string,
  req: RecordedRequest,
  capName: string,
): { name: string; yaml: unknown } {
  const responseColumns = req.responseBody && typeof req.responseBody === 'object' && !Array.isArray(req.responseBody)
    ? Object.keys(req.responseBody as Record<string, unknown>).slice(0, 6)
    : ['ok'];

  const evaluateScript = [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(req.url)}, {`,
    `    method: ${JSON.stringify(req.method)},`,
    `    credentials: 'include',`,
    `    headers: { 'content-type': ${JSON.stringify(req.requestContentType ?? 'application/json')} },`,
    `    body: JSON.stringify(${JSON.stringify(req.requestBody)}),`,
    '  });',
    '  return await res.json();',
    '})()',
  ].join('\n');

  return {
    name: capName,
    yaml: {
      site,
      name: capName,
      description: `${site} ${capName} (recorded write)`,
      domain: (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })(),
      strategy: 'cookie',
      browser: true,
      args: {},
      pipeline: [
        { navigate: pageUrl },
        { evaluate: evaluateScript },
      ],
      columns: responseColumns.length ? responseColumns : ['ok'],
    },
  };
}

/** Turn recorded requests into YAML-ready read and write candidates. */
export function generateRecordedCandidates(
  site: string,
  pageUrl: string,
  requests: RecordedRequest[],
): GeneratedRecordedCandidate[] {
  const analysis = analyzeRecordedRequests(dedupeRecordedRequests(requests));
  const deduped = new Map<string, RecordedCandidate>();
  for (const candidate of analysis.candidates) {
    const key = getRecordedCandidateKey(candidate);
    const current = deduped.get(key);
    deduped.set(key, current ? preferRecordedCandidate(current, candidate) : candidate);
  }

  // Sort reads by array item count (richer data first), then take top 5
  const selected = [...deduped.values()]
    .sort((a, b) => (b.arrayResult?.items.length ?? 0) - (a.arrayResult?.items.length ?? 0))
    .slice(0, 5);

  const usedNames = new Set<string>();
  return selected.map((candidate) => {
    let capName = inferCapabilityName(candidate.req.url);
    if (usedNames.has(capName)) capName = `${capName}_${usedNames.size + 1}`;
    usedNames.add(capName);

    const authIndicators = detectAuthFromContent(candidate.req.url, candidate.req.responseBody);
    const strategy = candidate.kind === 'write' ? 'cookie' : inferStrategy(authIndicators);
    const yamlCandidate = candidate.kind === 'write'
      ? buildWriteRecordedYaml(site, pageUrl, candidate.req, capName)
      : buildRecordedYaml(site, pageUrl, candidate.req, capName, candidate.arrayResult!, authIndicators);
    return {
      kind: candidate.kind,
      name: yamlCandidate.name,
      strategy,
      yaml: yamlCandidate.yaml,
    };
  });
}

// ── Main record function ───────────────────────────────────────────────────

export interface RecordOptions {
  BrowserFactory: new () => { connect(o?: unknown): Promise<IPage>; close(): Promise<void> };
  site?: string;
  url: string;
  outDir?: string;
  pollMs?: number;
  timeoutMs?: number;
}

export async function recordSession(opts: RecordOptions): Promise<RecordResult> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const allRequests: RecordedRequest[] = [];
  // Track which tabIds have already had the interceptor injected
  const injectedTabs = new Set<number>();

  // Infer site name from URL
  const site = opts.site ?? (() => {
    try {
      const host = new URL(opts.url).hostname.toLowerCase().replace(/^www\./, '');
      return host.split('.')[0] ?? 'site';
    } catch { return 'site'; }
  })();

  const workspace = `record:${site}`;

  console.log(chalk.bold.cyan('\n  opencli record'));
  console.log(chalk.dim(`  Site: ${site}  URL: ${opts.url}`));
  console.log(chalk.dim(`  Timeout: ${timeoutMs / 1000}s  Poll: ${pollMs}ms`));
  console.log(chalk.dim('  Navigating…'));

  const factory = new opts.BrowserFactory();
  const page = await factory.connect({ timeout: 30, workspace });

  try {
    // Navigate to target
    await page.goto(opts.url);

    // Inject into initial tab
    const initialTabs = await listTabs(workspace);
    for (const tab of initialTabs) {
      await injectIntoTab(workspace, tab.tabId, injectedTabs);
    }

    console.log(chalk.bold('\n  Recording. Use the page in the browser automation window.'));
    console.log(chalk.dim(`  Will auto-stop after ${timeoutMs / 1000}s, or press Enter to stop now.\n`));

    // Race: Enter key vs timeout
    let stopped = false;
    const stop = () => { stopped = true; };

    const { promise: enterPromise, cleanup: cleanupEnter } = waitForEnter();
    enterPromise.then(stop);
    const timeoutPromise = new Promise<void>(r => setTimeout(() => {
      stop();
      r();
    }, timeoutMs));

    // Poll loop: drain captured data + inject interceptor into any new tabs
    const pollInterval = setInterval(async () => {
      if (stopped) return;
      try {
        // Discover and inject into any new tabs
        const tabs = await listTabs(workspace);
        for (const tab of tabs) {
          await injectIntoTab(workspace, tab.tabId, injectedTabs);
        }

        // Drain captured data from all known tabs
        for (const tabId of injectedTabs) {
          const batch = await execOnTab(workspace, tabId, generateReadRecordedJs()) as RecordedRequest[] | null;
          if (Array.isArray(batch) && batch.length > 0) {
            for (const r of batch) allRequests.push(r);
            console.log(chalk.dim(`  [tab:${tabId}] +${batch.length} captured — total: ${allRequests.length}`));
          }
        }
      } catch {
        // Tab may have navigated; keep going
      }
    }, pollMs);

    await Promise.race([enterPromise, timeoutPromise]);
    cleanupEnter(); // Always clean up readline to prevent process from hanging
    clearInterval(pollInterval);

    // Final drain from all known tabs
    for (const tabId of injectedTabs) {
      try {
        const last = await execOnTab(workspace, tabId, generateReadRecordedJs()) as RecordedRequest[] | null;
        if (Array.isArray(last) && last.length > 0) {
          for (const r of last) allRequests.push(r);
        }
      } catch {}
    }

    console.log(chalk.dim(`\n  Stopped. Analyzing ${allRequests.length} captured requests…`));

    const result = analyzeAndWrite(site, opts.url, allRequests, opts.outDir);
    await factory.close().catch(() => {});
    return result;
  } catch (err) {
    await factory.close().catch(() => {});
    throw err;
  }
}

// ── Tab helpers ────────────────────────────────────────────────────────────

interface TabInfo { tabId: number; url?: string }

async function listTabs(workspace: string): Promise<TabInfo[]> {
  try {
    const result = await sendCommand('tabs', { op: 'list', workspace }) as TabInfo[] | null;
    return Array.isArray(result) ? result.filter(t => t.tabId != null) : [];
  } catch { return []; }
}

async function execOnTab(workspace: string, tabId: number, code: string): Promise<unknown> {
  return sendCommand('exec', { code, workspace, tabId });
}

async function injectIntoTab(workspace: string, tabId: number, injectedTabs: Set<number>): Promise<void> {
  try {
    await execOnTab(workspace, tabId, generateFullCaptureInterceptorJs());
    if (!injectedTabs.has(tabId)) {
      injectedTabs.add(tabId);
      console.log(chalk.green(`  ✓  Interceptor injected into tab:${tabId}`));
    }
  } catch {
    // Tab not debuggable (e.g. chrome:// pages) — skip silently
  }
}

/**
 * Wait for user to press Enter on stdin.
 * Returns both a promise and a cleanup fn so the caller can close the interface
 * when a timeout fires (preventing the process from hanging on stdin).
 */
function waitForEnter(): { promise: Promise<void>; cleanup: () => void } {
  let rl: readline.Interface | null = null;
  const promise = new Promise<void>((resolve) => {
    rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => { rl?.close(); rl = null; resolve(); });
    // Handle Ctrl+C gracefully
    rl.once('SIGINT', () => { rl?.close(); rl = null; resolve(); });
  });
  return {
    promise,
    cleanup: () => { rl?.close(); rl = null; },
  };
}

// ── Analysis + output ──────────────────────────────────────────────────────

function analyzeAndWrite(
  site: string,
  pageUrl: string,
  requests: RecordedRequest[],
  outDir?: string,
): RecordResult {
  const targetDir = outDir ?? path.join('.opencli', 'record', site);
  fs.mkdirSync(targetDir, { recursive: true });

  if (requests.length === 0) {
    console.log(chalk.yellow('  No API requests captured.'));
    return { site, url: pageUrl, requests: [], outDir: targetDir, candidateCount: 0, candidates: [] };
  }

  // Score and rank deduplicated requests for console output and candidate generation.
  const analysisRequests = dedupeRecordedRequests(requests);
  const analysis = analyzeRecordedRequests(analysisRequests);

  // Save raw captured data
  fs.writeFileSync(
    path.join(targetDir, 'captured.json'),
    JSON.stringify({ site, url: pageUrl, capturedAt: new Date().toISOString(), requests }, null, 2),
  );

  // Generate candidate YAMLs (top 5)
  const candidates: RecordResult['candidates'] = [];
  const usedNames = new Set<string>();

  console.log(chalk.bold('\n  Captured endpoints:\n'));

  for (const entry of analysis.candidates.sort((a, b) => (b.arrayResult?.items.length ?? 0) - (a.arrayResult?.items.length ?? 0)).slice(0, 8)) {
    const itemCount = entry.arrayResult?.items.length ?? 0;
    const strategy = entry.kind === 'write'
      ? 'cookie'
      : inferStrategy(detectAuthFromContent(entry.req.url, entry.req.responseBody));
    const marker = entry.kind === 'write' ? chalk.magenta('✎') : itemCount > 5 ? chalk.green('★') : chalk.dim('·');
    console.log(
      `  ${marker} ${chalk.white(urlToPattern(entry.req.url))}` +
      chalk.dim(` [${strategy}]`) +
      (entry.kind === 'write'
        ? chalk.magenta(' ← write')
        : itemCount ? chalk.cyan(` ← ${itemCount} items`) : ''),
    );
  }

  console.log();

  const topCandidates = generateRecordedCandidates(site, pageUrl, analysisRequests);
  const candidatesDir = path.join(targetDir, 'candidates');
  fs.mkdirSync(candidatesDir, { recursive: true });

  for (const entry of topCandidates) {
    if (usedNames.has(entry.name)) continue;
    usedNames.add(entry.name);

    const filePath = path.join(candidatesDir, `${entry.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry.yaml, null, 2));
    candidates.push({ name: entry.name, path: filePath, strategy: entry.strategy });

    console.log(chalk.green(`  ✓ Generated: ${chalk.bold(entry.name)}.json  [${entry.strategy}]`));
    console.log(chalk.dim(`    → ${filePath}`));
  }

  if (candidates.length === 0) {
    console.log(chalk.yellow('  No candidates found.'));
    console.log(chalk.dim('  Tip: make sure you triggered JSON API calls (open lists, search, scroll).'));
  }

  return {
    site,
    url: pageUrl,
    requests,
    outDir: targetDir,
    candidateCount: candidates.length,
    candidates,
  };
}

export function renderRecordSummary(result: RecordResult): string {
  const lines = [
    `\n  opencli record: ${result.candidateCount > 0 ? chalk.green('OK') : chalk.yellow('no candidates')}`,
    `  Site: ${result.site}`,
    `  Captured: ${result.requests.length} requests`,
    `  Candidates: ${result.candidateCount}`,
  ];
  for (const c of result.candidates) {
    lines.push(`    • ${c.name} [${c.strategy}] → ${c.path}`);
  }
  if (result.candidateCount > 0) {
    lines.push('');
    lines.push(chalk.dim(`  Copy a candidate to clis/${result.site}/ and run: npm run build`));
  }
  return lines.join('\n');
}
