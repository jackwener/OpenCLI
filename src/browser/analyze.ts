/**
 * `browser analyze <url>` — turn site-recon guesswork into deterministic CLI output.
 *
 * When an agent starts a new adapter, the first question is "which pattern am
 * I looking at?" (A/B/C/D/E from site-recon docs) and "will Node-side fetch
 * work, or will anti-bot middleware block me?". Today the agent has to open
 * the page, poke `network`, try cURL, fail, guess again. This module condenses
 * that into one call that returns a classification + evidence.
 *
 * Kept pure (no page imports) so the bulk is unit-testable; the CLI wrapper
 * drives a real page, feeds the resulting signals here, and prints the verdict.
 */

import type { CliCommand } from '../registry.js';

// ── Signals the CLI wrapper collects from a real page ──────────────────────

export interface PageSignals {
  /** URL we navigated to (may redirect; both fields help agents notice that). */
  requestedUrl: string;
  finalUrl: string;

  /** document.cookie split into names; value not needed for detection. */
  cookieNames: string[];

  /**
   * Response bodies captured during the navigation + first few seconds.
   * We only need enough body text to spot WAF markers; the CLI truncates
   * per-entry before feeding us.
   */
  networkEntries: Array<{
    url: string;
    status: number;
    contentType: string;
    /** First N chars of body; null when not available. */
    bodyPreview: string | null;
  }>;

  /**
   * Which globals the page exposes on `window`. We don't care about the values,
   * just presence — distinguishes Pattern B (SSR state) from Pattern A.
   */
  initialState: {
    __INITIAL_STATE__: boolean;
    __NUXT__: boolean;
    __NEXT_DATA__: boolean;
    __APOLLO_STATE__: boolean;
  };

  /** Document title — only for the human-debug `summary` field. */
  title: string;
}

export type EndpointEvidenceVerdict = 'likely_data' | 'maybe_data' | 'noise' | 'blocked';

export interface EndpointEvidence {
  url: string;
  status: number;
  contentType: string;
  real_data_score: number;
  verdict: EndpointEvidenceVerdict;
  reasons: string[];
  sample_paths: string[];
}

// ── Anti-bot detection ────────────────────────────────────────────────────

export type AntiBotVendor =
  | 'aliyun_waf'
  | 'cloudflare'
  | 'akamai'
  | 'geetest'
  | 'unknown';

export interface AntiBotVerdict {
  detected: boolean;
  vendor: AntiBotVendor | null;
  evidence: string[];
  /** One-line imperative instruction for the agent. */
  implication: string;
}

/**
 * WAF vendors we can reliably detect from cookies + response body markers
 * alone. Signals are orthogonal per vendor — so when two vendors match
 * simultaneously (rare), we keep all evidence and report the higher-signal
 * vendor first.
 */
const WAF_SIGNATURES: Array<{
  vendor: Exclude<AntiBotVendor, 'unknown'>;
  cookiePatterns: RegExp[];
  bodyPatterns: RegExp[];
  implication: string;
}> = [
  {
    vendor: 'aliyun_waf',
    cookiePatterns: [/^acw_sc__v2$/, /^acw_tc$/, /^ssxmod_itna/],
    bodyPatterns: [/arg1\s*=\s*['"][0-9A-F]{30,}/, /\/ntc_captcha\//i],
    implication:
      'Direct Node-side fetch/curl will return the slider HTML. Validate the endpoint in browser context first; HTML COOKIE adapters still finish with Node-side fetch + page.getCookies.',
  },
  {
    vendor: 'cloudflare',
    cookiePatterns: [/^__cf_bm$/, /^cf_clearance$/, /^__cfduid$/],
    bodyPatterns: [/Cloudflare Ray ID/i, /Checking your browser before accessing/i, /cf-chl-/i],
    implication:
      'Cloudflare bot check. Start from a real browser session; probe in browser context first. HTML COOKIE adapters still finish with Node-side fetch + page.getCookies.',
  },
  {
    vendor: 'akamai',
    cookiePatterns: [/^_abck$/, /^bm_sz$/, /^bm_sv$/],
    bodyPatterns: [/akamai/i],
    implication:
      'Akamai Bot Manager. Probe in browser context first; keep final HTML COOKIE adapters on Node-side fetch + page.getCookies.',
  },
  {
    vendor: 'geetest',
    cookiePatterns: [],
    bodyPatterns: [/geetest/i, /gt_captcha/i],
    implication:
      'Geetest slider/puzzle captcha. Agent cannot bypass programmatically — requires UI strategy or human-in-loop.',
  },
];

export function detectAntiBot(signals: PageSignals): AntiBotVerdict {
  const evidence: string[] = [];
  let match: typeof WAF_SIGNATURES[number] | null = null;

  for (const sig of WAF_SIGNATURES) {
    const hits: string[] = [];
    for (const pat of sig.cookiePatterns) {
      const hit = signals.cookieNames.find((c) => pat.test(c));
      if (hit) hits.push(`cookie:${hit}`);
    }
    for (const pat of sig.bodyPatterns) {
      for (const entry of signals.networkEntries) {
        if (entry.bodyPreview && pat.test(entry.bodyPreview)) {
          hits.push(`body:${entry.url}`);
          break;
        }
      }
    }
    if (hits.length > 0 && !match) {
      match = sig;
      evidence.push(...hits);
    }
  }

  if (!match) {
    return {
      detected: false,
      vendor: null,
      evidence: [],
      implication: 'No known anti-bot signatures. Try Node-side COOKIE fetch first; if endpoint validation is blocked, retry from browser context.',
    };
  }

  return {
    detected: true,
    vendor: match.vendor,
    evidence,
    implication: match.implication,
  };
}

// ── Pattern classification ────────────────────────────────────────────────

export type Pattern = 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown';

export interface PatternVerdict {
  pattern: Pattern;
  reason: string;
  /** How many JSON XHR/fetch responses we saw during navigation. */
  json_responses: number;
  /** How many observed responses look like real business data, not telemetry. */
  real_data_candidates: number;
  /** Count of non-2xx API responses — hint for token-gated (Pattern D). */
  auth_failures: number;
}

const NOISE_URL_RE = /(?:analytics|beacon|collect|telemetry|tracking|sentry|doubleclick|google-analytics|googletagmanager|adservice|\/ads?(?:[/?#]|$)|metrics?|pixel|personalization|experiment|\/events?(?:[/?#]|$))/i;
const BUSINESS_KEY_RE = /^(?:data|items?|results?|records?|list|rows?|edges?|nodes?|timeline|users?|title|name|text|content|body|price|amount|id|url|avatar|nickname|desc|comments?|likes?|shares?|total|page|cursor|next|rank|score|date|time|author)$/i;
const TRACKING_KEY_RE = /^(?:event|events|trace|traceid|sessionid|clientid|visitorid|experiment|abtest|beacon|analytics|metrics?|pixel|log|logs)$/i;

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function parseBodyPreview(preview: string | null): unknown {
  if (!preview) return null;
  const trimmed = preview.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function collectJsonPaths(value: unknown, prefix = '$', out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length >= 24) return out;
  if (Array.isArray(value)) {
    out.push(`${prefix}:array(${value.length})`);
    if (value.length > 0) collectJsonPaths(value[0], `${prefix}[0]`, out, depth + 1);
    return out;
  }
  if (!value || typeof value !== 'object') {
    out.push(`${prefix}:${typeof value}`);
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
  for (const [key, child] of entries) {
    out.push(`${prefix}.${key}`);
    if (Array.isArray(child)) out.push(`${prefix}.${key}:array(${child.length})`);
    else if (child && typeof child === 'object') collectJsonPaths(child, `${prefix}.${key}`, out, depth + 1);
    else out.push(`${prefix}.${key}:${typeof child}`);
  }
  return out;
}

function countKeys(value: unknown, predicate: (key: string) => boolean, depth = 0): number {
  if (depth > 4 || !value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.slice(0, 3).reduce((sum, item) => sum + countKeys(item, predicate, depth + 1), 0);
  return Object.entries(value as Record<string, unknown>).reduce((sum, [key, child]) => (
    sum + (predicate(key) ? 1 : 0) + countKeys(child, predicate, depth + 1)
  ), 0);
}

function hasNonEmptyArray(value: unknown, depth = 0): boolean {
  if (depth > 4 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.values(value as Record<string, unknown>).some((child) => hasNonEmptyArray(child, depth + 1));
}

export function scoreEndpointEvidence(entry: PageSignals['networkEntries'][number]): EndpointEvidence {
  const reasons: string[] = [];
  const body = parseBodyPreview(entry.bodyPreview);
  let score = 0;

  if (entry.status >= 200 && entry.status < 300) {
    score += 0.15;
    reasons.push('2xx status');
  } else if (entry.status === 401 || entry.status === 403) {
    return {
      url: entry.url,
      status: entry.status,
      contentType: entry.contentType,
      real_data_score: 0.05,
      verdict: 'blocked',
      reasons: ['auth-blocked status'],
      sample_paths: [],
    };
  } else {
    reasons.push(`non-2xx status ${entry.status}`);
  }

  if (/json/i.test(entry.contentType)) {
    score += 0.2;
    reasons.push('json content-type');
  } else if (/html/i.test(entry.contentType)) {
    score -= 0.25;
    reasons.push('html content-type');
  } else if (/javascript|text/i.test(entry.contentType)) {
    score += 0.05;
    reasons.push('text/script content-type');
  }

  if (NOISE_URL_RE.test(entry.url)) {
    score -= 0.3;
    reasons.push('telemetry-like url');
  }

  const samplePaths = collectJsonPaths(body).slice(0, 8);
  if (typeof body === 'string') {
    if (/^\s*</.test(body) || /<!doctype html|<html/i.test(body)) {
      score -= 0.25;
      reasons.push('html body');
    } else if (body.trim().length > 20) {
      score += 0.05;
      reasons.push('non-empty text body');
    }
  } else if (Array.isArray(body)) {
    if (body.length > 0) {
      score += 0.3;
      reasons.push('non-empty top-level array');
    } else {
      score -= 0.15;
      reasons.push('empty array');
    }
  } else if (body && typeof body === 'object') {
    const keys = Object.keys(body as Record<string, unknown>);
    if (keys.length === 0) {
      score -= 0.15;
      reasons.push('empty object');
    } else {
      score += 0.12;
      reasons.push('json object body');
    }

    const businessKeys = countKeys(body, (key) => BUSINESS_KEY_RE.test(key));
    if (businessKeys > 0) {
      score += Math.min(0.3, businessKeys * 0.05);
      reasons.push(`${businessKeys} business-like key${businessKeys === 1 ? '' : 's'}`);
    }
    if (hasNonEmptyArray(body)) {
      score += 0.2;
      reasons.push('nested non-empty array');
    }
    const trackingKeys = countKeys(body, (key) => TRACKING_KEY_RE.test(key));
    if (trackingKeys > 0 && businessKeys === 0) {
      score -= Math.min(0.25, trackingKeys * 0.08);
      reasons.push(`${trackingKeys} tracking-like key${trackingKeys === 1 ? '' : 's'} without business keys`);
    }
  }

  const realDataScore = clampScore(score);
  const verdict: EndpointEvidenceVerdict = realDataScore >= 0.65
    ? 'likely_data'
    : realDataScore >= 0.35
      ? 'maybe_data'
      : 'noise';

  return {
    url: entry.url,
    status: entry.status,
    contentType: entry.contentType,
    real_data_score: realDataScore,
    verdict,
    reasons,
    sample_paths: samplePaths,
  };
}

export function scoreNetworkEvidence(signals: PageSignals): EndpointEvidence[] {
  return signals.networkEntries
    .map(scoreEndpointEvidence)
    .filter((evidence) => evidence.verdict !== 'noise' || evidence.real_data_score > 0)
    .sort((a, b) => b.real_data_score - a.real_data_score)
    .slice(0, 8);
}

/**
 * Apply the decision tree from `site-recon.md` mechanically.
 *
 * B beats A when initial-state globals are present: even if the page fetches
 * more data via XHR afterwards, the SSR payload is the highest-leverage source.
 * D (token-gated) dominates when we see 401/403 on what looks like API
 * endpoints — without that, an authenticated route looks identical to A.
 */
export function classifyPattern(signals: PageSignals): PatternVerdict {
  const jsonEntries = signals.networkEntries.filter((e) => /json/i.test(e.contentType));
  const endpointEvidence = scoreNetworkEvidence(signals);
  const realDataCandidates = endpointEvidence.filter((e) => e.verdict === 'likely_data' || e.verdict === 'maybe_data').length;
  const authFailures = signals.networkEntries.filter(
    (e) => e.status === 401 || e.status === 403,
  ).length;
  const hasInitialState =
    signals.initialState.__INITIAL_STATE__ ||
    signals.initialState.__NUXT__ ||
    signals.initialState.__NEXT_DATA__ ||
    signals.initialState.__APOLLO_STATE__;

  if (authFailures >= 2 && jsonEntries.length >= 1) {
    return {
      pattern: 'D',
      reason: `${authFailures} auth-failing API responses seen — endpoint is token-gated`,
      json_responses: jsonEntries.length,
      real_data_candidates: realDataCandidates,
      auth_failures: authFailures,
    };
  }

  if (hasInitialState) {
    const which = Object.entries(signals.initialState)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return {
      pattern: 'B',
      reason: `SSR state global present: ${which.join(', ')}`,
      json_responses: jsonEntries.length,
      real_data_candidates: realDataCandidates,
      auth_failures: authFailures,
    };
  }

  if (realDataCandidates >= 1) {
    return {
      pattern: 'A',
      reason: `${realDataCandidates} captured response${realDataCandidates === 1 ? '' : 's'} look like real data — inspect api_candidates before choosing a strategy`,
      json_responses: jsonEntries.length,
      real_data_candidates: realDataCandidates,
      auth_failures: authFailures,
    };
  }

  // No API, no SSR state — probably static HTML or a bundled SPA that lazy-loads.
  // Pattern C (HTML scrape) is the default fallback; E (streaming) we can't
  // reliably detect without watching WebSocket frames, so we label 'C' and
  // leave the agent to upgrade to E manually if they see WS traffic.
  return {
    pattern: 'C',
    reason: jsonEntries.length > 0
      ? `${jsonEntries.length} JSON response${jsonEntries.length === 1 ? '' : 's'} observed, but none look like target data — likely telemetry/side-channel; treat as HTML/DOM until an endpoint validates`
      : 'No JSON XHR and no SSR state — HTML scrape (Pattern C); escalate to E manually if WebSocket traffic appears',
    json_responses: jsonEntries.length,
    real_data_candidates: realDataCandidates,
    auth_failures: authFailures,
  };
}

// ── Nearest-adapter lookup ────────────────────────────────────────────────

export interface NearestAdapter {
  site: string;
  example_commands: string[];
  reason: string;
}

/**
 * Find existing adapters that target the same site.
 *
 * Keep the hostname match simple — agents extend naming conventions
 * differently per site, so we match on the registered `domain` field and fall
 * back to site-name containment. Returning `null` is fine; agents can always
 * read site-memory docs.
 */
export function findNearestAdapter(
  finalUrl: string,
  registry: Map<string, CliCommand>,
): NearestAdapter | null {
  let host: string;
  try {
    host = new URL(finalUrl).hostname;
  } catch {
    return null;
  }
  // Strip leading www.; 'www' as a site identifier is never what an adapter uses.
  const cleanedHost = host.replace(/^www\./, '');
  // Extract apex (xx.com) and registrable parts for fuzzy match.
  const parts = cleanedHost.split('.');
  const apex = parts.slice(-2).join('.');
  const siteKey = parts.length > 1 ? parts[parts.length - 2] : cleanedHost;

  const hits = new Map<string, CliCommand[]>();
  for (const cmd of registry.values()) {
    const domain = cmd.domain?.toLowerCase();
    const siteMatches =
      (domain && (cleanedHost.endsWith(domain) || domain.endsWith(apex))) ||
      cmd.site.toLowerCase() === siteKey?.toLowerCase() ||
      cleanedHost.includes(cmd.site.toLowerCase());
    if (siteMatches) {
      const list = hits.get(cmd.site) ?? [];
      list.push(cmd);
      hits.set(cmd.site, list);
    }
  }
  if (hits.size === 0) return null;

  // Pick the site with the most commands — likely the most-developed adapter,
  // and the best reference for a new command on the same host.
  let best: [string, CliCommand[]] | null = null;
  for (const entry of hits) {
    if (!best || entry[1].length > best[1].length) best = entry;
  }
  if (!best) return null;

  return {
    site: best[0],
    example_commands: best[1].slice(0, 5).map((c) => `${c.site} ${c.name}`),
    reason: `${best[1].length} existing adapter${best[1].length === 1 ? '' : 's'} target this site — reuse strategy/cookie config`,
  };
}

// ── Top-level assembly ────────────────────────────────────────────────────

export interface AnalyzeReport {
  requested_url: string;
  final_url: string;
  title: string;
  pattern: PatternVerdict;
  anti_bot: AntiBotVerdict;
  initial_state: PageSignals['initialState'];
  api_candidates: EndpointEvidence[];
  nearest_adapter: NearestAdapter | null;
  recommended_next_step: string;
}

/**
 * Synthesize the verdict from collected signals + registry.
 *
 * The `recommended_next_step` is deliberately a single imperative
 * sentence — agents act on it directly instead of re-deriving advice from
 * the structured fields.
 */
export function analyzeSite(
  signals: PageSignals,
  registry: Map<string, CliCommand>,
): AnalyzeReport {
  const pattern = classifyPattern(signals);
  const antiBot = detectAntiBot(signals);
  const apiCandidates = scoreNetworkEvidence(signals);
  const nearest = findNearestAdapter(signals.finalUrl, registry);

  let next: string;
  if (antiBot.detected) {
    next = antiBot.implication;
  } else if (pattern.pattern === 'A') {
    next = 'Inspect `api_candidates`, then replay the best endpoint and record the status/content-type/sample shape in your strategy note; do not choose API strategy from XHR count alone.';
  } else if (pattern.pattern === 'B') {
    next = 'Read the SSR global via `opencli browser eval "JSON.stringify(window.__INITIAL_STATE__ ?? window.__NUXT__ ?? window.__NEXT_DATA__ ?? window.__APOLLO_STATE__)"` — no API needed.';
  } else if (pattern.pattern === 'C') {
    next = 'No API visible — use SSR HTML scrape (e.g. `opencli browser extract`) against the rendered page.';
  } else if (pattern.pattern === 'D') {
    next = 'Endpoints need auth. Re-open the page from a signed-in session, then retry analyze; see `field-decode-playbook` §4 for token tracing.';
  } else if (pattern.pattern === 'E') {
    next = 'WebSocket stream detected — find the underlying HTTP poll/long-poll endpoint; raw WS is not supported.';
  } else {
    next = 'No strong signal. Manually inspect `opencli browser network --all` and pick a pattern.';
  }

  return {
    requested_url: signals.requestedUrl,
    final_url: signals.finalUrl,
    title: signals.title,
    pattern,
    anti_bot: antiBot,
    initial_state: signals.initialState,
    api_candidates: apiCandidates,
    nearest_adapter: nearest,
    recommended_next_step: next,
  };
}
