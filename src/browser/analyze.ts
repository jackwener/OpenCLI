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
  /** Count of non-2xx API responses — hint for token-gated (Pattern D). */
  auth_failures: number;
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
      auth_failures: authFailures,
    };
  }

  if (jsonEntries.length >= 1) {
    return {
      pattern: 'A',
      reason: `${jsonEntries.length} JSON XHR/fetch responses observed — classic API pattern`,
      json_responses: jsonEntries.length,
      auth_failures: authFailures,
    };
  }

  // No API, no SSR state — probably static HTML or a bundled SPA that lazy-loads.
  // Pattern C (HTML scrape) is the default fallback; E (streaming) we can't
  // reliably detect without watching WebSocket frames, so we label 'C' and
  // leave the agent to upgrade to E manually if they see WS traffic.
  return {
    pattern: 'C',
    reason: 'No JSON XHR and no SSR state — HTML scrape (Pattern C); escalate to E manually if WebSocket traffic appears',
    json_responses: jsonEntries.length,
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
  const nearest = findNearestAdapter(signals.finalUrl, registry);

  let next: string;
  if (antiBot.detected) {
    next = antiBot.implication;
  } else if (pattern.pattern === 'A') {
    next = 'Pick the most specific JSON endpoint from `opencli browser network` and try a bare Node fetch with cookies; escalate to browser-context fetch only if blocked.';
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
    nearest_adapter: nearest,
    recommended_next_step: next,
  };
}
