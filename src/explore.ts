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

// ── Field & capability inference ───────────────────────────────────────────

const FIELD_ROLES: Record<string, string[]> = {
  title:    ['title', 'name', 'text', 'content', 'desc', 'description', 'headline', 'subject'],
  url:      ['url', 'uri', 'link', 'href', 'permalink', 'jump_url', 'web_url', 'share_url'],
  author:   ['author', 'username', 'user_name', 'nickname', 'nick', 'owner', 'creator', 'up_name', 'uname'],
  score:    ['score', 'hot', 'heat', 'likes', 'like_count', 'view_count', 'views', 'play', 'favorite_count', 'reply_count'],
  time:     ['time', 'created_at', 'publish_time', 'pub_time', 'date', 'ctime', 'mtime', 'pubdate', 'created'],
  id:       ['id', 'aid', 'bvid', 'mid', 'uid', 'oid', 'note_id', 'item_id'],
  cover:    ['cover', 'pic', 'image', 'thumbnail', 'poster', 'avatar'],
  category: ['category', 'tag', 'type', 'tname', 'channel', 'section'],
};

const SEARCH_PARAMS = new Set(['q', 'query', 'keyword', 'search', 'wd', 'kw', 'search_query', 'w']);
const PAGINATION_PARAMS = new Set(['page', 'pn', 'offset', 'cursor', 'next', 'page_num']);
const LIMIT_PARAMS = new Set(['limit', 'count', 'size', 'per_page', 'page_size', 'ps', 'num']);
const VOLATILE_PARAMS = new Set(['w_rid', 'wts', '_', 'callback', 'timestamp', 't', 'nonce', 'sign']);

// ── Network analysis ───────────────────────────────────────────────────────

interface NetworkEntry {
  method: string; url: string; status: number | null;
  contentType: string; responseBody?: any; requestHeaders?: Record<string, string>;
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
  recommendedArgs: Array<{ name: string; type: string; required: boolean; default?: any }>;
}

/**
 * Parse raw network output from Playwright MCP.
 * Handles text format: [GET] url => [200]
 */
function parseNetworkRequests(raw: any): NetworkEntry[] {
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
    return raw.filter(e => e && typeof e === 'object').map(e => ({
      method: (e.method ?? 'GET').toUpperCase(),
      url: String(e.url ?? e.request?.url ?? e.requestUrl ?? ''),
      status: e.status ?? e.statusCode ?? null,
      contentType: e.contentType ?? e.response?.contentType ?? '',
      responseBody: e.responseBody, requestHeaders: e.requestHeaders,
    }));
  }
  return [];
}

function urlToPattern(url: string): string {
  try {
    const p = new URL(url);
    const pathNorm = p.pathname.replace(/\/\d+/g, '/{id}').replace(/\/[0-9a-fA-F]{8,}/g, '/{hex}').replace(/\/BV[a-zA-Z0-9]{10}/g, '/{bvid}');
    const params: string[] = [];
    p.searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) params.push(k); });
    return `${p.host}${pathNorm}${params.length ? '?' + params.sort().map(k => `${k}={}`).join('&') : ''}`;
  } catch { return url; }
}

function detectAuthIndicators(headers?: Record<string, string>): string[] {
  if (!headers) return [];
  const indicators: string[] = [];
  const keys = Object.keys(headers).map(k => k.toLowerCase());
  if (keys.some(k => k === 'authorization')) indicators.push('bearer');
  if (keys.some(k => k.startsWith('x-csrf') || k.startsWith('x-xsrf'))) indicators.push('csrf');
  if (keys.some(k => k.startsWith('x-s') || k === 'x-t' || k === 'x-s-common')) indicators.push('signature');
  return indicators;
}

function analyzeResponseBody(body: any): AnalyzedEndpoint['responseAnalysis'] {
  if (!body || typeof body !== 'object') return null;
  const candidates: Array<{ path: string; items: any[] }> = [];

  function findArrays(obj: any, path: string, depth: number) {
    if (depth > 4) return;
    if (Array.isArray(obj) && obj.length >= 2 && obj.some(item => item && typeof item === 'object' && !Array.isArray(item))) {
      candidates.push({ path, items: obj });
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [key, val] of Object.entries(obj)) findArrays(val, path ? `${path}.${key}` : key, depth + 1);
    }
  }
  findArrays(body, '', 0);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.items.length - a.items.length);
  const best = candidates[0];
  const sample = best.items[0];
  const sampleFields = sample && typeof sample === 'object' ? flattenFields(sample, '', 2) : [];

  const detectedFields: Record<string, string> = {};
  for (const [role, aliases] of Object.entries(FIELD_ROLES)) {
    for (const f of sampleFields) {
      if (aliases.includes(f.split('.').pop()?.toLowerCase() ?? '')) { detectedFields[role] = f; break; }
    }
  }

  return { itemPath: best.path || null, itemCount: best.items.length, detectedFields, sampleFields };
}

function flattenFields(obj: any, prefix: string, maxDepth: number): string[] {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') return [];
  const names: string[] = [];
  for (const key of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    names.push(full);
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) names.push(...flattenFields(obj[key], full, maxDepth - 1));
  }
  return names;
}

function scoreEndpoint(ep: { contentType: string; responseAnalysis: any; pattern: string; status: number | null; hasSearchParam: boolean; hasPaginationParam: boolean; hasLimitParam: boolean }): number {
  let s = 0;
  if (ep.contentType.includes('json')) s += 10;
  if (ep.responseAnalysis) { s += 5; s += Math.min(ep.responseAnalysis.itemCount, 10); s += Object.keys(ep.responseAnalysis.detectedFields).length * 2; }
  if (ep.pattern.includes('/api/') || ep.pattern.includes('/x/')) s += 3;
  if (ep.hasSearchParam) s += 3;
  if (ep.hasPaginationParam) s += 2;
  if (ep.hasLimitParam) s += 2;
  if (ep.status === 200) s += 2;
  return s;
}

function inferCapabilityName(url: string, goal?: string): string {
  if (goal) return goal;
  const u = url.toLowerCase();
  if (u.includes('hot') || u.includes('popular') || u.includes('ranking') || u.includes('trending')) return 'hot';
  if (u.includes('search')) return 'search';
  if (u.includes('feed') || u.includes('timeline') || u.includes('dynamic')) return 'feed';
  if (u.includes('comment') || u.includes('reply')) return 'comments';
  if (u.includes('history')) return 'history';
  if (u.includes('profile') || u.includes('userinfo') || u.includes('/me')) return 'me';
  if (u.includes('favorite') || u.includes('collect') || u.includes('bookmark')) return 'favorite';
  try {
    const segs = new URL(url).pathname.split('/').filter(s => s && !s.match(/^\d+$/) && !s.match(/^[0-9a-f]{8,}$/i));
    if (segs.length) return segs[segs.length - 1].replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch {}
  return 'data';
}

function inferStrategy(authIndicators: string[]): string {
  if (authIndicators.includes('signature')) return 'intercept';
  if (authIndicators.includes('bearer') || authIndicators.includes('csrf')) return 'header';
  return 'cookie';
}

// ── Framework detection ────────────────────────────────────────────────────

const FRAMEWORK_DETECT_JS = `
  () => {
    const r = {};
    try {
      const app = document.querySelector('#app');
      r.vue3 = !!(app && app.__vue_app__);
      r.vue2 = !!(app && app.__vue__);
      r.react = !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot]');
      r.nextjs = !!window.__NEXT_DATA__;
      r.nuxt = !!window.__NUXT__;
      if (r.vue3 && app.__vue_app__) { const gp = app.__vue_app__.config?.globalProperties; r.pinia = !!(gp && gp.$pinia); r.vuex = !!(gp && gp.$store); }
    } catch {}
    return r;
  }
`;

// ── Store discovery ────────────────────────────────────────────────────────

const STORE_DISCOVER_JS = `
  () => {
    const stores = [];
    try {
      const app = document.querySelector('#app');
      if (!app?.__vue_app__) return stores;
      const gp = app.__vue_app__.config?.globalProperties;

      // Pinia stores
      const pinia = gp?.$pinia;
      if (pinia?._s) {
        pinia._s.forEach((store, id) => {
          const actions = [];
          const stateKeys = [];
          for (const k in store) {
            try {
              if (k.startsWith('$') || k.startsWith('_')) continue;
              if (typeof store[k] === 'function') actions.push(k);
              else stateKeys.push(k);
            } catch {}
          }
          stores.push({ type: 'pinia', id, actions: actions.slice(0, 20), stateKeys: stateKeys.slice(0, 15) });
        });
      }

      // Vuex store modules
      const vuex = gp?.$store;
      if (vuex?._modules?.root?._children) {
        const children = vuex._modules.root._children;
        for (const [modName, mod] of Object.entries(children)) {
          const actions = Object.keys(mod._rawModule?.actions ?? {}).slice(0, 20);
          const stateKeys = Object.keys(mod.state ?? {}).slice(0, 15);
          stores.push({ type: 'vuex', id: modName, actions, stateKeys });
        }
      }
    } catch {}
    return stores;
  }
`;

export interface DiscoveredStore {
  type: 'pinia' | 'vuex';
  id: string;
  actions: string[];
  stateKeys: string[];
}

// ── Main explore function ──────────────────────────────────────────────────

export async function exploreUrl(
  url: string,
  opts: {
    BrowserFactory: new () => any;
    site?: string; goal?: string; authenticated?: boolean;
    outDir?: string; waitSeconds?: number; query?: string;
    clickLabels?: string[]; auto?: boolean;
  },
): Promise<Record<string, any>> {
  const waitSeconds = opts.waitSeconds ?? 3.0;
  const exploreTimeout = Math.max(DEFAULT_BROWSER_EXPLORE_TIMEOUT, 45.0 + waitSeconds * 8.0);

  return browserSession(opts.BrowserFactory, async (page) => {
    return runWithTimeout((async () => {
      // Step 1: Navigate
      await page.goto(url);
      await page.wait(waitSeconds);

      // Step 2: Auto-scroll to trigger lazy loading (use keyboard since page.scroll may not exist)
      for (let i = 0; i < 3; i++) { try { await page.pressKey('End'); } catch {} await page.wait(1); }

      // Step 3: Read page metadata
      const metadata = await readPageMetadata(page);

      // Step 4: Capture network traffic
      const rawNetwork = await page.networkRequests(false);
      const networkEntries = parseNetworkRequests(rawNetwork);

      // Step 5: For JSON endpoints, re-fetch response body in-browser
      const jsonEndpoints = networkEntries.filter(e => e.contentType.includes('json') && e.method === 'GET' && e.status === 200);
      for (const ep of jsonEndpoints.slice(0, 10)) {
        try {
          const body = await page.evaluate(`async () => { try { const r = await fetch(${JSON.stringify(ep.url)}, {credentials:'include'}); if (!r.ok) return null; const d = await r.json(); return JSON.stringify(d).slice(0,10000); } catch { return null; } }`);
          if (body && typeof body === 'string') { try { ep.responseBody = JSON.parse(body); } catch {} }
          else if (body && typeof body === 'object') ep.responseBody = body;
        } catch {}
      }

      // Step 6: Detect framework
      let framework: Record<string, boolean> = {};
      try { const fw = await page.evaluate(FRAMEWORK_DETECT_JS); if (fw && typeof fw === 'object') framework = fw; } catch {}

      // Step 6.5: Discover stores (Pinia / Vuex)
      let stores: DiscoveredStore[] = [];
      if (framework.pinia || framework.vuex) {
        try {
          const raw = await page.evaluate(STORE_DISCOVER_JS);
          if (Array.isArray(raw)) stores = raw;
        } catch {}
      }

      // Step 7: Analyze endpoints
      const seen = new Map<string, AnalyzedEndpoint>();
      for (const entry of networkEntries) {
        if (!entry.url) continue;
        const ct = entry.contentType.toLowerCase();
        if (ct.includes('image/') || ct.includes('font/') || ct.includes('css') || ct.includes('javascript') || ct.includes('wasm')) continue;
        if (entry.status && entry.status >= 400) continue;

        const pattern = urlToPattern(entry.url);
        const key = `${entry.method}:${pattern}`;
        if (seen.has(key)) continue;

        const qp: string[] = [];
        try { new URL(entry.url).searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) qp.push(k); }); } catch {}

        const ep: AnalyzedEndpoint = {
          pattern, method: entry.method, url: entry.url, status: entry.status, contentType: ct,
          queryParams: qp, hasSearchParam: qp.some(p => SEARCH_PARAMS.has(p)),
          hasPaginationParam: qp.some(p => PAGINATION_PARAMS.has(p)),
          hasLimitParam: qp.some(p => LIMIT_PARAMS.has(p)),
          authIndicators: detectAuthIndicators(entry.requestHeaders),
          responseAnalysis: entry.responseBody ? analyzeResponseBody(entry.responseBody) : null,
          score: 0,
        };
        ep.score = scoreEndpoint(ep);
        seen.set(key, ep);
      }

      const analyzedEndpoints = [...seen.values()].filter(ep => ep.score >= 5).sort((a, b) => b.score - a.score);

      // Step 8: Infer capabilities
      const capabilities: InferredCapability[] = [];
      const usedNames = new Set<string>();
      for (const ep of analyzedEndpoints.slice(0, 8)) {
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

        // Link store actions to capabilities when store-action strategy is recommended
        const epStrategy = inferStrategy(ep.authIndicators);
        let storeHint: { store: string; action: string } | undefined;
        if ((epStrategy === 'intercept' || ep.authIndicators.includes('signature')) && stores.length > 0) {
          // Try to find a store/action that matches this endpoint's purpose
          for (const s of stores) {
            const matchingAction = s.actions.find(a =>
              capName.split('_').some(part => a.toLowerCase().includes(part)) ||
              a.toLowerCase().includes('fetch') || a.toLowerCase().includes('get')
            );
            if (matchingAction) {
              storeHint = { store: s.id, action: matchingAction };
              break;
            }
          }
        }

        capabilities.push({
          name: capName, description: `${opts.site ?? detectSiteName(url)} ${capName}`,
          strategy: storeHint ? 'store-action' : epStrategy,
          confidence: Math.min(ep.score / 20, 1.0), endpoint: ep.pattern,
          itemPath: ep.responseAnalysis?.itemPath ?? null,
          recommendedColumns: cols.length ? cols : ['title', 'url'],
          recommendedArgs: args,
          ...(storeHint ? { storeHint } : {}),
        });
      }

      // Step 9: Determine overall auth strategy
      const allAuth = new Set(analyzedEndpoints.flatMap(ep => ep.authIndicators));
      const topStrategy = allAuth.has('signature') ? 'intercept' : allAuth.has('bearer') || allAuth.has('csrf') ? 'header' : allAuth.size === 0 ? 'public' : 'cookie';

      const siteName = opts.site ?? detectSiteName(metadata.url || url);
      const targetDir = opts.outDir ?? path.join('.opencli', 'explore', siteName);
      fs.mkdirSync(targetDir, { recursive: true });

      const result = {
        site: siteName, target_url: url, final_url: metadata.url, title: metadata.title,
        framework, stores, top_strategy: topStrategy,
        endpoint_count: analyzedEndpoints.length + [...seen.values()].filter(ep => ep.score < 5).length,
        api_endpoint_count: analyzedEndpoints.length,
        capabilities, auth_indicators: [...allAuth],
      };

      // Write artifacts
      fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
        site: siteName, target_url: url, final_url: metadata.url, title: metadata.title,
        framework, stores: stores.map(s => ({ type: s.type, id: s.id, actions: s.actions })),
        top_strategy: topStrategy, explored_at: new Date().toISOString(),
      }, null, 2));
      fs.writeFileSync(path.join(targetDir, 'endpoints.json'), JSON.stringify(analyzedEndpoints.map(ep => ({
        pattern: ep.pattern, method: ep.method, url: ep.url, status: ep.status,
        contentType: ep.contentType, score: ep.score, queryParams: ep.queryParams,
        itemPath: ep.responseAnalysis?.itemPath ?? null, itemCount: ep.responseAnalysis?.itemCount ?? 0,
        detectedFields: ep.responseAnalysis?.detectedFields ?? {}, authIndicators: ep.authIndicators,
      })), null, 2));
      fs.writeFileSync(path.join(targetDir, 'capabilities.json'), JSON.stringify(capabilities, null, 2));
      fs.writeFileSync(path.join(targetDir, 'auth.json'), JSON.stringify({
        top_strategy: topStrategy, indicators: [...allAuth], framework,
      }, null, 2));
      if (stores.length > 0) {
        fs.writeFileSync(path.join(targetDir, 'stores.json'), JSON.stringify(stores, null, 2));
      }

      return { ...result, out_dir: targetDir };
    })(), { timeout: exploreTimeout, label: `Explore ${url}` });
  });
}

export function renderExploreSummary(result: Record<string, any>): string {
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

async function readPageMetadata(page: any /* IPage */): Promise<{ url: string; title: string }> {
  try {
    const result = await page.evaluate(`() => ({ url: window.location.href, title: document.title || '' })`);
    if (result && typeof result === 'object') return { url: String(result.url ?? ''), title: String(result.title ?? '') };
  } catch {}
  return { url: '', title: '' };
}
