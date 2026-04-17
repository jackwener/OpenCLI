/**
 * Strategy Cascade: automatic strategy downgrade chain.
 *
 * Probes an API endpoint starting from the simplest strategy (PUBLIC)
 * and automatically downgrades through the strategy tiers until one works:
 *
 *   PUBLIC → COOKIE → HEADER → INTERCEPT → UI
 *
 * This eliminates the need for manual strategy selection — the system
 * automatically finds the minimum-privilege strategy that works.
 */

import { Strategy } from './registry.js';
import type { IPage } from './types.js';
import { getErrorMessage } from './errors.js';

/** Shape returned by the in-page fetch probe JS (see buildFetchProbeJs). */
interface FetchProbeResponse {
  ok?: boolean;
  status?: number;
  hasData?: boolean;
  preview?: string;
}

/** Strategy cascade order (simplest → most complex) */
const CASCADE_ORDER: Strategy[] = [
  Strategy.PUBLIC,
  Strategy.COOKIE,
  Strategy.HEADER,
  Strategy.INTERCEPT,
  Strategy.UI,
];

interface ProbeResult {
  strategy: Strategy;
  success: boolean;
  statusCode?: number;
  hasData?: boolean;
  error?: string;
  responsePreview?: string;
}

interface CascadeResult {
  bestStrategy: Strategy;
  probes: ProbeResult[];
  confidence: number;
}

/**
 * Build the JavaScript source for a fetch probe.
 * Shared logic for PUBLIC, COOKIE, and HEADER strategies.
 */
function buildFetchProbeJs(url: string, opts: {
  credentials?: boolean;
  extractCsrf?: boolean;
}): string {
  const credentialsLine = opts.credentials ? `credentials: 'include',` : '';
  const headerSetup = opts.extractCsrf
    ? `
      const cookies = document.cookie.split(';').map(c => c.trim());
      const csrf = cookies.find(c => c.startsWith('ct0=') || c.startsWith('csrf_token=') || c.startsWith('_csrf='))?.split('=').slice(1).join('=');
      const headers = {};
      if (csrf) { headers['X-Csrf-Token'] = csrf; headers['X-XSRF-Token'] = csrf; }
    `
    : 'const headers = {};';

  return `
    async () => {
      try {
        ${headerSetup}
        const resp = await fetch(${JSON.stringify(url)}, {
          ${credentialsLine}
          headers
        });
        const status = resp.status;
        if (!resp.ok) return { status, ok: false };
        const text = await resp.text();
        let hasData = false;
        try {
          const json = JSON.parse(text);
          hasData = !!json && (Array.isArray(json) ? json.length > 0 :
            typeof json === 'object' && Object.keys(json).length > 0);
          // Check for API-level error codes (common in Chinese sites)
          if (json.code !== undefined && json.code !== 0) hasData = false;
        } catch {}
        return { status, ok: true, hasData, preview: text.slice(0, 200) };
      } catch (e) { return { ok: false, error: e.message }; }
    }
  `;
}

/** Strategy → fetch probe options mapping for strategies that support probing. */
const PROBE_OPTIONS: Partial<Record<Strategy, { credentials?: boolean; extractCsrf?: boolean }>> = {
  [Strategy.PUBLIC]: {},
  [Strategy.COOKIE]: { credentials: true },
  [Strategy.HEADER]: { credentials: true, extractCsrf: true },
};

/**
 * Probe an endpoint with a specific strategy.
 * Returns whether the probe succeeded and basic response info.
 */
export async function probeEndpoint(
  page: IPage,
  url: string,
  strategy: Strategy,
  _opts: { timeout?: number } = {},
): Promise<ProbeResult> {
  const result: ProbeResult = { strategy, success: false };

  try {
    const opts = PROBE_OPTIONS[strategy];
    if (opts) {
      const resp = (await page.evaluate(buildFetchProbeJs(url, opts))) as FetchProbeResponse | undefined;
      result.statusCode = resp?.status;
      result.success = !!(resp?.ok && resp?.hasData);
      result.hasData = resp?.hasData;
      result.responsePreview = resp?.preview;
    } else {
      // INTERCEPT / UI require site-specific implementation.
      result.error = `Strategy ${strategy} requires site-specific implementation`;
    }
  } catch (err) {
    result.success = false;
    result.error = getErrorMessage(err);
  }

  return result;
}

/**
 * Run the cascade: try each strategy in order until one works.
 * Returns the simplest working strategy.
 */
export async function cascadeProbe(
  page: IPage,
  url: string,
  opts: { maxStrategy?: Strategy; timeout?: number } = {},
): Promise<CascadeResult> {
  const rawIdx = opts.maxStrategy
    ? CASCADE_ORDER.indexOf(opts.maxStrategy)
    : CASCADE_ORDER.indexOf(Strategy.HEADER); // Don't auto-try INTERCEPT/UI
  const maxIdx = rawIdx === -1 ? CASCADE_ORDER.indexOf(Strategy.HEADER) : rawIdx;

  const probes: ProbeResult[] = [];

  for (let i = 0; i <= Math.min(maxIdx, CASCADE_ORDER.length - 1); i++) {
    const strategy = CASCADE_ORDER[i];
    const probe = await probeEndpoint(page, url, strategy, opts);
    probes.push(probe);

    if (probe.success) {
      return {
        bestStrategy: strategy,
        probes,
        confidence: 1.0 - (i * 0.1), // Higher confidence for simpler strategies
      };
    }
  }

  // None worked — default to COOKIE (most common for logged-in sites)
  return {
    bestStrategy: Strategy.COOKIE,
    probes,
    confidence: 0.3,
  };
}

/**
 * Render cascade results for display.
 */
export function renderCascadeResult(result: CascadeResult): string {
  const lines = [
    `Strategy Cascade: ${result.bestStrategy} (${(result.confidence * 100).toFixed(0)}% confidence)`,
  ];
  for (const probe of result.probes) {
    const icon = probe.success ? '✅' : '❌';
    const status = probe.statusCode ? ` [${probe.statusCode}]` : '';
    const err = probe.error ? ` — ${probe.error}` : '';
    lines.push(`  ${icon} ${probe.strategy}${status}${err}`);
  }
  return lines.join('\n');
}
