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
import yaml from 'js-yaml';
import { sendCommand } from './browser/daemon-client.js';
import type { IPage } from './types.js';
import {
  VOLATILE_PARAMS,
  SEARCH_PARAMS,
  PAGINATION_PARAMS,
  FIELD_ROLES,
} from './constants.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RecordedRequest {
  url: string;
  method: string;
  status: number | null;
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

// ── Interceptor JS ─────────────────────────────────────────────────────────

/**
 * Generates a full-capture interceptor that stores {url, method, status, body}
 * for every JSON response. No URL pattern filter — captures everything.
 */
function generateFullCaptureInterceptorJs(): string {
  return `
    (() => {
      // Restore original fetch/XHR if previously patched, then re-patch (idempotent injection)
      if (window.__opencli_record_patched) {
        if (window.__opencli_orig_fetch) window.fetch = window.__opencli_orig_fetch;
        if (window.__opencli_orig_xhr_open) XMLHttpRequest.prototype.open = window.__opencli_orig_xhr_open;
        if (window.__opencli_orig_xhr_send) XMLHttpRequest.prototype.send = window.__opencli_orig_xhr_send;
        window.__opencli_record_patched = false;
      }
      // Preserve existing capture buffer across re-injections
      window.__opencli_record = window.__opencli_record || [];

      const _push = (url, method, body) => {
        try {
          // Only capture JSON-like responses
          if (typeof body !== 'object' || body === null) return;
          // Skip tiny/trivial responses (tracking pixels, empty acks)
          const keys = Object.keys(body);
          if (keys.length < 2) return;
          window.__opencli_record.push({
            url: String(url),
            method: String(method).toUpperCase(),
            status: null,
            body,
            ts: Date.now(),
          });
        } catch {}
      };

      // Patch fetch — save original for future restore
      window.__opencli_orig_fetch = window.fetch;
      window.fetch = async function(...args) {
        const req = args[0];
        const reqUrl = typeof req === 'string' ? req : (req instanceof Request ? req.url : String(req));
        const method = (args[1]?.method || (req instanceof Request ? req.method : 'GET') || 'GET');
        const res = await window.__opencli_orig_fetch.apply(this, args);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          try {
            const body = await res.clone().json();
            _push(reqUrl, method, body);
          } catch {}
        }
        return res;
      };

      // Patch XHR — save originals for future restore
      const _XHR = XMLHttpRequest.prototype;
      window.__opencli_orig_xhr_open = _XHR.open;
      window.__opencli_orig_xhr_send = _XHR.send;
      _XHR.open = function(method, url) {
        this.__rec_url = String(url);
        this.__rec_method = String(method);
        return window.__opencli_orig_xhr_open.apply(this, arguments);
      };
      _XHR.send = function() {
        this.addEventListener('load', function() {
          const ct = this.getResponseHeader?.('content-type') || '';
          if (ct.includes('json')) {
            try { _push(this.__rec_url, this.__rec_method || 'GET', JSON.parse(this.responseText)); } catch {}
          }
        });
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

function urlToPattern(url: string): string {
  try {
    const p = new URL(url);
    const pathNorm = p.pathname
      .replace(/\/\d+/g, '/{id}')
      .replace(/\/[0-9a-fA-F]{8,}/g, '/{hex}')
      .replace(/\/BV[a-zA-Z0-9]{10}/g, '/{bvid}');
    const params: string[] = [];
    p.searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) params.push(k); });
    return `${p.host}${pathNorm}${params.length ? '?' + params.sort().map(k => `${k}={}`).join('&') : ''}`;
  } catch { return url; }
}

function detectAuthIndicators(url: string, body: unknown): string[] {
  const indicators: string[] = [];
  // Heuristic: if body contains sign/w_rid fields, it's likely signed
  if (body && typeof body === 'object') {
    const keys = Object.keys(body as object).map(k => k.toLowerCase());
    if (keys.some(k => k.includes('sign') || k === 'w_rid' || k.includes('token'))) {
      indicators.push('signature');
    }
  }
  // Check URL for common auth patterns
  if (url.includes('/wbi/') || url.includes('w_rid=')) indicators.push('signature');
  if (url.includes('bearer') || url.includes('access_token')) indicators.push('bearer');
  return indicators;
}

function findArrayPath(obj: unknown, depth = 0): { path: string; items: unknown[] } | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj.some(i => i && typeof i === 'object' && !Array.isArray(i))) {
      return { path: '', items: obj };
    }
    return null;
  }
  let best: { path: string; items: unknown[] } | null = null;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const found = findArrayPath(val, depth + 1);
    if (found) {
      const fullPath = found.path ? `${key}.${found.path}` : key;
      const candidate = { path: fullPath, items: found.items };
      if (!best || candidate.items.length > best.items.length) best = candidate;
    }
  }
  return best;
}

function inferCapabilityName(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('hot') || u.includes('popular') || u.includes('ranking') || u.includes('trending')) return 'hot';
  if (u.includes('search')) return 'search';
  if (u.includes('feed') || u.includes('timeline') || u.includes('dynamic')) return 'feed';
  if (u.includes('comment') || u.includes('reply')) return 'comments';
  if (u.includes('history')) return 'history';
  if (u.includes('profile') || u.includes('me')) return 'me';
  if (u.includes('favorite') || u.includes('collect') || u.includes('bookmark')) return 'favorite';
  try {
    const segs = new URL(url).pathname
      .split('/')
      .filter(s => s && !s.match(/^\d+$/) && !s.match(/^[0-9a-f]{8,}$/i) && !s.match(/^v\d+$/));
    if (segs.length) return segs[segs.length - 1].replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch {}
  return 'data';
}

function inferStrategy(authIndicators: string[]): string {
  if (authIndicators.includes('signature')) return 'intercept';
  if (authIndicators.includes('bearer') || authIndicators.includes('csrf')) return 'header';
  return 'cookie';
}

function scoreRequest(req: RecordedRequest, arrayResult: ReturnType<typeof findArrayPath> | null): number {
  let s = 0;
  if (arrayResult) {
    s += 10;
    s += Math.min(arrayResult.items.length, 10);
    // Bonus for detected semantic fields
    const sample = arrayResult.items[0];
    if (sample && typeof sample === 'object') {
      const keys = Object.keys(sample as object).map(k => k.toLowerCase());
      for (const aliases of Object.values(FIELD_ROLES)) {
        if (aliases.some(a => keys.includes(a))) s += 2;
      }
    }
  }
  if (req.url.includes('/api/')) s += 3;
  // Penalize likely tracking / analytics endpoints
  if (req.url.match(/\/(track|log|analytics|beacon|pixel|stats|metric)/i)) s -= 10;
  if (req.url.match(/\/(ping|heartbeat|keep.?alive)/i)) s -= 10;
  return s;
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

  const itemPath = arrayResult?.path || 'data';
  const pathChain = itemPath.split('.').map(p => `?.${p}`).join('');

  // Build evaluate script
  const mapLines = Object.entries(detectedFields)
    .map(([role, field]) => `          ${role}: item?.${field}`)
    .join(',\n');
  const mapExpr = mapLines
    ? `.map(item => ({\n${mapLines}\n        }))`
    : '';

  const evaluateScript = [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(req.url)}, { credentials: 'include' });`,
    '  const data = await res.json();',
    `  return (data${pathChain} || [])${mapExpr};`,
    '})()',
  ].join('\n');

  // Detect search/limit/page params
  const qp: string[] = [];
  try { new URL(req.url).searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) qp.push(k); }); } catch {}
  const hasSearch = qp.some(p => SEARCH_PARAMS.has(p));
  const hasPage = qp.some(p => PAGINATION_PARAMS.has(p));

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

    console.log(chalk.bold('\n  Recording. Operate the page in the automation window.'));
    console.log(chalk.dim(`  Will auto-stop after ${timeoutMs / 1000}s, or press Enter to stop now.\n`));

    // Race: Enter key vs timeout
    let stopped = false;
    const stop = () => { stopped = true; };

    const enterPromise = waitForEnter().then(stop);
    const timeoutPromise = new Promise<void>(r => setTimeout(() => { stop(); r(); }, timeoutMs));

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

/** Wait for user to press Enter on stdin */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => { rl.close(); resolve(); });
    // Handle Ctrl+C gracefully
    rl.once('SIGINT', () => { rl.close(); resolve(); });
  });
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

  // Deduplicate by pattern
  const seen = new Map<string, RecordedRequest>();
  for (const req of requests) {
    const pattern = urlToPattern(req.url);
    if (!seen.has(pattern)) seen.set(pattern, req);
  }

  // Score and rank unique requests
  type ScoredEntry = {
    req: RecordedRequest;
    pattern: string;
    arrayResult: ReturnType<typeof findArrayPath>;
    authIndicators: string[];
    score: number;
  };

  const scored: ScoredEntry[] = [];
  for (const [pattern, req] of seen) {
    const arrayResult = findArrayPath(req.body);
    const authIndicators = detectAuthIndicators(req.url, req.body);
    const score = scoreRequest(req, arrayResult);
    if (score > 0) {
      scored.push({ req, pattern, arrayResult, authIndicators, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Save raw captured data
  fs.writeFileSync(
    path.join(targetDir, 'captured.json'),
    JSON.stringify({ site, url: pageUrl, capturedAt: new Date().toISOString(), requests }, null, 2),
  );

  // Generate candidate YAMLs (top 5)
  const candidates: RecordResult['candidates'] = [];
  const usedNames = new Set<string>();

  console.log(chalk.bold('\n  Captured endpoints (scored):\n'));

  for (const entry of scored.slice(0, 8)) {
    const itemCount = entry.arrayResult?.items.length ?? 0;
    const strategy = inferStrategy(entry.authIndicators);
    const marker = entry.score >= 15 ? chalk.green('★') : entry.score >= 8 ? chalk.yellow('◆') : chalk.dim('·');
    console.log(
      `  ${marker} ${chalk.white(entry.pattern)}` +
      chalk.dim(` [${strategy}]`) +
      (itemCount ? chalk.cyan(` ← ${itemCount} items`) : ''),
    );
  }

  console.log();

  const topCandidates = scored.filter(e => e.arrayResult && e.score >= 8).slice(0, 5);
  const candidatesDir = path.join(targetDir, 'candidates');
  fs.mkdirSync(candidatesDir, { recursive: true });

  for (const entry of topCandidates) {
    let capName = inferCapabilityName(entry.req.url);
    if (usedNames.has(capName)) capName = `${capName}_${usedNames.size + 1}`;
    usedNames.add(capName);

    const strategy = inferStrategy(entry.authIndicators);
    const candidate = buildRecordedYaml(site, pageUrl, entry.req, capName, entry.arrayResult!, entry.authIndicators);
    const filePath = path.join(candidatesDir, `${capName}.yaml`);
    fs.writeFileSync(filePath, yaml.dump(candidate.yaml, { sortKeys: false, lineWidth: 120 }));
    candidates.push({ name: capName, path: filePath, strategy });

    console.log(chalk.green(`  ✓ Generated: ${chalk.bold(capName)}.yaml  [${strategy}]`));
    console.log(chalk.dim(`    → ${filePath}`));
  }

  if (candidates.length === 0) {
    console.log(chalk.yellow('  No high-confidence candidates found.'));
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
    lines.push(chalk.dim(`  Copy a candidate to src/clis/${result.site}/ and run: npm run build`));
  }
  return lines.join('\n');
}
