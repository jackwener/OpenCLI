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
 * Probe an endpoint with a specific strategy.
 * Returns whether the probe succeeded and basic response info.
 */
export async function probeEndpoint(
  page: IPage,
  url: string,
  strategy: Strategy,
  opts: { timeout?: number } = {},
): Promise<ProbeResult> {
  const result: ProbeResult = { strategy, success: false };

  try {
    switch (strategy) {
      case Strategy.PUBLIC: {
        // Try direct fetch without browser (no credentials)
        const js = `
          async () => {
            try {
              const resp = await fetch(${JSON.stringify(url)});
              const status = resp.status;
              if (!resp.ok) return { status, ok: false };
              const text = await resp.text();
              let hasData = false;
              try {
                const json = JSON.parse(text);
                hasData = !!json && (Array.isArray(json) ? json.length > 0 :
                  typeof json === 'object' && Object.keys(json).length > 0);
              } catch {}
              return { status, ok: true, hasData, preview: text.slice(0, 200) };
            } catch (e) { return { ok: false, error: e.message }; }
          }
        `;
        const resp = await page.evaluate(js);
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.COOKIE: {
        // Fetch with credentials: 'include' (uses browser cookies)
        const js = `
          async () => {
            try {
              const resp = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
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
        const resp = await page.evaluate(js);
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.HEADER: {
        // Fetch with credentials + try to extract common auth headers
        const js = `
          async () => {
            try {
              // Try to extract CSRF tokens from cookies
              const cookies = document.cookie.split(';').map(c => c.trim());
              const csrf = cookies.find(c => c.startsWith('ct0=') || c.startsWith('csrf_token=') || c.startsWith('_csrf='))?.split('=').slice(1).join('=');
              
              const headers = {};
              if (csrf) {
                headers['X-Csrf-Token'] = csrf;
                headers['X-XSRF-Token'] = csrf;
              }
              
              const resp = await fetch(${JSON.stringify(url)}, {
                credentials: 'include',
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
                if (json.code !== undefined && json.code !== 0) hasData = false;
              } catch {}
              return { status, ok: true, hasData, preview: text.slice(0, 200) };
            } catch (e) { return { ok: false, error: e.message }; }
          }
        `;
        const resp = await page.evaluate(js);
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.INTERCEPT:
      case Strategy.UI:
        // These require specific implementation per-site
        // Mark as needing manual implementation
        result.success = false;
        result.error = `Strategy ${strategy} requires site-specific implementation`;
        break;
    }
  } catch (err: any) {
    result.success = false;
    result.error = err.message ?? String(err);
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
  const maxIdx = opts.maxStrategy
    ? CASCADE_ORDER.indexOf(opts.maxStrategy)
    : CASCADE_ORDER.indexOf(Strategy.HEADER); // Don't auto-try INTERCEPT/UI

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
