/**
 * Deep Explore: intelligent API discovery with response analysis.
 *
 * Navigates to the target URL, auto-scrolls to trigger lazy loading,
 * captures network traffic, analyzes JSON responses, and automatically
 * infers CLI capabilities from discovered API endpoints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_BROWSER_EXPLORE_TIMEOUT, browserSession, runWithTimeout } from './runtime.js';
import type { IBrowserFactory } from './runtime.js';
import { LIMIT_PARAMS } from './constants.js';
import { detectFramework } from './scripts/framework.js';
import { discoverStores } from './scripts/store.js';
import { interactFuzz } from './scripts/interact.js';
import type { IPage } from './types.js';
import { log } from './logger.js';
import {
  urlToPattern,
  findArrayPath,
  flattenFields,
  detectFieldRoles,
  inferCapabilityName,
  inferStrategy,
  detectAuthFromHeaders,
  classifyQueryParams,
  applyUrlScoreAdjustments,
} from './analysis.js';

// ── Site name detection ────────────────────────────────────────────────────

const KNOWN_SITE_ALIASES: Record<string, string> = {
  'x.com': 'twitter', 'twitter.com': 'twitter',
  'news.ycombinator.com': 'hackernews',
  'www.zhihu.com': 'zhihu', 'www.bilibili.com': 'bilibili',
  'search.bilibili.com': 'bilibili',
  'www.v2ex.com': 'v2ex', 'www.reddit.com': 'reddit',
  'www.xiaohongshu.com': 'xiaohongshu', 'www.douban.com': 'douban',
  'www.weibo.com': 'weibo', 'www.bbc.com': 'bbc',
};

export function detectSiteName(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host in KNOWN_SITE_ALIASES) return KNOWN_SITE_ALIASES[host];
    const parts = host.split('.').filter(p => p && p !== 'www');
    if (parts.length >= 2) {
      if (['uk', 'jp', 'cn', 'com'].includes(parts[parts.length - 1]) && parts.length >= 3) {
        return slugify(parts[parts.length - 3]);
      }
      return slugify(parts[parts.length - 2]);
    }
    return parts[0] ? slugify(parts[0]) : 'site';
  } catch { return 'site'; }
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
}

// ── Network analysis ───────────────────────────────────────────────────────

interface NetworkEntry {
  method: string; url: string; status: number | null;
  contentType: string; responseBody?: unknown; requestHeaders?: Record<string, string>;
}

interface AnalyzedEndpoint {
  pattern: string; method: string; url: string; status: number | null;
  contentType: string; queryParams: string[]; score: number;
  hasSearchParam: boolean; hasPaginationParam: boolean; hasLimitParam: boolean;
  authIndicators: string[];
  responseAnalysis: { itemPath: string | null; itemCount: number; detectedFields: Record<string, string>; sampleFields: string[] } | null;
}

interface InferredCapability {
  name: string; description: string; strategy: string; confidence: number;
  endpoint: string; itemPath: string | null;
  recommendedColumns: string[];
  recommendedArgs: Array<{ name: string; type: string; required: boolean; default?: unknown }>;
  storeHint?: { store: string; action: string };
}

export interface ExploreManifest {
  site: string;
  target_url: string;
  final_url: string;
  title: string;
  framework: Record<string, boolean>;
  stores: Array<{ type: DiscoveredStore['type']; id: string; actions: string[] }>;
  top_strategy: string;
  explored_at?: string;
}

export interface ExploreAuthSummary {
  top_strategy: string;
  indicators: string[];
  framework: Record<string, boolean>;
}

export interface ExploreEndpointArtifact {
  pattern: string;
  method: string;
  url: string;
  status: number | null;
  contentType: string;
  score: number;
  queryParams: string[];
  itemPath: string | null;
  itemCount: number;
  detectedFields: Record<string, string>;
  authIndicators: string[];
}

export interface ExploreResult {
  site: string;
  target_url: string;
  final_url: string;
  title: string;
  framework: Record<string, boolean>;
  stores: DiscoveredStore[];
  top_strategy: string;
  endpoint_count: number;
  api_endpoint_count: number;
  capabilities: InferredCapability[];
  auth_indicators: string[];
  out_dir: string;
}

export interface ExploreBundle {
  manifest: ExploreManifest;
  endpoints: ExploreEndpointArtifact[];
  capabilities: InferredCapability[];
  auth: ExploreAuthSummary;
}

/**
 * Parse raw network output from browser page.
 * Handles text format: [GET] url => [200]
 */
function parseNetworkRequests(raw: unknown): NetworkEntry[] {
  if (typeof raw === 'string') {
    const entries: NetworkEntry[] = [];
    for (const line of raw.split('\n')) {
      // Format: [GET] URL => [200]
      const m = line.match(/\[?(GET|POST|PUT|DELETE|PATCH|OPTIONS)\]?\s+(\S+)\s*(?:=>|→)\s*\[?(\d+)\]?/i);
      if (m) {
        const [, method, url, status] = m;
        entries.push({
          method: method.toUpperCase(), url, status: status ? parseInt(status) : null,
          contentType: (url.includes('/api/') || url.includes('/x/') || url.endsWith('.json')) ? 'application/json' : '',
        });
      }
    }
    return entries;
  }
  if (Array.isArray(raw)) {
    return raw.filter(e => e && typeof e === 'object').map(e => {
      // Handle both legacy shape (status/contentType/responseBody) and
      // extension/CDP capture shape (responseStatus/responseContentType/responsePreview)
      let body = e.responseBody;
      if (body === undefined && e.responsePreview !== undefined) {
        const preview = e.responsePreview;
        if (typeof preview === 'string') {
          try { body = JSON.parse(preview); } catch { body = preview; }
        }
      }
      return {
        method: (e.method ?? 'GET').toUpperCase(),
        url: String(e.url ?? e.request?.url ?? e.requestUrl ?? ''),
        status: e.status ?? e.responseStatus ?? e.statusCode ?? null,
        contentType: e.contentType ?? e.responseContentType ?? e.response?.contentType ?? '',
        responseBody: body, requestHeaders: e.requestHeaders,
      };
    });
  }
  return [];
}

function analyzeResponseBody(body: unknown): AnalyzedEndpoint['responseAnalysis'] {
  if (!body || typeof body !== 'object') return null;
  const result = findArrayPath(body);
  if (!result) return null;

  const sample = result.items[0];
  const sampleFields = sample && typeof sample === 'object' ? flattenFields(sample, '', 2) : [];
  const detectedFields = detectFieldRoles(sampleFields);

  return { itemPath: result.path || null, itemCount: result.items.length, detectedFields, sampleFields };
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(v => typeof v === 'boolean');
}

function scoreEndpoint(ep: { contentType: string; responseAnalysis: AnalyzedEndpoint['responseAnalysis']; pattern: string; url: string; status: number | null; hasSearchParam: boolean; hasPaginationParam: boolean; hasLimitParam: boolean }): number {
  let s = 0;
  if (ep.contentType.includes('json')) s += 10;
  if (ep.responseAnalysis) { s += 5; s += Math.min(ep.responseAnalysis.itemCount, 10); s += Object.keys(ep.responseAnalysis.detectedFields).length * 2; }
  if (ep.hasSearchParam) s += 3;
  if (ep.hasPaginationParam) s += 2;
  if (ep.hasLimitParam) s += 2;
  if (ep.status === 200) s += 2;
  if (ep.responseAnalysis && ep.responseAnalysis.itemCount === 0 && ep.contentType.includes('json')) s -= 3;
  return applyUrlScoreAdjustments(ep.url, s);
}


// ── Framework detection ────────────────────────────────────────────────────

const FRAMEWORK_DETECT_JS = detectFramework.toString();

// ── Store discovery ────────────────────────────────────────────────────────

const STORE_DISCOVER_JS = discoverStores.toString();

export interface DiscoveredStore {
  type: 'pinia' | 'vuex';
  id: string;
  actions: string[];
  stateKeys: string[];
}

// ── Auto-Interaction (Fuzzing) ─────────────────────────────────────────────

const INTERACT_FUZZ_JS = interactFuzz.toString();

// ── Analysis helpers (extracted from exploreUrl) ───────────────────────────

/** Filter, deduplicate, and score network endpoints. */
function analyzeEndpoints(networkEntries: NetworkEntry[]): { analyzed: AnalyzedEndpoint[]; totalCount: number } {
  const seen = new Map<string, AnalyzedEndpoint>();
  for (const entry of networkEntries) {
    if (!entry.url) continue;
    const ct = entry.contentType.toLowerCase();
    if (ct.includes('image/') || ct.includes('font/') || ct.includes('css') || ct.includes('javascript') || ct.includes('wasm')) continue;
    if (entry.status && entry.status >= 400) continue;

    const pattern = urlToPattern(entry.url);
    const key = `${entry.method}:${pattern}`;
    if (seen.has(key)) continue;

    const { params: qp, hasSearch, hasPagination, hasLimit } = classifyQueryParams(entry.url);

    const ep: AnalyzedEndpoint = {
      pattern, method: entry.method, url: entry.url, status: entry.status, contentType: ct,
      queryParams: qp, hasSearchParam: hasSearch,
      hasPaginationParam: hasPagination,
      hasLimitParam: hasLimit || qp.some(p => LIMIT_PARAMS.has(p)),
      authIndicators: detectAuthFromHeaders(entry.requestHeaders),
      responseAnalysis: entry.responseBody ? analyzeResponseBody(entry.responseBody) : null,
      score: 0,
    };
    ep.score = scoreEndpoint(ep);
    seen.set(key, ep);
  }

  const analyzed = [...seen.values()].filter(ep => ep.score >= 5).sort((a, b) => b.score - a.score);
  return { analyzed, totalCount: seen.size };
}

/** Infer CLI capabilities from analyzed endpoints. */
function inferCapabilitiesFromEndpoints(
  endpoints: AnalyzedEndpoint[],
  stores: DiscoveredStore[],
  opts: { site?: string; goal?: string; url: string },
): { capabilities: InferredCapability[]; topStrategy: string; authIndicators: string[] } {
  const capabilities: InferredCapability[] = [];
  const usedNames = new Set<string>();

  for (const ep of endpoints.slice(0, 8)) {
    let capName = inferCapabilityName(ep.url, opts.goal);
    if (usedNames.has(capName)) {
      const suffix = ep.pattern.split('/').filter(s => s && !s.startsWith('{') && !s.includes('.')).pop();
      capName = suffix ? `${capName}_${suffix}` : `${capName}_${usedNames.size}`;
    }
    usedNames.add(capName);

    const cols: string[] = [];
    if (ep.responseAnalysis) {
      for (const role of ['title', 'url', 'author', 'score', 'time']) {
        if (ep.responseAnalysis.detectedFields[role]) cols.push(role);
      }
    }

    const args: InferredCapability['recommendedArgs'] = [];
    if (ep.hasSearchParam) args.push({ name: 'keyword', type: 'str', required: true });
    args.push({ name: 'limit', type: 'int', required: false, default: 20 });
    if (ep.hasPaginationParam) args.push({ name: 'page', type: 'int', required: false, default: 1 });

    const epStrategy = inferStrategy(ep.authIndicators);
    let storeHint: { store: string; action: string } | undefined;
    if ((epStrategy === 'intercept' || ep.authIndicators.includes('signature')) && stores.length > 0) {
      for (const s of stores) {
        const matchingAction = s.actions.find(a =>
          capName.split('_').some(part => a.toLowerCase().includes(part)) ||
          a.toLowerCase().includes('fetch') || a.toLowerCase().includes('get')
        );
        if (matchingAction) { storeHint = { store: s.id, action: matchingAction }; break; }
      }
    }

    capabilities.push({
      name: capName, description: `${opts.site ?? detectSiteName(opts.url)} ${capName}`,
      strategy: storeHint ? 'store-action' : epStrategy,
      confidence: Math.min(ep.score / 20, 1.0), endpoint: ep.pattern,
      itemPath: ep.responseAnalysis?.itemPath ?? null,
      recommendedColumns: cols.length ? cols : ['title', 'url'],
      recommendedArgs: args,
      ...(storeHint ? { storeHint } : {}),
    });
  }

  const allAuth = new Set(endpoints.flatMap(ep => ep.authIndicators));
  const topStrategy = allAuth.has('signature') ? 'intercept'
    : allAuth.has('bearer') || allAuth.has('csrf') ? 'header'
    : allAuth.size === 0 ? 'public' : 'cookie';

  return { capabilities, topStrategy, authIndicators: [...allAuth] };
}

/** Write explore artifacts (manifest, endpoints, capabilities, auth, stores) to disk. */
async function writeExploreArtifacts(
  targetDir: string,
  result: Omit<ExploreResult, 'out_dir'>,
  analyzedEndpoints: AnalyzedEndpoint[],
  stores: DiscoveredStore[],
): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const tasks = [
    fs.promises.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify({
      site: result.site, target_url: result.target_url, final_url: result.final_url, title: result.title,
      framework: result.framework, stores: stores.map(s => ({ type: s.type, id: s.id, actions: s.actions })),
      top_strategy: result.top_strategy, explored_at: new Date().toISOString(),
    }, null, 2)),
    fs.promises.writeFile(path.join(targetDir, 'endpoints.json'), JSON.stringify(analyzedEndpoints.map(ep => ({
      pattern: ep.pattern, method: ep.method, url: ep.url, status: ep.status,
      contentType: ep.contentType, score: ep.score, queryParams: ep.queryParams,
      itemPath: ep.responseAnalysis?.itemPath ?? null, itemCount: ep.responseAnalysis?.itemCount ?? 0,
      detectedFields: ep.responseAnalysis?.detectedFields ?? {}, authIndicators: ep.authIndicators,
    })), null, 2)),
    fs.promises.writeFile(path.join(targetDir, 'capabilities.json'), JSON.stringify(result.capabilities, null, 2)),
    fs.promises.writeFile(path.join(targetDir, 'auth.json'), JSON.stringify({
      top_strategy: result.top_strategy, indicators: result.auth_indicators, framework: result.framework,
    }, null, 2)),
  ];
  if (stores.length > 0) {
    tasks.push(fs.promises.writeFile(path.join(targetDir, 'stores.json'), JSON.stringify(stores, null, 2)));
  }
  await Promise.all(tasks);
}

// ── Main explore function ──────────────────────────────────────────────────

export async function exploreUrl(
  url: string,
  opts: {
    BrowserFactory: new () => IBrowserFactory;
    site?: string; goal?: string; authenticated?: boolean;
    outDir?: string; waitSeconds?: number; query?: string;
    clickLabels?: string[]; auto?: boolean; workspace?: string;
  },
): Promise<ExploreResult> {
  const waitSeconds = opts.waitSeconds ?? 3.0;
  const exploreTimeout = Math.max(DEFAULT_BROWSER_EXPLORE_TIMEOUT, 45.0 + waitSeconds * 8.0);

  return browserSession(opts.BrowserFactory, async (page) => {
    return runWithTimeout((async () => {
      // Step 1: Navigate
      await page.startNetworkCapture?.();
      await page.goto(url);
      await page.wait(waitSeconds);

      // Step 2: Auto-scroll to trigger lazy loading intelligently
      await page.autoScroll({ times: 3, delayMs: 1500 }).catch(() => {});

      // Step 2.5: Interactive Fuzzing (if requested)
      if (opts.auto) {
         try {
           // First: targeted clicks by label (e.g. "字幕", "CC", "评论")
           if (opts.clickLabels?.length) {
             for (const label of opts.clickLabels) {
               const safeLabel = JSON.stringify(label);
               await page.evaluate(`
                 (() => {
                   const el = [...document.querySelectorAll('button, [role="button"], [role="tab"], a, span')]
                     .find(e => e.textContent && e.textContent.trim().includes(${safeLabel}));
                   if (el) el.click();
                 })()
               `);
               await page.wait(1);
             }
           }
           // Then: blind fuzzing on generic interactive elements
           const clicks = await page.evaluate(INTERACT_FUZZ_JS);
           await page.wait(2); // wait for XHRs to settle
         } catch (e) {
           log.verbose(`Interactive fuzzing skipped: ${e instanceof Error ? e.message : String(e)}`);
         }
      }

      // Step 3: Read page metadata
      const metadata = await readPageMetadata(page);

      // Step 4: Capture network traffic
      const rawNetwork = page.readNetworkCapture
        ? await page.readNetworkCapture()
        : await page.networkRequests(false);
      const networkEntries = parseNetworkRequests(rawNetwork);

      // Step 5: For JSON endpoints missing a body, carefully re-fetch in-browser via a pristine iframe
      const jsonEndpoints = networkEntries.filter(e => e.contentType.includes('json') && e.method === 'GET' && e.status === 200 && !e.responseBody);
      await Promise.allSettled(jsonEndpoints.slice(0, 5).map(async (ep) => {
        try {
          const body = await page.evaluate(`async () => {
            let iframe = null;
            try {
              iframe = document.createElement('iframe');
              iframe.style.display = 'none';
              document.body.appendChild(iframe);
              const cleanFetch = iframe.contentWindow.fetch || window.fetch;
              const r = await cleanFetch(${JSON.stringify(ep.url)}, { credentials: 'include' });
              if (!r.ok) return null;
              const d = await r.json();
              return JSON.stringify(d).slice(0, 10000);
            } catch {
              return null;
            } finally {
              if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }
          }`);
          if (body && typeof body === 'string') { try { ep.responseBody = JSON.parse(body); } catch {} }
          else if (body && typeof body === 'object') ep.responseBody = body;
        } catch {}
      }));

      // Step 6: Detect framework
      let framework: Record<string, boolean> = {};
      try {
        const fw = await page.evaluate(FRAMEWORK_DETECT_JS);
        if (isBooleanRecord(fw)) framework = fw;
      } catch {}

      // Step 6.5: Discover stores (Pinia / Vuex)
      let stores: DiscoveredStore[] = [];
      if (framework.pinia || framework.vuex) {
        try {
          const raw = await page.evaluate(STORE_DISCOVER_JS);
          if (Array.isArray(raw)) stores = raw;
        } catch {}
      }

      // Step 7+8: Analyze endpoints and infer capabilities
      const { analyzed: analyzedEndpoints, totalCount } = analyzeEndpoints(networkEntries);
      const { capabilities, topStrategy, authIndicators } = inferCapabilitiesFromEndpoints(
        analyzedEndpoints, stores, { site: opts.site, goal: opts.goal, url },
      );

      // Step 9: Assemble result and write artifacts
      const siteName = opts.site ?? detectSiteName(metadata.url || url);
      const targetDir = opts.outDir ?? path.join('.opencli', 'explore', siteName);

      const result = {
        site: siteName, target_url: url, final_url: metadata.url, title: metadata.title,
        framework, stores, top_strategy: topStrategy,
        endpoint_count: totalCount,
        api_endpoint_count: analyzedEndpoints.length,
        capabilities, auth_indicators: authIndicators,
      };

      await writeExploreArtifacts(targetDir, result, analyzedEndpoints, stores);
      return { ...result, out_dir: targetDir };
    })(), { timeout: exploreTimeout, label: `Explore ${url}` });
  }, { workspace: opts.workspace });
}

export function renderExploreSummary(result: ExploreResult): string {
  const lines = [
    'opencli probe: OK', `Site: ${result.site}`, `URL: ${result.target_url}`,
    `Title: ${result.title || '(none)'}`, `Strategy: ${result.top_strategy}`,
    `Endpoints: ${result.endpoint_count} total, ${result.api_endpoint_count} API`,
    `Capabilities: ${result.capabilities?.length ?? 0}`,
  ];
  for (const cap of (result.capabilities ?? []).slice(0, 5)) {
    const storeInfo = cap.storeHint ? ` → ${cap.storeHint.store}.${cap.storeHint.action}()` : '';
    lines.push(`  • ${cap.name} (${cap.strategy}, ${(cap.confidence * 100).toFixed(0)}%)${storeInfo}`);
  }
  const fw = result.framework ?? {};
  const fwNames = Object.entries(fw).filter(([, v]) => v).map(([k]) => k);
  if (fwNames.length) lines.push(`Framework: ${fwNames.join(', ')}`);
  const stores: DiscoveredStore[] = result.stores ?? [];
  if (stores.length) {
    lines.push(`Stores: ${stores.length}`);
    for (const s of stores.slice(0, 5)) {
      lines.push(`  • ${s.type}/${s.id}: ${s.actions.slice(0, 5).join(', ')}${s.actions.length > 5 ? '...' : ''}`);
    }
  }
  lines.push(`Output: ${result.out_dir}`);
  return lines.join('\n');
}

async function readPageMetadata(page: IPage): Promise<{ url: string; title: string }> {
  try {
    const result = await page.evaluate(`() => ({ url: window.location.href, title: document.title || '' })`);
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return {
        url: String((result as Record<string, unknown>).url ?? ''),
        title: String((result as Record<string, unknown>).title ?? ''),
      };
    }
  } catch {}
  return { url: '', title: '' };
}
