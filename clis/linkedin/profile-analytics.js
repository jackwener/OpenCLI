import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

function normalizeProfileAnalyticsUrl(value) {
  const url = assertSafeLinkedinUrl(value || 'https://www.linkedin.com/in/me/', 'profile-url', '/in/me/');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('LinkedIn profile-analytics requires a /in/<handle>/ profile URL');
  }
  return parsed.toString();
}

function parseMetric(value) {
  const raw = normalizeWhitespace(value).toLowerCase().replace(/,/g, '');
  const match = raw.match(/(\d+(?:\.\d+)?)(k|m)?/i);
  if (!match) return '';
  const base = Number(match[1]);
  if (match[2]?.toLowerCase() === 'k') return String(Math.round(base * 1000));
  if (match[2]?.toLowerCase() === 'm') return String(Math.round(base * 1000000));
  return String(Math.round(base));
}

function firstMetric(text, patterns) {
  for (const pattern of patterns) {
    const match = normalizeWhitespace(text).match(pattern);
    if (match) return parseMetric(match[1]);
  }
  return '';
}

function parseDashboardMetrics(text) {
  const normalized = normalizeWhitespace(text);
  return {
    profile_views: firstMetric(normalized, [/(\d[\d,.]*\s*(?:k|m)?)\s+profile views?/i, /profile views?\s+(\d[\d,.]*\s*(?:k|m)?)/i]),
    post_impressions: firstMetric(normalized, [/(\d[\d,.]*\s*(?:k|m)?)\s+post impressions?/i, /post impressions?\s+(\d[\d,.]*\s*(?:k|m)?)/i]),
    search_appearances: firstMetric(normalized, [/(\d[\d,.]*\s*(?:k|m)?)\s+search appearances?/i, /search appearances?\s+(\d[\d,.]*\s*(?:k|m)?)/i]),
    followers: firstMetric(normalized, [/(\d[\d,.]*\s*(?:k|m)?)\s+followers?/i]),
    connections: firstMetric(normalized, [/(\d[\d,.]*\s*(?:k|m)?)\s+connections?/i]),
  };
}

function buildProfileAnalyticsScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const text = clean(document.body?.innerText || document.body?.textContent || '');
    const matches = [
      ...text.matchAll(/\d[\d,.]*\s*(?:k|m)?\s+(?:profile views?|post impressions?|search appearances?|followers?|connections?)/gi),
    ].map((match) => clean(match[0]));
    return {
      profile_url: window.location.href,
      raw_analytics: matches.join(' | '),
    };
  })()`;
}

function normalizeAnalytics(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn profile-analytics returned malformed extraction payload');
  }
  const metrics = parseDashboardMetrics(row.raw_analytics);
  if (!Object.values(metrics).some(Boolean)) {
    throw new EmptyResultError('linkedin profile-analytics', 'No visible LinkedIn profile analytics counters were found.');
  }
  return {
    profile_url: normalizeWhitespace(row.profile_url),
    ...metrics,
    raw_analytics: normalizeWhitespace(row.raw_analytics),
  };
}

cli({
  site: 'linkedin',
  name: 'profile-analytics',
  access: 'read',
  description: 'Read visible LinkedIn profile dashboard metrics such as profile views, post impressions, and search appearances',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
  ],
  columns: ['profile_url', 'profile_views', 'post_impressions', 'search_appearances', 'followers', 'connections', 'raw_analytics'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin profile-analytics');
    await page.goto(normalizeProfileAnalyticsUrl(args['profile-url']));
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn profile-analytics');
    const row = unwrapEvaluateResult(await page.evaluate(buildProfileAnalyticsScript()));
    return [normalizeAnalytics(row)];
  },
});

export const __test__ = {
  normalizeProfileAnalyticsUrl,
  parseMetric,
  parseDashboardMetrics,
  normalizeAnalytics,
};
